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
}

export interface DownloadItem {
  productId: string;
  name: string;
  version: string;
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
  organisations: OrgOrganisation[];
  bundles: { organisations: OrgOrganisation[] }[];
}

export interface OrgOrganisation {
  name: string | null;
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

  /** Downloads the items one after another. Resolves with the Caseware Installer folder and the saved files. */
  downloadProducts(items: DownloadItem[]): Promise<{ folder: string; files: string[] }> {
    return invoke<{ folder: string; files: string[] }>('download_products', { items });
  }

  /** Products downloaded and waiting for install, read from myapps.json. */
  pendingApps(): Promise<{ productId: string; version: string; name: string }[]> {
    return invoke<{ productId: string; version: string; name: string }[]>('pending_apps');
  }

  /** Extracts each downloaded archive into its product folder and deletes the archive. Resolves with the folders. */
  extractProducts(items: DownloadItem[]): Promise<string[]> {
    return invoke<string[]>('extract_products', { items });
  }

  onDownloadProgress(handler: (p: DownloadProgress) => void): Promise<UnlistenFn> {
    return listen<DownloadProgress>('download-progress', (e) => handler(e.payload));
  }
}
