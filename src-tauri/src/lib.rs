mod applog;
mod products;
mod update;

use serde::{Deserialize, Serialize};
use std::time::Duration;

const ORG_PRODUCTS_URL: &str =
    "https://api.prod.casewareafrica.com/api/organisations/orgProducts/byDownloadCode/";

/// One product the organisation may download. Only the fields the UI needs are kept.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgProduct {
    pub product_id: String,
    pub name: String,
    pub version: String,
    /// Raw API value: "cwi", "tmpl", ...
    #[serde(rename = "type", default)]
    pub product_type: String,
    /// Badge text such as "New!", when the product has one.
    #[serde(default)]
    pub notification: Option<String>,
    /// Longer text shown in the info tooltip, when the API sends one.
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub licences: Vec<Licence>,
    #[serde(default)]
    pub versions: Vec<ProductVersion>,
}

/// One released version of a product. `size` (bytes, as text) is checked after the download.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductVersion {
    /// Matches the product's `version`, e.g. "2026.00.003".
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub size: Option<String>,
}

/// Only the licence tag is needed; the rest of the licence object is ignored.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Licence {
    #[serde(default)]
    pub tag_name: Option<String>,
}

/// The code is appended to the URL, so only letters, digits and hyphens are allowed.
fn is_safe_download_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 64
        && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[tauri::command]
async fn get_org_products(download_code: String) -> Result<Vec<OrgProduct>, String> {
    let result = fetch_org_products(&download_code).await;
    match &result {
        Ok(products) => applog::write(&format!("Loaded {} product(s) for the download code", products.len())),
        Err(e) => applog::write(&format!("Product list failed: {e}")),
    }
    result
}

async fn fetch_org_products(download_code: &str) -> Result<Vec<OrgProduct>, String> {
    let code = download_code.trim();
    if !is_safe_download_code(code) {
        return Err("The download code contains characters that are not allowed.".into());
    }

    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?
        .get(format!("{ORG_PRODUCTS_URL}{code}"))
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Could not reach the server: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("The server answered {status}. Check the download code and try again."));
    }

    response
        .json::<Vec<OrgProduct>>()
        .await
        .map_err(|e| format!("The server sent an unexpected response: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_org_products,
            update::check_for_update,
            update::install_update,
            products::download_products
        ])
        .setup(|app| {
            applog::write(&format!("Caseware Installer {} started", app.package_info().version));
            update::cleanup_old();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Caseware Installer");
}
