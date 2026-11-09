import {
  ApplicationRef,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
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
const STEPS = ['Verification', 'My Software', 'Install/Distribution'];

type Screen = 'details' | 'products' | 'install';

/** A notification: a short message, an optional detail line (e.g. a folder) and its kind. */
interface Toast {
  id: number;
  message: string;
  detail?: string;
  kind: 'success' | 'info';
}

/** How long Next waits before covering the window with the loading screen. */
const LOADER_DELAY = 200;

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

/** Smallest scale fitToWindow() draws the app at; below it the registration area scrolls instead. */
const MIN_FIT = 0.6;

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
    MatTooltipModule,
  ],
  templateUrl: './app.html',
})
export class App {
  private readonly api = inject(ApiService);
  private readonly appRef = inject(ApplicationRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Window height the registration screen needs at full size, measured by fitToWindow(). */
  private registrationHeight = 0;
  private fitFrame = 0;

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

  readonly screen = signal<Screen>('details');
  readonly steps = STEPS;
  readonly currentStep = computed(() => (this.screen() === 'details' ? 0 : this.screen() === 'products' ? 1 : 2));
  readonly loading = signal(false);
  /**
   * The notification at the bottom of the window (one at a time; a new one replaces it). Our own
   * rather than MatSnackBar, which removes itself 200ms into closing and can't fade out slowly.
   * Held in a list so `@for ... track id` fades the old one out while a replacement fades in.
   */
  readonly toasts = signal<readonly Toast[]>([]);
  private toastId = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private toastDuration = 0;

  /** The full-window loading screen while Next waits (see next()). */
  readonly showLoader = signal(false);
  readonly error = signal<string | null>(null);
  readonly products = signal<OrgProduct[]>([]);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly selectedCount = computed(() => this.selected().size);

  /**
   * Name of the organisation the download code belongs to, shown in the banner on screen 2.
   * Taken from the first licence that lists an organisation, directly or through a bundle;
   * some licences (e.g. Data Store tool) list none.
   */
  readonly organisationName = computed(() => {
    for (const product of this.products()) {
      for (const licence of product.licences) {
        const organisations = [
          ...(licence.organisations ?? []),
          ...(licence.bundles ?? []).flatMap((bundle) => bundle.organisations ?? []),
        ];
        const name = organisations.find((org) => org.name?.trim())?.name?.trim();
        if (name) {
          return name;
        }
      }
    }
    return null;
  });

  /** Download of the selected products, one file at a time. */
  readonly downloading = signal(false);
  readonly downloadProgress = signal<DownloadProgress | null>(null);
  readonly downloadError = signal('');
  readonly downloadPct = computed(() => {
    const p = this.downloadProgress();
    return p?.total ? Math.round((p.downloaded * 100) / p.total) : null;
  });
  readonly extracting = signal(false);

  /** Products downloaded and waiting for install, from myapps.json. Their rows on the products screen are locked. */
  readonly downloadedIds = signal<ReadonlySet<string>>(new Set());
  /** The product selection is restored on Back from step 3. */
  private savedSelection: ReadonlySet<string> = new Set();
  /** Step 3 lists the products that are waiting for install. */
  readonly listedProducts = computed(() =>
    this.screen() === 'install'
      ? this.products().filter((p) => this.downloadedIds().has(p.productId))
      : this.products(),
  );
  readonly downloadStatus = computed(() => {
    if (this.extracting()) return 'Extracting the downloaded files...';
    const p = this.downloadProgress();
    if (!p) return 'Starting...';
    const name = this.products().find((x) => x.productId === p.productId)?.name ?? '';
    const mb = (n: number) => (n / 1048576).toFixed(1);
    const size = p.total ? ` of ${mb(p.total)} MB` : '';
    return `${p.index + 1} of ${p.count}: ${name} (${mb(p.downloaded)}${size})`;
  });

  /** Text typed in the product search. Each word must fuzzy-match the product name (any order). */
  readonly query = signal('');

  /** Whether the search field is expanded. Collapsed it shows only the magnifier button. */
  readonly searchOpen = signal(false);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

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
    const products = this.listedProducts();
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
    // Products already downloaded in an earlier session stay locked and pending for install.
    this.loadDownloaded().catch((e) => console.warn('Could not read myapps.json', e));
    getVersion()
      .then((version) => {
        this.appVersion.set(version);
        void this.checkForUpdate();
      })
      .catch(() => this.appVersion.set(''));

    // Fit the app to the window (see fitToWindow): after the first render, on resize, once fonts
    // have loaded, on every screen change, and when messages change the form's height.
    afterNextRender(() => this.fitToWindow());
    const onResize = () => this.scheduleFit();
    window.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('resize', onResize));
    void document.fonts.ready.then(() => this.scheduleFit());
    effect(() => {
      this.screen();
      this.error();
      this.scheduleFit();
    });
    this.form.events.pipe(takeUntilDestroyed()).subscribe(() => this.scheduleFit());
  }

  private scheduleFit(): void {
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => this.fitToWindow());
  }

  /**
   * Scales the whole app (CSS zoom on app-root) so the registration screen fits the window with
   * no scrolling at any desktop size: full size when it fits, otherwise the largest scale that
   * fits (a binary search), but not below MIN_FIT. Zoom lays the page out again at the smaller
   * size, so text stays sharp, and the layout gets wider as it shrinks, so text wraps less.
   * Screens 2 and 3 use the scale the registration screen needs in the same window; their
   * product list scrolls as usual.
   */
  private fitToWindow(): void {
    const host = this.host.nativeElement;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const apply = (scale: number) => {
      host.style.zoom = scale === 1 ? '' : String(scale);
      host.style.width = scale === 1 ? '' : `${width / scale}px`;
      host.style.height = scale === 1 ? '' : `${height / scale}px`;
    };

    const register = host.querySelector<HTMLElement>('.content.register');
    if (!register) {
      const needed = this.registrationHeight;
      apply(needed ? Math.min(1, Math.max(MIN_FIT, height / needed)) : 1);
      return;
    }

    // Height of the registration area's content without the grid stretching it to fill.
    const natural = () => {
      register.classList.add('measuring');
      const style = getComputedStyle(register);
      const rows = Math.max(...Array.from(register.children, (child) => (child as HTMLElement).offsetHeight));
      register.classList.remove('measuring');
      return rows + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    };
    const fits = (scale: number) => {
      apply(scale);
      return natural() <= register.clientHeight + 0.5;
    };

    apply(1);
    this.registrationHeight = height - register.clientHeight + natural();
    let scale = 1;
    if (!fits(1)) {
      let low = MIN_FIT;
      let high = 1;
      if (fits(low)) {
        for (let i = 0; i < 8; i++) {
          const mid = (low + high) / 2;
          if (fits(mid)) {
            low = mid;
          } else {
            high = mid;
          }
        }
      }
      scale = low;
    }
    apply(scale);
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
    // The full loading screen appears only if the wait passes LOADER_DELAY, so a quick reply
    // goes straight to the next screen without flashing it.
    const loaderTimer = setTimeout(() => this.showLoader.set(true), LOADER_DELAY);
    const done = () => {
      clearTimeout(loaderTimer);
      this.showLoader.set(false);
      this.loading.set(false);
    };
    try {
      const products = await this.api.getOrgProducts(this.form.controls.downloadCode.value.trim());
      // The loader starts fading out in the same frame the products screen appears.
      this.changeScreen('products', () => {
        this.products.set(products);
        this.selected.set(new Set());
        done();
      });
    } catch (err) {
      this.error.set(String(err));
      done();
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
    if (this.screen() === 'install') {
      this.changeScreen('products', () =>
        this.selected.set(new Set([...this.savedSelection].filter((id) => !this.downloadedIds().has(id)))),
      );
    } else {
      this.changeScreen('details');
    }
  }

  /**
   * Moves to another screen with a soft transition of the card (View Transitions API, styled in
   * styles.scss): the card's frame cross-fades, the old content fades out and the new content
   * fades in. `update` holds the other state changes that belong to the new screen,
   * so they land in the same frame. The hero is not animated by it, so the steps run their own
   * CSS transitions. Instant under prefers-reduced-motion.
   */
  private changeScreen(next: Screen, update?: () => void): void {
    const apply = () => {
      update?.();
      this.screen.set(next);
      // Render now, so the transition captures the finished new screen.
      this.appRef.tick();
    };
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();
      return;
    }
    document.startViewTransition(apply);
  }

  /** Reads myapps.json: every product downloaded and waiting for install. */
  async loadDownloaded(): Promise<void> {
    const apps = await this.api.pendingApps();
    this.downloadedIds.set(new Set(apps.map((a) => a.productId)));
  }

  /**
   * Screen 2 with nothing new picked but products already downloaded: the toolbar offers
   * Next (n) instead of Download (0), which goes straight to step 3.
   */
  readonly offerInstall = computed(
    () => this.screen() === 'products' && this.selectedCount() === 0 && this.downloadedCount() > 0,
  );

  /** Downloaded products that are in this download code's list. */
  readonly downloadedCount = computed(
    () => this.products().filter((p) => this.downloadedIds().has(p.productId)).length,
  );

  /**
   * Text for the info popover. Downloaded rows also get the "Already downloaded" label (drawn by
   * the `downloaded` bubble class), so one without a description still has something to say.
   */
  infoText(product: OrgProduct): string {
    if (product.description) return product.description;
    return this.isLocked(product.productId)
      ? 'You have already downloaded this product, so there is no need to download it again.'
      : '';
  }

  /** Opens step 3 with every downloaded product listed and selected. */
  goToInstall(): void {
    this.savedSelection = this.selected();
    this.changeScreen('install', () => {
      this.selected.set(
        new Set(this.products().map((p) => p.productId).filter((id) => this.downloadedIds().has(id))),
      );
      this.closeSearch();
    });
  }

  /** Shows a notification; it closes itself after `duration` ms, or with OK. */
  notify(message: string, opts: { detail?: string; kind?: Toast['kind']; duration?: number } = {}): void {
    this.toasts.set([{ id: ++this.toastId, message, detail: opts.detail, kind: opts.kind ?? 'info' }]);
    this.toastDuration = opts.duration ?? 4000;
    this.startToastTimer(this.toastDuration);
  }

  dismissToast(): void {
    clearTimeout(this.toastTimer);
    this.toasts.set([]);
  }

  /** Hovering keeps the notification open; leaving gives a little more time to finish reading. */
  holdToast(): void {
    clearTimeout(this.toastTimer);
  }

  releaseToast(): void {
    this.startToastTimer(Math.min(this.toastDuration, 2500));
  }

  private startToastTimer(ms: number): void {
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toasts.set([]), ms);
  }

  /** Step 3 install action. The install logic is not defined yet. */
  install(): void {
    const n = this.selectedCount();
    this.notify("Install isn't built yet", {
      detail: `${n} ${n === 1 ? 'product' : 'products'} selected.`,
    });
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

  /** Clears the search text, so no rows stay highlighted, and keeps the field focused. */
  clearSearch(): void {
    this.query.set('');
    this.searchInput()?.nativeElement.focus();
  }

  /** Expands the search from the magnifier and puts the cursor in it. */
  openSearch(): void {
    this.searchOpen.set(true);
    this.searchInput()?.nativeElement.focus();
  }

  /** Escape clears the text first, then collapses the empty field back to the magnifier. */
  escapeSearch(): void {
    if (this.query()) {
      this.clearSearch();
    } else {
      this.searchOpen.set(false);
    }
  }

  /** Clears and collapses the search, e.g. when moving to step 3. */
  closeSearch(): void {
    this.query.set('');
    this.searchOpen.set(false);
  }

  closeSearchIfEmpty(): void {
    if (!this.query()) {
      this.searchOpen.set(false);
    }
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

  /** A downloaded product cannot be picked again on the products screen. */
  isLocked(productId: string): boolean {
    return this.screen() === 'products' && this.downloadedIds().has(productId);
  }

  isChecked(productId: string): boolean {
    return this.isSelected(productId) || this.isLocked(productId);
  }

  toggle(productId: string): void {
    if (this.isLocked(productId)) return;
    const next = new Set(this.selected());
    if (next.has(productId)) {
      next.delete(productId);
    } else {
      next.add(productId);
    }
    this.selected.set(next);
  }

  /** Selects every product that can still be downloaded (or every listed product on step 3). */
  selectAll(): void {
    const ids =
      this.screen() === 'install'
        ? this.downloadedIds()
        : this.products().map((p) => p.productId).filter((id) => !this.downloadedIds().has(id));
    this.selected.set(new Set(ids));
  }

  selectNone(): void {
    this.selected.set(new Set());
  }

  /** Downloads each selected product in order and reports the folder the files were saved to. */
  async download(): Promise<void> {
    if (this.downloading()) return;
    // Same order as the list on screen: group by group, then by name.
    const items: DownloadItem[] = this.groups()
      .flatMap((group) => group.products)
      .filter((p) => this.selected().has(p.productId))
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        version: p.version,
      }));
    if (items.length === 0) return;

    this.downloading.set(true);
    this.downloadError.set('');
    this.downloadProgress.set(null);
    const unlisten = await this.api.onDownloadProgress((p) => this.downloadProgress.set(p));
    try {
      const { folder, files } = await this.api.downloadProducts(items);
      // Step 3 starts here: extract the archives into their product folders.
      this.extracting.set(true);
      this.downloadProgress.set(null);
      const extracted = await this.api.extractProducts(items);
      const n = files.length;
      this.notify(
        `${n} ${n === 1 ? 'product' : 'products'} downloaded` +
          (extracted.length === n ? ' and extracted' : `, ${extracted.length} extracted`),
        { kind: 'success', detail: `Saved to ${folder}`, duration: 6000 },
      );
      // Step 3: every product waiting for install (from myapps.json) is listed and selected.
      this.savedSelection = this.selected();
      await this.loadDownloaded();
      this.changeScreen('install', () => {
        this.selected.set(new Set(this.downloadedIds()));
        this.closeSearch();
      });
    } catch (e) {
      this.downloadError.set(String(e));
    } finally {
      unlisten();
      this.extracting.set(false);
      this.downloading.set(false);
    }
  }
}
