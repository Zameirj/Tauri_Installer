---
name: setup-installer-ui
description: UI rules for the Caseware Installer Angular Material app (registration form, product list with grouping, search and highlighting, fixed header layout). Use when adding or changing any screen, control, list, search, badge or layout in this repo.
---

# Caseware Installer UI

Follow these rules when changing `src/app/`. They describe what the UI already does, so new work stays consistent. The full behaviour is in [README.md](../../../README.md).

## Stack and conventions

- Angular 22 standalone components, signals (`signal`, `computed`), reactive forms, and `@if` / `@for` control flow. No NgModules.
- Angular Material 22 with the magenta palette (violet tertiary). Use Material components (`mat-form-field`, `mat-stroked-button`, `mat-checkbox`, `mat-icon`, `mat-progress-spinner`) before writing custom controls.
- The look follows `wire-frames/dark-Modern Caseware Software Setup Installer.png` (dark) and `wire-frames/Modern Caseware Software Setup Installer.png` (light): glass panels, pink-to-blue brand gradient, pill buttons.
- Brand colours come from `wire-frames/Installer_Design_Assets/styles/palette.json` (pink `#ec25b4`, violet `#7736ed`, blue `#3865f5`). Background art is `public/bg-waves.svg` and `public/banner-skyline.svg`. Banner logos are `public/logos/*.png`; the `-dark` variants (white text) load via `<picture>` in dark mode.
- App styles live in `src/app/app.scss`, loaded globally from `styles.scss` and scoped under `app-root` (they override Material controls and exceed the 4 kB component budget). The component has no `styleUrl`.
- Theme colours are custom properties on `app-root` using `light-dark()`, so both themes work. Type from Material tokens (`var(--mat-sys-*)`). Restyle Material controls with `mat.button-overrides` / `mat.form-field-overrides`, not by targeting internal classes.
- Icons: Material filled icons via `<mat-icon>name</mat-icon>`. Use the icon's name exactly as Material lists it.
- Backend calls go through Rust commands and `ApiService`, never through `HttpClient`, so requests avoid webview CORS limits.
- Keep Angular's style budget in mind (component styles warn at 4 kB).

## Layout

- `app-root` is a 100vh flex column: the header (`.bar`), then `main`.
- `main` holds `.top` (steps and the brand `.banner`, never scrolls), `.panel` (glass card; only its `.content` scrolls) and `footer.actions` (never scrolls).
- Navigation buttons live in `footer.actions`: Back as an outlined `.pill` on the left, the primary action as a gradient `mat-flat-button.cta` on the right. Never put them in the scrolling content.
- Screen 1 footer: only **Next** on the right, its spinner beside it, not inside it.
- Screen 2 footer: Back (left), the product/selected/matching summary (centre), Download (n selected) (right).
- Screen 2 `.toolbar` sits at the top of the panel: pill search field (left), spacer, Select all (`.pill.accent`), Select none (`.pill`).
- Content width is 1200px max, centred, with 24px side padding.
- The minimum window size is 900 × 640. Nothing should need horizontal scrolling at that size.

## Steps header

- Three steps: 1 Registration, 2 My Software, 3 Install/Distribution. Their names are the `STEPS` constant in `app.ts`.
- Circles with the label underneath. `currentStep` is derived from `screen()`. Completed and current steps are filled with the pink-violet gradient (the current one glows); future steps are outlined. Lines between completed steps use the gradient.
- Step 3 has no screen yet. Do not link to it until it exists.

## Screen 1: Registration

- Fields in order: Download code, Email, then the EULA checkbox.
- Download code: required and must match `xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx` (case-insensitive).
- Email: required and must match the `EMAIL_PATTERN` in `app.ts`. Do not switch back to `Validators.email`; it accepts `z@z`.
- EULA checkbox: `requiredTrue`. Its link opens `EULA_URL` with `openUrl` from `@tauri-apps/plugin-opener` and must stop the click from toggling the checkbox.
- Next is disabled while `loading() || form.invalid`. Validation messages appear only after the field is touched (`markAllAsTouched` on submit).
- Errors from the API show in a `.error` paragraph with `role="alert"`, above the Next row or below the EULA checkbox.

## Screen 2: My Software

### Grouping

- Groups appear in this fixed order: `cwi`, `other`, `tmpl`, `custom`. Unknown types follow, in the order they first appear.
- Each group heading (`.group-title`) is left-aligned with a coloured bar before it. The bar colour depends on the type:
  - `cwi` pink `#ff2d87`
  - `other` blue `#5ea0ff`
  - `tmpl` purple `#a855f7`
  - `custom` amber `#ffb361`
- Products inside a group are sorted by name with `localeCompare`.
- Type labels come from `PRODUCT_TYPE_LABELS`. Add new types there and to `PRODUCT_TYPE_ORDER` when the API adds them.

### Rows

- Each row is one rounded card `li` with a `mat-checkbox` (flex 1) and, for `tmpl` only, licence tags on the right. Selected rows get a pink border (`.selected`).
- Inside the checkbox label: a gradient icon tile (`.tile-0` to `.tile-5`, chosen by `tileColour` from the product id) holding `productIcon` (keyword in `PRODUCT_ICONS`, else `PRODUCT_TYPE_ICONS`), then the text.
- The name is on the first line with the optional red "New!" chip (`.chip.new`). The version is on the second line in `body-small`.
- Licence tags (`.tag`) are outlined pills. They wrap and take at most 60% of the row, so the name never gets squashed.
- Tag text has double spaces collapsed (`licenceTags`).
- Do not add new columns or badges without asking; the layout is tuned for 900px.

### Search

- The search is an always-visible pill input (`.search`, 420px max) at the left of the panel toolbar.
- Escape or the × button (shown only when there is text) clears the query. An empty query leaves no highlights.
- Matching uses `fuzzyPositions`: every typed word must appear in the product **name** as a subsequence, in any order. Words are split on whitespace and lower-cased.
- Only the name is searched. Do not add version, type or tags without asking.
- A matching row gets the `.match` class: blue background `#1f4e87` with white text.
- Matched letters inside the name are wrapped in `<mark class="hit">`: yellow `#ffd54f`, dark text, bold.
- Rows that do not match stay visible. Search filters nothing.
- The footer summary shows "N matching" only when the query is not empty.

### Selection and actions

- Selection is by `productId` in a `Set`, replaced rather than mutated so signals update.
- **Select all** and **Select none** act on all products, not only visible or matching ones.
- **Download (n selected)** is disabled at 0 and always shows the number selected. Its action is a placeholder. Replace it only once the download behaviour is agreed.

## Messages and feedback

- Inline errors for forms and API failures: `.error` paragraph with an icon.
- Transient confirmations: `MatSnackBar`, 4 seconds, with an OK action.
- Empty state: `.empty` paragraph inside the list panel. Do not show empty tables.

## Checklist before finishing a UI change

1. `pnpm build` passes with no warnings about the style budget.
2. The fixed header stays put when the list scrolls.
3. The Next or Download button is still in the toolbar at the top.
4. The app works at 900 × 640 and at 1377 × 835 without horizontal scrolling.
5. Light and dark themes both read clearly (the highlight colours are fixed, so check them on both).
6. New text uses sentence case, and the app is called "Caseware Installer" everywhere (header, window title, page title).
