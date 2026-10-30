//! Remote update. The app asks a version endpoint what the latest release is; if it is newer
//! the UI blocks until the user installs it. Installing = ask the API for a signed download
//! link, download the exe, verify it, swap it in for the running exe and relaunch.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::applog;

/// Latest release as reported by the update endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Accepts either a JSON object `{ "version": "1.0.2", "notes": "..." }`,
/// a JSON string `"1.0.2"`, or a plain-text body `1.0.2`.
fn parse_update(body: &str) -> Result<UpdateInfo, String> {
    let text = body.trim().trim_start_matches('\u{feff}');
    let info = match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(_)) => serde_json::from_str::<UpdateInfo>(text)
            .map_err(|e| format!("Unexpected update response: {e}"))?,
        Ok(serde_json::Value::String(v)) => UpdateInfo { version: v, download_url: None, notes: None },
        _ => UpdateInfo { version: text.to_string(), download_url: None, notes: None },
    };
    let version = info.version.trim().to_string();
    if version.is_empty() || version.len() > 64 || version.contains(char::is_whitespace) {
        return Err(format!(
            "Update response is not a version: {}",
            text.chars().take(80).collect::<String>()
        ));
    }
    Ok(UpdateInfo { version, ..info })
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle, url: String) -> Result<UpdateInfo, String> {
    // Product name comes from tauri.conf.json so the request always names this app.
    let product = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app.package_info().name.clone());
    let result = fetch_latest(&url, &product).await;
    match &result {
        Ok(info) => applog::write(&format!("Update check: latest release is {}", info.version)),
        Err(e) => applog::write(&format!("Update check failed: {e}")),
    }
    result
}

async fn fetch_latest(url: &str, product: &str) -> Result<UpdateInfo, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(format!("Update URL must be http(s): {url}"));
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .header("accept", "application/json, text/plain")
        .json(&serde_json::json!({ "productName": product }))
        .send()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Update check returned {status}"));
    }
    let body = response.text().await.map_err(|e| e.to_string())?;
    parse_update(&body)
}

// ---------------------------------------------------------------- install

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    /// Set when the update could not replace the running exe and was saved here instead.
    pub saved_to: Option<String>,
}

/// Asks the storage API for a temporary signed download link for `key`.
pub(crate) async fn signed_url(endpoint: &str, key: &str) -> Result<String, String> {
    if !endpoint.starts_with("https://") && !endpoint.starts_with("http://") {
        return Err(format!("Download endpoint must be http(s): {endpoint}"));
    }
    let resp = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .post(endpoint)
        .json(&serde_json::json!({ "key": key }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the download service: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("The download service answered {status}"));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Download service sent an unreadable answer: {e}"))?;
    let url = body
        .get("url")
        .and_then(|u| u.as_str())
        .filter(|_| body.get("success").and_then(|s| s.as_bool()).unwrap_or(true))
        .ok_or("The download service did not return a link")?;
    if !url.starts_with("https://") {
        return Err("The download link is not https, refusing to use it".into());
    }
    Ok(url.to_string())
}

/// Streams `url` into `dest`, then checks size, the MD5 (`expected_md5` when given, otherwise the
/// ETag when it is a plain MD5) and that the file is a Windows program. `dest` is removed by the
/// caller on error.
pub(crate) async fn download(
    url: &str,
    dest: &Path,
    expected_md5: Option<&str>,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    let mut resp = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("That version is not on the download server (404). It may not have been published yet.".into());
    }
    if !status.is_success() {
        return Err(format!("The download server answered {status}"));
    }
    let total = resp.content_length();
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_matches('"').to_ascii_lowercase());

    let mut file = fs::File::create(dest).map_err(|e| format!("Could not write {}: {e}", dest.display()))?;
    let mut md5 = Md5::new();
    let (mut done, mut last_sent) = (0u64, 0u64);
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download interrupted: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("Could not write the file: {e}"))?;
        md5.update(&chunk);
        done += chunk.len() as u64;
        if done - last_sent >= 256 * 1024 {
            on_progress(done, total);
            last_sent = done;
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    on_progress(done, total);

    if let Some(t) = total {
        if t != done {
            return Err(format!("Download incomplete: got {done} of {t} bytes"));
        }
    }
    let mut magic = [0u8; 2];
    fs::File::open(dest)
        .and_then(|mut f| f.read_exact(&mut magic))
        .map_err(|e| format!("Could not read the downloaded file: {e}"))?;
    if &magic != b"MZ" {
        return Err("The downloaded file is not a Windows program".into());
    }
    let plain_md5 = |s: &str| s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit());
    let expected = expected_md5
        .map(|m| m.trim().to_ascii_lowercase())
        .or_else(|| etag.filter(|t| plain_md5(t)));
    if let Some(expected) = expected {
        let actual = format!("{:x}", md5.finalize());
        if actual != expected {
            return Err(format!(
                "The downloaded file is corrupt (checksum mismatch: expected {expected}, got {actual})"
            ));
        }
    }
    Ok(())
}

fn sibling(exe: &Path, tag: &str) -> PathBuf {
    let stem = exe.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    exe.with_file_name(format!("{stem}.{tag}.exe"))
}

/// A running exe cannot be overwritten but can be renamed: move it aside, put the new one in
/// its place, and undo if that fails. Returns the path the old exe was moved to.
fn swap_in(current: &Path, new: &Path) -> Result<PathBuf, String> {
    let old = sibling(current, "old");
    let _ = fs::remove_file(&old);
    fs::rename(current, &old).map_err(|e| format!("Could not move the running app aside: {e}"))?;
    if let Err(e) = fs::rename(new, current) {
        let _ = fs::rename(&old, current);
        return Err(format!("Could not put the new version in place: {e}"));
    }
    Ok(old)
}

/// Starts the new exe a moment after this process has exited.
fn relaunch(exe: &Path) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
            .arg("/C")
            .raw_arg(format!("ping -n 3 127.0.0.1 >nul && start \"\" \"{}\"", exe.display()))
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new(exe).spawn();
    }
}

/// Removes leftovers of a previous update. Retried a few seconds after start because the old
/// process may still be shutting down.
pub fn cleanup_old() {
    if let Ok(exe) = std::env::current_exe() {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            for tag in ["old", "new"] {
                let p = sibling(&exe, tag);
                if p.exists() {
                    let _ = fs::remove_file(&p);
                }
            }
        });
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle, endpoint: String, key: String) -> Result<InstallOutcome, String> {
    applog::write(&format!("Update install started: {key}"));
    let result = install(&app, &endpoint, &key).await;
    match &result {
        Ok(outcome) => match &outcome.saved_to {
            Some(path) => applog::write(&format!("Update saved to {path} (could not replace this copy)")),
            None => applog::write("Update installed, restarting"),
        },
        Err(e) => applog::write(&format!("Update install failed: {e}")),
    }
    result
}

async fn install(app: &AppHandle, endpoint: &str, key: &str) -> Result<InstallOutcome, String> {
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let url = signed_url(endpoint, key).await?;

    // Prefer replacing in place. A debug build must never replace itself, and a protected
    // folder (e.g. Program Files) cannot be written, so those save to Downloads instead.
    let beside = sibling(&current, "new");
    let in_place = !cfg!(debug_assertions) && fs::File::create(&beside).is_ok();
    let dest = if in_place {
        beside.clone()
    } else {
        let name = key.rsplit('/').next().unwrap_or("CasewareInstaller.exe");
        let dir = app.path().download_dir().map_err(|e| format!("No Downloads folder: {e}"))?;
        dir.join(name)
    };

    let handle = app.clone();
    let downloaded = download(&url, &dest, None, move |downloaded, total| {
        let _ = handle.emit("update-progress", Progress { downloaded, total });
    })
    .await;
    if let Err(e) = downloaded {
        let _ = fs::remove_file(&dest);
        return Err(e);
    }

    if !in_place {
        return Ok(InstallOutcome { saved_to: Some(dest.display().to_string()) });
    }
    let _old = swap_in(&current, &dest).inspect_err(|_| {
        let _ = fs::remove_file(&dest);
    })?;
    relaunch(&current);
    app.exit(0);
    Ok(InstallOutcome { saved_to: None })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn parses_plain_text() {
        assert_eq!(parse_update("1.0.2\n").unwrap().version, "1.0.2");
    }

    #[test]
    fn parses_json_string() {
        assert_eq!(parse_update("\"1.0.2\"").unwrap().version, "1.0.2");
    }

    #[test]
    fn parses_json_object() {
        let info =
            parse_update(r#"{"version":"1.0.2","downloadUrl":"https://x/y.exe","notes":"Fixes"}"#).unwrap();
        assert_eq!(info.version, "1.0.2");
        assert_eq!(info.download_url.as_deref(), Some("https://x/y.exe"));
        assert_eq!(info.notes.as_deref(), Some("Fixes"));
    }

    #[test]
    fn rejects_html_or_garbage() {
        assert!(parse_update("<html><body>Not found</body></html>").is_err());
        assert!(parse_update("").is_err());
        assert!(parse_update(r#"{"latest":"1.0.2"}"#).is_err());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cw-update-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn swap_replaces_exe_and_keeps_old() {
        let dir = temp_dir("swap");
        let (cur, new) = (dir.join("App.exe"), dir.join("App.new.exe"));
        fs::write(&cur, b"old").unwrap();
        fs::write(&new, b"new").unwrap();
        let old = swap_in(&cur, &new).unwrap();
        assert_eq!(fs::read(&cur).unwrap(), b"new");
        assert_eq!(fs::read(&old).unwrap(), b"old");
        assert!(!new.exists());
    }

    #[test]
    fn swap_rolls_back_when_new_file_is_missing() {
        let dir = temp_dir("rollback");
        let (cur, new) = (dir.join("App.exe"), dir.join("App.new.exe"));
        fs::write(&cur, b"old").unwrap();
        assert!(swap_in(&cur, &new).is_err());
        assert_eq!(fs::read(&cur).unwrap(), b"old");
    }

    /// One-shot local HTTP server answering with `body` and the given ETag.
    fn serve(body: Vec<u8>, etag: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = s.read(&mut buf);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nETag: \"{etag}\"\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = s.write_all(head.as_bytes());
            let _ = s.write_all(&body);
        });
        format!("http://{addr}/CasewareInstaller.exe")
    }

    fn run_download(body: Vec<u8>, etag: String, name: &str) -> (Result<(), String>, PathBuf) {
        let dest = temp_dir(name).join("out.exe");
        let url = serve(body, etag);
        let r = tauri::async_runtime::block_on(download(&url, &dest, None, |_, _| {}));
        (r, dest)
    }

    fn md5_hex(b: &[u8]) -> String {
        format!("{:x}", Md5::digest(b))
    }

    #[test]
    fn download_accepts_a_valid_file() {
        let body = [b"MZ".as_slice(), &[7u8; 5000]].concat();
        let (r, dest) = run_download(body.clone(), md5_hex(&body), "ok");
        assert_eq!(r, Ok(()));
        assert_eq!(fs::read(dest).unwrap(), body);
    }

    #[test]
    fn download_rejects_checksum_mismatch() {
        let body = [b"MZ".as_slice(), &[7u8; 100]].concat();
        let (r, _) = run_download(body, "0".repeat(32), "badsum");
        assert!(r.unwrap_err().contains("checksum"));
    }

    #[test]
    fn download_rejects_non_programs() {
        let body = b"<html>not an exe</html>".to_vec();
        let (r, _) = run_download(body.clone(), md5_hex(&body), "notexe");
        assert!(r.unwrap_err().contains("not a Windows program"));
    }
}
