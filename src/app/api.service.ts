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
}
