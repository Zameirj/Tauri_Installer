---
name: setup-installer-ui
description: UI rules for the Caseware Installer Angular Material app (registration form, product list with grouping, search and highlighting, fixed header layout). Use when adding or changing any screen, control, list, search, badge or layout in this repo.
---

# Caseware Installer UI

Follow these rules when changing `src/app/`. They describe what the UI already does, so new work stays consistent. The full behaviour is in [README.md](../../../README.md).

## Stack and conventions

- Angular 22 standalone components, signals (`signal`, `computed`), reactive forms, and `@if` / `@for` control flow. No NgModules.
- Angular Material 22 with the azure palette. Use Material components (`mat-form-field`, `mat-stroked-button`, `mat-checkbox`, `mat-icon`, `mat-progress-spinner`) before writing custom controls.
- Colours and type come from Material tokens (`var(--mat-sys-*)`), so light and dark themes both work. Only the type colours and the highlight colours are fixed hex values.
- Brand (company website, League Spartan font): use the `--brand-blue`, `--brand-coral` and `--brand-card-accent` tokens on `:root` in `styles.scss`. Primary actions are `mat-flat-button class="brand"` (`button.brand`). Gradient headings use `.brand-title`. Panels use the coral top border and 15px radius. Do not hard-code brand hex values in components.
- Icons: Material filled icons via `<mat-icon>name</mat-icon>`. Use the icon's name exactly as Material lists it.
- Backend calls go through Rust commands and `ApiService`, never through `HttpClient`, so requests avoid webview CORS limits.
- Keep Angular's style budget in mind (component styles warn at 4 kB).

## Layout

- `:host` is a 100vh flex column: the header (`.bar`), then `main`.
- `main` holds two regions: `.top` (steps and toolbar, never scrolls) and `.content` (the panel or product list, scrolls).
- Put every screen's action buttons in `.top .toolbar`. Do not place them inside the content area.
- The screen 1 **Next** button is the only button on that toolbar, on the right. Its spinner sits beside it, not inside it.
- Screen 2 toolbar order: Back (left), spacer, search icon or search field, Select all, Select none, Download (n) (right).
- Content width is 900px max, centred, with 24px side padding. Do not widen it.
- The minimum window size is 900 × 640. Nothing should need horizontal scrolling at that size.

## Steps header

- Three steps: 1 Registration, 2 My Software, 3 Install/Distribution. Their names are the `STEPS` constant in `app.ts`.
- `currentStep` is derived from `screen()`. Completed steps and the current step are filled with the primary colour. Future steps are outlined.
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
- Each group heading is centred (`.group-title`). Its colour depends on the type:
  - `cwi` blue `#5ea0ff`
  - `other` lilac `#b39ddb`
  - `tmpl` teal `#4fd1c5`
  - `custom` amber `#ffb361`
- Products inside a group are sorted by name with `localeCompare`.
- Type labels come from `PRODUCT_TYPE_LABELS`. Add new types there and to `PRODUCT_TYPE_ORDER` when the API adds them.

### Rows

- Each row is one `li` with a `mat-checkbox` (flex 1) and, for `tmpl` only, licence tags on the right.
- The name is on the first line with the optional red "New!" chip (`.chip.new`). The version is on the second line in `body-small`.
- Licence tags (`.tag`) are outlined pills. They wrap and take at most 60% of the row, so the name never gets squashed.
- Tag text has double spaces collapsed (`licenceTags`).
- Do not add new columns or badges without asking; the layout is tuned for 900px.

### Search

- A search icon sits in the toolbar. Clicking it opens a 260px `mat-form-field` and focuses the input (`afterNextRender`).
- Escape or the × button closes it and clears the query. A closed search leaves no highlights.
- Matching uses `fuzzyPositions`: every typed word must appear in the product **name** as a subsequence, in any order. Words are split on whitespace and lower-cased.
- Only the name is searched. Do not add version, type or tags without asking.
- A matching row gets the `.match` class: blue background `#1f4e87`.
- Matched letters inside the name are wrapped in `<mark class="hit">`: yellow `#ffd54f`, dark text, bold.
- Rows that do not match stay visible. Search filters nothing.
- The footer shows "N matching" only when the query is not empty.

### Selection and actions

- Selection is by `productId` in a `Set`, replaced rather than mutated so signals update.
- **Select all** and **Select none** act on all products, not only visible or matching ones.
- **Download (n)** is disabled at 0 and always shows the number selected. It downloads the selected products one at a time through `download_products` (Rust, `products.rs`). Each file's storage key is `products/{name}/versions/{version}/{productId}.exe`, and it is saved to Downloads under `Caseware Installer`. A progress bar and status line sit under the toolbar while it runs. The button is disabled during a download.

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
