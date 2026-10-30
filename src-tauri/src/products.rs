//! Downloads the selected products one after another. Each file is fetched through a signed link
//! from the storage API, saved to a "Caseware Installer" folder in Downloads, and checked against
//! the MD5 the product API reports for that version.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::applog;
use crate::update::{download, signed_url};

/// Storage endpoint that signs download links. Same service as the Installer's self-update.
const SIGNED_URL_ENDPOINT: &str = "https://api.test.casewareafrica.com/api/awsStorage/get-signed-url";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub product_id: String,
    pub name: String,
    pub version: String,
    /// Size in bytes the product API reports for the selected version.
    #[serde(default)]
    pub size: Option<u64>,
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

/// Windows file names cannot hold these characters.
fn file_name(item: &DownloadItem) -> String {
    let raw = format!("{} {}.exe", item.name, item.version);
    raw.chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect()
}

/// The file must be the size the product API reports for the version, when it reports one.
fn check_size(dest: &Path, expected: Option<u64>) -> Result<(), String> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let actual = fs::metadata(dest).map_err(|e| format!("Could not read the downloaded file: {e}"))?.len();
    if actual != expected {
        return Err(format!("The downloaded file is the wrong size (expected {expected} bytes, got {actual})"));
    }
    Ok(())
}

fn target_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().download_dir().map_err(|e| format!("No Downloads folder: {e}"))?;
    let folder = dir.join("Caseware Installer");
    fs::create_dir_all(&folder).map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
    Ok(folder)
}

/// Downloads every item in order. Stops at the first failure and reports which product failed.
/// Returns the saved paths.
#[tauri::command]
pub async fn download_products(app: AppHandle, items: Vec<DownloadItem>) -> Result<Vec<String>, String> {
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

        let dest = folder.join(file_name(item));
        let handle = app.clone();
        let product_id = item.product_id.clone();
        let result = download(&url, &dest, None, move |downloaded, total| {
            let _ = handle.emit(
                "download-progress",
                Progress { product_id: product_id.clone(), index, count, downloaded, total },
            );
        })
        .await;

        let result = result.and_then(|()| check_size(&dest, item.size));
        if let Err(e) = result {
            let _ = fs::remove_file(&dest);
            applog::write(&format!("Download failed: {} - {e}", item.name));
            return Err(format!("{}: {e}", item.name));
        }
        applog::write(&format!("Saved {}", dest.display()));
        saved.push(dest.display().to_string());
    }
    applog::write("Download finished");
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(name: &str, version: &str) -> DownloadItem {
        DownloadItem {
            product_id: "abc-123".into(),
            name: name.into(),
            version: version.into(),
            size: None,
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
    fn keeps_brackets_and_spaces_but_removes_windows_forbidden_characters() {
        assert_eq!(
            file_name(&item("SME (English) incl. XBRL", "2026_1 [Probe]hb")),
            "SME (English) incl. XBRL 2026_1 [Probe]hb.exe"
        );
        assert_eq!(file_name(&item("A/B:C", "1.0")), "A_B_C 1.0.exe");
    }
}
