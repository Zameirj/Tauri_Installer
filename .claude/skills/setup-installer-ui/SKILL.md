---
name: setup-installer-ui
description: UI rules for the Caseware Installer Angular Material app (registration form, product list with grouping, search and highlighting, fixed header layout). Use when adding or changing any screen, control, list, search, badge or layout in this repo.
---

# Caseware Installer UI

Follow these rules when changing `src/app/`. They describe what the UI already does, so new work stays consistent. The full behaviour is in [README.md](../../../README.md).

## Stack and conventions

- Angular 22 standalone components, signals (`signal`, `computed`), reactive forms, and `@if` / `@for` control flow. No NgModules.
- Angular Material 22 with the violet palette (magenta tertiary). Use Material components (`mat-form-field`, `mat-stroked-button`, `mat-checkbox`, `mat-icon`, `mat-progress-spinner`) before writing custom controls.
- The look follows `wire-frames/Caseware Installer company-branding.png`, the same in both themes. The `.hero` is always dark with white text; the `.panel` card (brand row, toolbar, list) is always light (`color-scheme: light`), so the navy-text logos are used in both themes.
- Art: `wire-frames/banner.png` is `public/backgrounds/hero-banner.webp` on `.hero::before` (cover, `center 38%`, a navy fade on the left for the title, and 72px past the hero fading into the page). `wire-frames/background.png` is `public/backgrounds/app-background.webp` on `body` (cover, anchored to the bottom so the waves show around the card). Keep the PNGs in `wire-frames` as the sources; re-export WebP if they change.
- Colours are sampled from the wireframe and live as tokens on `app-root`: coral `--coral-gradient` for the main action (`.cta`) and the "New!" chip, violet `--violet` for checkboxes, links, focus and the info icon, `--violet-deep` for the Select all badge, `--indigo` for the organisation heading, `--ink` for text. Steps use `--step-gradient` (current) and `--done-gradient` (lines into completed steps).
- Logos: the Caseware mark is the gradient mark in `wire-frames/caseware-mark-gradient.png` (50px), enlarged to the 1024px `app-icon.png` at the project root. Regenerate the app icons from it with `pnpm tauri icon` (default input `./app-icon.png`; copy only the desktop files into `src-tauri/icons`). The hero uses `public/logos/caseware-white.png` (mark and white wordmark side by side) and the card `caseware-navy.png` (mark above the navy `#0d134e` wordmark), both drawn at 2x from that mark, plus `adaptit-navy.png`. Use this mark wherever the Caseware logo appears.
- App styles live in `src/app/app.scss`, loaded globally from `styles.scss` and scoped under `app-root` (they override Material controls and exceed the 4 kB component budget). The component has no `styleUrl`.
- Theme colours are custom properties on `app-root`. They are fixed values because the hero is always dark and the card always light. Type from Material tokens (`var(--mat-sys-*)`). Restyle Material controls with `mat.button-overrides` / `mat.form-field-overrides`, not by targeting internal classes.
- Icons: outline SVGs in `public/icons` (from the design asset pack), drawn with `<span class="glyph" style="--icon: url(/icons/name.svg)">` so they take `currentColor`. Use Material `<mat-icon>` only where the pack has no icon (error, close).
- Backend calls go through Rust commands and `ApiService`, never through `HttpClient`, so requests avoid webview CORS limits.
- Keep Angular's style budget in mind (component styles warn at 4 kB).

## Layout

- `app-root` is a 100vh flex column: the `.hero` header, then `main`.
- `.hero` holds the title lockup (an `h1` with the white Caseware logo followed by the word "installer" in lowercase, set in Archivo (bundled from `@fontsource-variable/archivo`, the closest open font to the wordmark) at weight 450, width 95% and -0.02em tracking so it matches the wordmark's letterforms, x-height, baseline and stroke; the logo is sized in em, so the `h1` font-size scales the whole lockup), the subtitle, the `v` version pill (`.app-version`, top right) and the steps tab. It never scrolls. Do not add a separate "Caseware Installer" title line back.
- `main` holds the `.panel` card. Inside it, `.brand-row` (logos, organisation, instructions) and `.toolbar` stay put and only `.content` scrolls.
- Every screen's action buttons live in the panel `.toolbar` at the top, never in the scrolling content: Back as an outlined `.pill` on the left, the primary action as a gradient `mat-flat-button.cta` on the right.
- Screen 1 toolbar: only **Next** on the right, its spinner beside it, not inside it.
- Screen 2 toolbar order: Back (`.pill`), spacer, search (magnifier circle that grows leftwards into the field), Select all (`.pill.accent`, deep violet tick badge) and Select none (`.pill.select`), both white pills, then Download (n) as a coral `.cta` with a leading download icon.
- Screen 2 shows the product/selected/matching `.summary` line at the foot of the panel.
- The card runs the full window width like the wireframe, with `clamp(20px, 2.4vw, 40px)` side padding. Windows under 720px tall get a tighter hero and brand row (media query at the end of `app.scss`).
- The minimum window size is 900 × 640. The app is Windows desktop only (WebView2). It never scrolls as a page: `App.fitToWindow()` scales the whole app with CSS `zoom` on `app-root` (re-laid out, so text stays sharp) to the largest scale at which the registration screen fits without scrolling, down to `MIN_FIT` (0.6). It re-fits on resize, font load, screen changes and form message changes. Screens 2 and 3 reuse that scale; only their product list scrolls. Keep `.register` measurable: its grid children's natural heights (`.measuring`) must reflect its content.

## Steps header

- Three steps: 1 Verification, 2 My Software, 3 Install/Distribution. Their names are the `STEPS` constant in `app.ts`.
- The steps sit in a translucent navy tab (`.steps`, rounded top corners) at the bottom of the hero, resting on the card. Each step is a white-ringed circle with the label beside it. `currentStep` is derived from `screen()`. The current step is a glowing coral circle with a bold label; lines into completed steps are pink-to-coral, lines ahead pale lavender.
- Step 3 (Install/Distribution) is the `install` screen. It opens after a download and extraction finish, and lists only the downloaded products, using the same group rows as screen 2. Its toolbar is Back, spacer, Select all, Select none and Install (n) as a `.cta` (no search). The banner text changes to ask what to install. Install is a placeholder until the run logic is defined.

## Screen 1: Verification

- Fields in order: Download code, Email, then the EULA checkbox.
- Download code: required and must match `xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx` (case-insensitive).
- Email: required and must match the `EMAIL_PATTERN` in `app.ts`. Do not switch back to `Validators.email`; it accepts `z@z`.
- EULA checkbox: `requiredTrue`. Its link opens `EULA_URL` with `openUrl` from `@tauri-apps/plugin-opener` and must stop the click from toggling the checkbox.
- Next is disabled while `loading() || form.invalid`. Validation messages appear only after the field is touched (`markAllAsTouched` on submit).
- Errors from the API show in a `.error` paragraph with `role="alert"`, below the EULA checkbox.
- Layout: `.content.register` is a single centred column: `.register-form` (white outlined fields with `key` / `mail` glyphs as `matIconPrefix`; field height and shape set with `mat.form-field-overrides`) and the `.notify` banner under it (max 760px wide). There is no welcome/feature panel; do not add one back without asking. Next stays in the toolbar at the top right, as on the other screens. The content is centred vertically on large windows and never scrolls (see `fitToWindow()`).
- Notifications banner (`.notify`): background `public/backgrounds/notifications-banner.webp`, made from `wire-frames/correct-banner.png` with its divider, heading, text, sample QR code and caption removed (keep the phone, bell tile and waves; exported 1300px wide). The heading ("Get the" / "Caseware Notifications App" in pink-to-purple), the text, the QR code and "Scan to Download" are HTML. Always use the genuine QR code (`public/caseware-mobile-qr.svg`, opens https://mobile.prod.casewareafrica.com/), never the sample one from the image. Its centre logo is an embedded PNG (6 x 6 modules) showing the gradient mark on a white tile; if you change it, keep the same size and check the code still decodes. The mark on the phone in the banner art is also the gradient mark. The bell tile has no logo badge on its corner (it was painted out); do not add one back. It is a size container: text scales with `cqw`, and under 600px wide the artwork is enlarged and anchored right so the phone drops out.

## Screen 2: My Software

- The brand row heading shows `organisationName()` (first `licences[].organisations[].name` or `licences[].bundles[].organisations[].name`), falling back to "Caseware Africa, A Division of Adapt IT (Pty) Ltd" when none is found, on screens 2 and 3. Screen 1 shows "Welcome to the Caseware Installer" with "Enter your download code and email address to access your licensed Caseware software." instead.

### Grouping

- Groups appear in this fixed order: `cwi`, `other`, `tmpl`, `custom`. Unknown types follow, in the order they first appear.
- Each group heading (`.group-title`) is left-aligned with a coloured bar before it. The bar colour depends on the type:
  - `cwi` pink-red `#f82a71`
  - `other` blue `#1681fd`
  - `tmpl` purple `#a223dd`
  - `custom` amber `#ffb361`
- Products inside a group are sorted by name with `localeCompare`.
- Type labels come from `PRODUCT_TYPE_LABELS`. Add new types there and to `PRODUCT_TYPE_ORDER` when the API adds them.

### Rows

- Each row is one rounded card `li` with a `mat-checkbox` (flex 1) and, for `tmpl` only, licence tags on the right. Selected rows get a faint violet border (`.selected`).
- Inside the checkbox label: only the text, no product icon. Do not add icons back without asking.
- The name is on the first line in regular weight (not bold) with the optional coral "New!" chip (`.chip.new`). The version is on the second line.
- Licence tags (`.tag`) are white pills fading to a hint of lavender (`#fbfbff` to `#e8ecfa`), with a soft periwinkle `#a5a8d6` outline and dark text, as in the company-branding wireframe. They wrap and take at most 60% of the row, so the name never gets squashed.
- Tag text has double spaces collapsed (`licenceTags`).
- Do not add new columns or badges without asking; the layout is tuned for 900px.

### Search

- The search is one `.search` element just before Select all: a 40px circle with the centred magnifier (`.search-icon`, a plain button so Material padding doesn't offset it) that grows into the pill field (`.open`, 380px) and focuses it. Opening uses emphasized-decelerate easing over 420ms with the text fading in slightly behind; closing is a quicker 220ms accelerate. Motion is off under `prefers-reduced-motion`. The field collapses back to the button when it loses focus while empty, or on Escape when empty; it stays open while there is text.
- Escape (when there is text) or the × button (shown only when there is text) clears the query. An empty query leaves no highlights.
- Matching uses `fuzzyPositions`: every typed word must appear in the product **name** as a subsequence, in any order. Words are split on whitespace and lower-cased.
- Only the name is searched. Do not add version, type or tags without asking.
- A matching row gets the `.match` class: blue background `#1f4e87` with white text.
- Matched letters inside the name are wrapped in `<mark class="hit">`: yellow `#ffd54f`, dark text, bold.
- Rows that do not match stay visible. Search filters nothing.
- The summary line shows "N matching" only when the query is not empty.

### Selection and actions

- Selection is by `productId` in a `Set`, replaced rather than mutated so signals update.
- **Select all** and **Select none** act on all products, not only visible or matching ones.
- **Download (n)** is disabled at 0 and always shows the number selected. It downloads the selected products one at a time through `download_products` (Rust, `products.rs`). Each file's storage key is `products/{name}/versions/{version}/{productId}.exe`, and it is saved to Downloads under `Caseware Installer`. A coral progress bar and status line (`.progress`) sit under the toolbar while it runs, inside the panel. The button is disabled during a download.

## Messages and feedback

- Inline errors for forms and API failures: `.error` paragraph with an icon.
- Transient confirmations: `MatSnackBar`, 4 seconds, with an OK action.
- Empty state: `.empty` paragraph inside the list panel. Do not show empty tables.

## Checklist before finishing a UI change

1. `pnpm build` passes with no warnings about the style budget.
2. The hero, brand row and toolbar stay put when the list scrolls.
3. The Next or Download button is still in the toolbar at the top.
4. The registration screen shows everything with no scrollbar at 900 × 640, 1125 × 800 and a maximised window (check the zoom `fitToWindow()` picks), and nothing scrolls sideways.
5. Light and dark themes both read clearly (the highlight colours are fixed, so check them on both).
6. New text uses sentence case, and the app is called "Caseware Installer" in the window and page titles. The header shows it as the lowercase "caseware installer" lockup.

## Zam's features in this look

- **Update blocker**: when the version endpoint reports a newer release, `.blocker` covers the app (blurred navy veil) with a light `.blocker-card` and a coral `.cta` Update now button. It can't be dismissed.
- **Locked rows**: products already downloaded (`myapps.json`) are ticked, disabled and get `li.locked` (flatter, no shadow) on screen 2.
- **Info icon**: products with a `description` show a small violet `mat-icon.info` after the name with a `matTooltip` (`matTooltipClass="info-bubble"`, opens above). It is styled in `styles.scss` (the overlay is outside `app-root`) as a white speech bubble: violet left accent, soft shadow, a tail pointing at the icon, Segoe UI Variable Text at 13.5px, up to 560px wide so long text stays short.
- **QR code**: Zam's genuine `caseware-mobile-qr.svg`, shown on a white tile in the notifications banner on screen 1.
- Zam's brand styling (dark-only theme, League Spartan, `--brand-*` tokens, `button.brand`, coral panel border) is **not** used; this look replaces it.
