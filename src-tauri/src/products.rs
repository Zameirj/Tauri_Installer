//! Downloads the selected products one after another. Each file is fetched through a signed link
//! from the storage API and saved to a "Caseware Installer" folder in Downloads. Each archive is
//! then extracted with the bundled 7-Zip tool.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Emitter, Manager};

use crate::applog;
use crate::update::{download, signed_url};

/// Storage endpoint that signs download links. Same service as the Installer's self-update.
const SIGNED_URL_ENDPOINT: &str = "https://api.prod.casewareafrica.com/api/awsStorage/get-signed-url";

/// 7-Zip console tool, compiled into the exe. A portable build is a single file, so it cannot rely
/// on a resources folder beside it.
const SEVEN_ZIP: &[u8] = include_bytes!("../resources/7za/7za.exe");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub product_id: String,
    pub name: String,
    pub version: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    product_id: String,
    index: usize,
    count: usize,
    downloaded: u64,
    total: Option<u64>,
}

/// Storage key for a product version, e.g. products/Caseware Connector/versions/2026.00.003/<id>.exe
pub fn storage_key(item: &DownloadItem) -> String {
    format!("products/{}/versions/{}/{}.exe", item.name, item.version, item.product_id)
}

/// Saved as the product id, which is already a safe file name.
fn file_name(item: &DownloadItem) -> String {
    format!("{}.exe", item.product_id)
}

/// One subfolder per product, named after the product. Windows folder names cannot hold these
/// characters, so they are replaced.
fn folder_name(item: &DownloadItem) -> String {
    item.name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect::<String>()
        .trim_end_matches(['.', ' '])
        .to_string()
}

/// The archives are protected with the SHA-1 (hex) of the product id.
fn sfx_password(product_id: &str) -> String {
    format!("{:x}", Sha1::digest(product_id.as_bytes()))
}

/// Extracts `archive` into `dir` with the bundled 7-Zip tool. The archive is read, never run.
fn extract_archive(tool: &Path, archive: &Path, dir: &Path, password: &str) -> Result<(), String> {
    let mut command = Command::new(tool);
    command
        .arg("x")
        .arg("-y")
        .arg("-aoa")
        .arg("-bd")
        .arg(format!("-o{}", dir.display()))
        .arg(format!("-p{password}"))
        .arg(archive);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command.output().map_err(|e| format!("Could not start 7-Zip: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "The extraction failed (exit code {}): {}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ))
    }
}

/// Writes the embedded 7-Zip to the app's local data folder (once per size) and returns its path.
fn seven_zip_tool(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No app data folder: {e}"))?
        .join("tools");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let tool = dir.join("7za.exe");
    let current = fs::metadata(&tool).map(|m| m.len() == SEVEN_ZIP.len() as u64).unwrap_or(false);
    if !current {
        fs::write(&tool, SEVEN_ZIP).map_err(|e| format!("Could not write 7-Zip to {}: {e}", tool.display()))?;
    }
    Ok(tool)
}

/// Extracts each downloaded archive into its product folder, then deletes the archive.
/// Stops at the first failure and keeps that archive for inspection.
#[tauri::command]
pub async fn extract_products(app: AppHandle, items: Vec<DownloadItem>) -> Result<Vec<String>, String> {
    let folder = target_folder(&app)?;
    let tool = seven_zip_tool(&app)?;
    let mut extracted = Vec::with_capacity(items.len());

    for item in items {
        let dir = folder.join(folder_name(&item));
        let exe = dir.join(file_name(&item));
        applog::write(&format!("Extract started: {}", exe.display()));

        let password = sfx_password(&item.product_id);
        let (run_tool, run_exe, run_dir) = (tool.clone(), exe.clone(), dir.clone());
        let result = tauri::async_runtime::spawn_blocking(move || {
            extract_archive(&run_tool, &run_exe, &run_dir, &password)
        })
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
        if let Err(e) = result {
            applog::write(&format!("Extract failed: {} - {e}", item.name));
            return Err(format!("{}: {e}", item.name));
        }

        fs::remove_file(&exe).map_err(|e| format!("{}: could not delete the archive: {e}", item.name))?;
        applog::write(&format!("Extracted into {} and deleted the archive", dir.display()));
        extracted.push(dir.display().to_string());
    }
    applog::write("Extract finished");
    Ok(extracted)
}

fn target_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().download_dir().map_err(|e| format!("No Downloads folder: {e}"))?;
    let folder = dir.join("Caseware Installer");
    fs::create_dir_all(&folder).map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
    Ok(folder)
}

/// One entry in myapps.json, which lists the downloaded products.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub product_id: String,
    pub version: String,
    pub name: String,
}

/// Adds the downloaded products to myapps.json in the Caseware Installer folder. An entry with the
/// same product id is replaced, so the file keeps one entry per product.
fn read_myapps(folder: &Path) -> Vec<InstalledApp> {
    fs::read_to_string(folder.join("myapps.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Products downloaded and waiting for install, from myapps.json.
#[tauri::command]
pub fn pending_apps(app: AppHandle) -> Result<Vec<InstalledApp>, String> {
    let folder = target_folder(&app)?;
    Ok(read_myapps(&folder))
}

fn write_myapps(folder: &Path, items: &[DownloadItem]) -> Result<(), String> {
    let path = folder.join("myapps.json");
    let mut apps = read_myapps(folder);
    for item in items {
        let entry = InstalledApp {
            product_id: item.product_id.clone(),
            version: item.version.clone(),
            name: item.name.clone(),
        };
        match apps.iter_mut().find(|a| a.product_id == entry.product_id) {
            Some(existing) => *existing = entry,
            None => apps.push(entry),
        }
    }
    let text = serde_json::to_string_pretty(&apps).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// Where the downloads went: the Caseware Installer folder and each saved file.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub folder: String,
    pub files: Vec<String>,
}

/// Downloads every item in order. Stops at the first failure and reports which product failed.
#[tauri::command]
pub async fn download_products(app: AppHandle, items: Vec<DownloadItem>) -> Result<DownloadOutcome, String> {
    let folder = target_folder(&app)?;
    let count = items.len();
    let mut saved = Vec::with_capacity(count);

    applog::write(&format!("Download started: {count} product(s)"));
    for (index, item) in items.iter().enumerate() {
        let key = storage_key(item);
        applog::write(&format!("Download {}/{count}: {key}", index + 1));
        let url = signed_url(SIGNED_URL_ENDPOINT, &key).await.map_err(|e| {
            applog::write(&format!("Download failed (signed link): {} - {e}", item.name));
            format!("{}: {e}", item.name)
        })?;

        let dir = folder.join(folder_name(item));
        fs::create_dir_all(&dir)
            .map_err(|e| format!("{}: could not create {}: {e}", item.name, dir.display()))?;
        let dest = dir.join(file_name(item));
        let handle = app.clone();
        let product_id = item.product_id.clone();
        let result = download(&url, &dest, None, move |downloaded, total| {
            let _ = handle.emit(
                "download-progress",
                Progress { product_id: product_id.clone(), index, count, downloaded, total },
            );
        })
        .await;

        if let Err(e) = result {
            let _ = fs::remove_file(&dest);
            applog::write(&format!("Download failed: {} - {e}", item.name));
            return Err(format!("{}: {e}", item.name));
        }
        applog::write(&format!("Saved {}", dest.display()));
        saved.push(dest.display().to_string());
    }
    if let Err(e) = write_myapps(&folder, &items) {
        applog::write(&format!("Could not update myapps.json: {e}"));
    }
    applog::write("Download finished");
    Ok(DownloadOutcome { folder: folder.display().to_string(), files: saved })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(name: &str, version: &str) -> DownloadItem {
        DownloadItem {
            product_id: "abc-123".into(),
            name: name.into(),
            version: version.into(),
        }
    }

    #[test]
    fn builds_the_storage_key_from_name_version_and_id() {
        assert_eq!(
            storage_key(&item("Caseware Connector", "2026.00.003")),
            "products/Caseware Connector/versions/2026.00.003/abc-123.exe"
        );
    }

    #[test]
    fn folder_is_named_after_the_product_without_forbidden_characters() {
        assert_eq!(
            folder_name(&item("SME (English) incl. XBRL", "1.0")),
            "SME (English) incl. XBRL"
        );
        assert_eq!(folder_name(&item("A/B:C.", "1.0")), "A_B_C");
    }

    #[test]
    fn myapps_keeps_one_entry_per_product_and_updates_it() {
        let dir = std::env::temp_dir().join(format!("myapps-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut first = item("Caseware Connector", "2026.00.003");
        write_myapps(&dir, std::slice::from_ref(&first)).unwrap();
        let mut other = item("SME (English) incl. XBRL", "2026_1 [Probe]hb");
        other.product_id = "def-456".into();
        write_myapps(&dir, std::slice::from_ref(&other)).unwrap();
        first.version = "2026.00.004".into();
        write_myapps(&dir, std::slice::from_ref(&first)).unwrap();

        let apps: Vec<InstalledApp> =
            serde_json::from_str(&fs::read_to_string(dir.join("myapps.json")).unwrap()).unwrap();
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].version, "2026.00.004");
        assert_eq!(apps[0].product_id, "abc-123");
        assert_eq!(apps[0].name, "Caseware Connector");
    }

    #[test]
    fn password_is_the_sha1_hex_of_the_product_id() {
        assert_eq!(
            sfx_password("s2j9syz1-cxhpknjr-k24q1adx-o26uu300"),
            "e0458f46eed76c5b6071d8f08c8b8e30854806cf"
        );
    }

    #[test]
    fn names_the_file_after_the_product_id() {
        assert_eq!(
            file_name(&item("SME (English) incl. XBRL", "2026_1 [Probe]hb")),
            "abc-123.exe"
        );
    }
}
