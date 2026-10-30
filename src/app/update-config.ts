/**
 * Endpoint that reports the latest Caseware Installer release. It may return:
 *   - plain text:  1.0.2
 *   - a JSON string: "1.0.2"
 *   - a JSON object: { "version": "1.0.2", "downloadUrl": "https://...", "notes": "..." }
 * Called with GET and a JSON body { "productName": "<productName from tauri.conf.json>" }.
 * Leave empty to disable the update check.
 */
export const UPDATE_CHECK_URL = 'https://api.test.casewareafrica.com/api/tauri-product-version/latest'; // TODO: confirm this product is registered on the endpoint before release

/**
 * "Update now" asks this endpoint (POST { "key": ... }) for a temporary signed download link.
 * It answers { "url": "https://...", "success": true }.
 */
export const UPDATE_SIGNED_URL_ENDPOINT = 'https://api.test.casewareafrica.com/api/awsStorage/get-signed-url';

/** Storage key of the installer; {version} is replaced with the version the update check reported. */
export const UPDATE_FILE_KEY = 'tauriApps/CasewareInstaller/{version}/CasewareInstaller.exe'; // TODO: confirm the storage key

/**
 * Compares dotted versions numerically part by part (1.0.10 > 1.0.9).
 * Non-numeric parts are compared as text. Returns >0 if a is newer.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.trim().replace(/^v/i, '').split(/[.\-+]/);
  const pb = b.trim().replace(/^v/i, '').split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const diff = Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
    if (diff !== 0) return diff;
  }
  return 0;
}
