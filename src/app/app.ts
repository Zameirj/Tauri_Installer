import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  ViewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ApiService,
  DownloadItem,
  DownloadProgress,
  OrgProduct,
  UpdateInfo,
  UpdateProgress,
} from './api.service';
import { compareVersions, UPDATE_CHECK_URL, UPDATE_FILE_KEY, UPDATE_SIGNED_URL_ENDPOINT } from './update-config';

const EULA_URL =
  'https://webcontent.casewareafrica.com/CaseWare_Community/My%20Account%20Docs/CWA%20EULA.pdf';

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  cwi: 'Caseware Application',
  tmpl: 'Template',
  other: 'Other',
  custom: 'Custom',
};

/** Steps shown in the header. Only the first two screens exist so far. */
const STEPS = ['Registration', 'My Software', 'Install/Distribution'];

/** Order in which the type groups appear on screen 2. Unknown types follow at the end. */
const PRODUCT_TYPE_ORDER = ['cwi', 'other', 'tmpl', 'custom'];

interface ProductGroup {
  type: string;
  label: string;
  products: OrgProduct[];
}

/**
 * Finds `query` in `text` as a fuzzy match: every character of `query` must appear in `text`
 * in the same order, e.g. "smesync" matches "SME ... SmartSync". Returns the indexes of the
 * matched characters, or null when there is no match.
 */
function fuzzyPositions(query: string, text: string): number[] | null {
  const positions: number[] = [];
  let next = 0;
  for (let i = 0; i < text.length && next < query.length; i++) {
    if (text[i] === query[next]) {
      positions.push(i);
      next++;
    }
  }
  return next === query.length ? positions : null;
}

interface NamePart {
  text: string;
  hit: boolean;
}

/** Format of a download code, e.g. abcd1234-efgh5678-ijkl9012-mnop3456 */
const DOWNLOAD_CODE_PATTERN = /^[a-z0-9]{8}(-[a-z0-9]{8}){3}$/i;

/**
 * Requires a local part, an @, and a domain with at least one dot and a 2+ letter ending,
 * e.g. name@company.com. Angular's built-in Validators.email accepts "z@z".
 */
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

@Component({
  selector: 'app-root',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  readonly form = new FormGroup({
    downloadCode: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(DOWNLOAD_CODE_PATTERN)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(EMAIL_PATTERN)],
    }),
    acceptEula: new FormControl(false, {
      nonNullable: true,
      validators: [Validators.requiredTrue],
    }),
  });

  /** Version from tauri.conf.json, shown in the header as in Import Centre. */
  readonly appVersion = signal('');

  /** Set when the version endpoint reports a newer release. The UI blocks until it is installed. */
  readonly availableUpdate = signal<UpdateInfo | null>(null);
  readonly updating = signal(false);
  readonly updateProgress = signal<UpdateProgress | null>(null);
  readonly updateError = signal('');
  readonly updateSavedTo = signal('');
  readonly progressPct = computed(() => {
    const p = this.updateProgress();
    return p?.total ? Math.round((p.downloaded * 100) / p.total) : null;
  });
  readonly progressText = computed(() => {
    const p = this.updateProgress();
    if (!p) return 'Contacting the download service...';
    const mb = (n: number) => (n / 1048576).toFixed(1);
    return p.total ? `${mb(p.downloaded)} of ${mb(p.total)} MB` : `${mb(p.downloaded)} MB`;
  });

  readonly screen = signal<'details' | 'products'>('details');
  readonly steps = STEPS;
  readonly currentStep = computed(() => (this.screen() === 'details' ? 0 : 1));
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly products = signal<OrgProduct[]>([]);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly selectedCount = computed(() => this.selected().size);

  /** Download of the selected products, one file at a time. */
  readonly downloading = signal(false);
  readonly downloadProgress = signal<DownloadProgress | null>(null);
  readonly downloadError = signal('');
  readonly downloadPct = computed(() => {
    const p = this.downloadProgress();
    return p?.total ? Math.round((p.downloaded * 100) / p.total) : null;
  });
  readonly downloadStatus = computed(() => {
    const p = this.downloadProgress();
    if (!p) return 'Starting...';
    const name = this.products().find((x) => x.productId === p.productId)?.name ?? '';
    const mb = (n: number) => (n / 1048576).toFixed(1);
    const size = p.total ? ` of ${mb(p.total)} MB` : '';
    return `${p.index + 1} of ${p.count}: ${name} (${mb(p.downloaded)}${size})`;
  });

  /** Text typed in the product search. Each word must fuzzy-match the product name (any order). */
  readonly query = signal('');

  /** The search box is collapsed to an icon until it is opened. */
  readonly searchOpen = signal(false);

  /** Lower-cased words typed in the search. */
  readonly searchTerms = computed(() =>
    this.query().trim().toLowerCase().split(/\s+/).filter(Boolean),
  );

  /** Ids of rows that match the search. Empty when nothing is typed. */
  readonly matchingIds = computed<ReadonlySet<string>>(() => {
    const terms = this.searchTerms();
    if (terms.length === 0) {
      return new Set();
    }
    return new Set(
      this.products()
        .filter((product) => {
          const name = product.name.toLowerCase();
          return terms.every((term) => fuzzyPositions(term, name) !== null);
        })
        .map((product) => product.productId),
    );
  });

  /** Products grouped by type in PRODUCT_TYPE_ORDER, each group sorted by name. */
  readonly groups = computed<ProductGroup[]>(() => {
    const products = this.products();
    const types = [
      ...PRODUCT_TYPE_ORDER,
      ...new Set(products.map((p) => p.type).filter((t) => !PRODUCT_TYPE_ORDER.includes(t))),
    ];
    return types
      .map((type) => ({
        type,
        label: this.productTypeLabel(type),
        products: products
          .filter((p) => p.type === type)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((group) => group.products.length > 0);
  });

  constructor() {
    getVersion()
      .then((version) => {
        this.appVersion.set(version);
        void this.checkForUpdate();
      })
      .catch(() => this.appVersion.set(''));
  }

  /** Asks the update endpoint for the latest version. Failures are silent (the app keeps working). */
  async checkForUpdate(): Promise<void> {
    if (!UPDATE_CHECK_URL) return;
    try {
      const latest = await this.api.checkForUpdate(UPDATE_CHECK_URL);
      this.availableUpdate.set(compareVersions(latest.version, this.appVersion()) > 0 ? latest : null);
    } catch (e) {
      console.warn('Update check failed', e);
    }
  }

  /** The update is mandatory: download it, swap it in and let the backend restart the app. */
  async startUpdate(): Promise<void> {
    const latest = this.availableUpdate();
    if (!latest) return;
    this.updating.set(true);
    this.updateError.set('');
    this.updateProgress.set(null);
    const unlisten = await this.api.onUpdateProgress((p) => this.updateProgress.set(p));
    try {
      const key = UPDATE_FILE_KEY.replace('{version}', latest.version);
      const result = await this.api.installUpdate(UPDATE_SIGNED_URL_ENDPOINT, key);
      if (result.savedTo) this.updateSavedTo.set(result.savedTo); // otherwise the app restarts itself
    } catch (e) {
      this.updateError.set(String(e));
    } finally {
      unlisten();
      this.updating.set(false);
    }
  }

  /** Removes leading and trailing spaces from the download code as it is typed or pasted. */
  trimDownloadCode(): void {
    const control = this.form.controls.downloadCode;
    control.setValue(control.value.trim());
  }

  async next(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    try {
      const products = await this.api.getOrgProducts(this.form.controls.downloadCode.value.trim());
      this.products.set(products);
      this.selected.set(new Set());
      this.screen.set('products');
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.loading.set(false);
    }
  }

  openEula(event: Event): void {
    // Keep the click from also toggling the checkbox that the link sits in.
    event.preventDefault();
    event.stopPropagation();
    openUrl(EULA_URL).catch((err) => this.error.set(String(err)));
  }

  back(): void {
    this.error.set(null);
    this.screen.set('details');
  }

  /** Friendly badge text for the API's product `type`; unknown values are shown as-is. */
  productTypeLabel(type: string): string {
    return PRODUCT_TYPE_LABELS[type] ?? type;
  }

  /** Licence tags shown on the right of a row. The API pads tags with double spaces, so collapse them. */
  licenceTags(product: OrgProduct): string[] {
    return product.licences
      .map((licence) => licence.tagName?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((tag) => tag.length > 0);
  }

  openSearch(): void {
    this.searchOpen.set(true);
    afterNextRender(() => this.searchInput?.nativeElement.focus(), { injector: this.injector });
  }

  /** Closes the search box and clears the text, so no rows stay highlighted. */
  closeSearch(): void {
    this.query.set('');
    this.searchOpen.set(false);
  }

  isMatch(productId: string): boolean {
    return this.matchingIds().has(productId);
  }

  /** Splits a product name into runs of matched and unmatched text, for highlighting. */
  nameParts(product: OrgProduct): NamePart[] {
    const name = product.name;
    if (!this.isMatch(product.productId)) {
      return [{ text: name, hit: false }];
    }

    const lower = name.toLowerCase();
    const hits = new Set<number>();
    for (const term of this.searchTerms()) {
      fuzzyPositions(term, lower)?.forEach((index) => hits.add(index));
    }

    const parts: NamePart[] = [];
    for (let i = 0; i < name.length; i++) {
      const hit = hits.has(i);
      const last = parts[parts.length - 1];
      if (last && last.hit === hit) {
        last.text += name[i];
      } else {
        parts.push({ text: name[i], hit });
      }
    }
    return parts;
  }

  isSelected(productId: string): boolean {
    return this.selected().has(productId);
  }

  toggle(productId: string): void {
    const next = new Set(this.selected());
    if (next.has(productId)) {
      next.delete(productId);
    } else {
      next.add(productId);
    }
    this.selected.set(next);
  }

  selectAll(): void {
    this.selected.set(new Set(this.products().map((p) => p.productId)));
  }

  selectNone(): void {
    this.selected.set(new Set());
  }

  /** Downloads each selected product in order and reports the folder the files were saved to. */
  async download(): Promise<void> {
    if (this.downloading()) return;
    const items: DownloadItem[] = this.products()
      .filter((p) => this.selected().has(p.productId))
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        version: p.version,
        size: Number(p.versions.find((v) => v.description === p.version)?.size) || null,
      }));
    if (items.length === 0) return;

    this.downloading.set(true);
    this.downloadError.set('');
    this.downloadProgress.set(null);
    const unlisten = await this.api.onDownloadProgress((p) => this.downloadProgress.set(p));
    try {
      const saved = await this.api.downloadProducts(items);
      const folder = saved[0]?.replace(/[\\/][^\\/]*$/, '') ?? '';
      this.snackBar.open(`Saved ${saved.length} file(s) to ${folder}`, 'OK', { duration: 6000 });
    } catch (e) {
      this.downloadError.set(String(e));
    } finally {
      unlisten();
      this.downloading.set(false);
    }
  }
}
