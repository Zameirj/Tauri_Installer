import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export interface OrgProduct {
  productId: string;
  name: string;
  version: string;
  /** Raw API value: 'cwi', 'tmpl', ... */
  type: string;
  notification: string | null;
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
}
