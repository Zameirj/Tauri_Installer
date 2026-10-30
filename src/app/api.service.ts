import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export interface UpdateInfo {
  version: string;
  downloadUrl: string | null;
  notes: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface OrgProduct {
  productId: string;
  name: string;
  version: string;
  /** Raw API value: 'cwi', 'tmpl', ... */
  type: string;
  notification: string | null;
  description: string | null;
  licences: OrgLicence[];
  versions: OrgProductVersion[];
}

export interface OrgProductVersion {
  /** Matches OrgProduct.version, e.g. '2026.00.003'. */
  description: string;
  /** File size in bytes, sent as text by the API. */
  size: string | null;
}

export interface DownloadItem {
  productId: string;
  name: string;
  version: string;
  size: number | null;
}

export interface DownloadProgress {
  productId: string;
  /** Zero-based position of this product in the selection. */
  index: number;
  count: number;
  downloaded: number;
  total: number | null;
}

export interface OrgLicence {
  tagName: string | null;
}

/** Calls the Rust side, which talks to the Caseware API (no CORS in the webview). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  getOrgProducts(downloadCode: string): Promise<OrgProduct[]> {
    return invoke<OrgProduct[]>('get_org_products', { downloadCode });
  }

  checkForUpdate(url: string): Promise<UpdateInfo> {
    return invoke<UpdateInfo>('check_for_update', { url });
  }

  /** Downloads the new exe, swaps it in and restarts. Resolves with savedTo when it could not replace itself. */
  installUpdate(endpoint: string, key: string): Promise<{ savedTo: string | null }> {
    return invoke<{ savedTo: string | null }>('install_update', { endpoint, key });
  }

  onUpdateProgress(handler: (p: UpdateProgress) => void): Promise<UnlistenFn> {
    return listen<UpdateProgress>('update-progress', (e) => handler(e.payload));
  }

  /** Downloads the items one after another. Resolves with the saved file paths. */
  downloadProducts(items: DownloadItem[]): Promise<string[]> {
    return invoke<string[]>('download_products', { items });
  }

  onDownloadProgress(handler: (p: DownloadProgress) => void): Promise<UnlistenFn> {
    return listen<DownloadProgress>('download-progress', (e) => handler(e.payload));
  }
}
