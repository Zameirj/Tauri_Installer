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
    #[serde(default)]
    pub licences: Vec<Licence>,
}

/// The licence tag and the organisations it belongs to; the rest of the licence object is ignored.
/// Organisations appear on the licence directly or inside its bundles, depending on the product.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Licence {
    #[serde(default)]
    pub tag_name: Option<String>,
    #[serde(default)]
    pub organisations: Vec<Organisation>,
    #[serde(default)]
    pub bundles: Vec<Bundle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    #[serde(default)]
    pub organisations: Vec<Organisation>,
}

/// Only the name is kept, for the banner. Codes in the API's organisation object are not passed on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Organisation {
    #[serde(default)]
    pub name: Option<String>,
}

/// The code is appended to the URL, so only letters, digits and hyphens are allowed.
fn is_safe_download_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 64
        && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[tauri::command]
async fn get_org_products(download_code: String) -> Result<Vec<OrgProduct>, String> {
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
        .invoke_handler(tauri::generate_handler![get_org_products])
        .run(tauri::generate_context!())
        .expect("error while running Caseware Installer");
}
