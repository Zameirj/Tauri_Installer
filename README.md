# Caseware Installer

A Windows desktop app (Tauri 2 + Angular 22 + Angular Material) that takes a **download code** and **email**, loads the products that the organisation is entitled to, and lets the user select the ones to download.

Built as a single portable exe. Package manager: **pnpm**.

## Requirements

- Node.js 24 and pnpm 12 (`packageManager` in `package.json`)
- Rust (stable, 1.90+) with Cargo. Cargo is usually in `%USERPROFILE%\.cargo\bin`; `scripts/tauri.mjs` adds that folder to PATH for the Tauri CLI.
- Windows 10/11 with WebView2 (already present on Windows 11).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm start` | Angular dev server on http://localhost:4200 (UI only, no Tauri commands) |
| `pnpm tauri:dev` | Run the full app with hot reload |
| `pnpm build` | Production Angular build into `dist/setup-installer` |
| `pnpm tauri:build` | Full build with installer bundles |
| `pnpm build:portable` | Release exe with no bundle, copied to `release/CasewareInstaller_<version>_portable.exe` |

## Project layout

```
src/
  main.ts                 bootstrap
  styles.scss             Material theme (magenta palette, light and dark), background, icon font
  index.html
  app/
    app.ts                screen state, form, search, grouping, selection
    app.html              template for the header, steps, both screens
    app.scss              layout and component styles
    api.service.ts        typed wrapper around the Rust commands
    app.config.ts         Angular providers
src-tauri/
  src/lib.rs              get_org_products command, plugin setup
  src/main.rs             entry point (hides the console window in release)
  tauri.conf.json         window size, product name, identifier
  capabilities/default.json   permissions for the webview (core, opener)
scripts/
  tauri.mjs               runs the Tauri CLI with cargo on PATH
  collect-portable.mjs    copies the release exe to release/
.claude/skills/setup-installer-ui/SKILL.md   UI rules for future changes
```

## Flow

The app has a three-step header. Only the first two steps have screens so far.

| Step | Name | Screen |
| --- | --- | --- |
| 1 | Verification | Download code, email, EULA checkbox, Next |
| 2 | My Software | Product list with search, selection and Download |
| 3 | Install/Distribution | Downloaded products, ready to install (Install is a placeholder) |

### Screen 1: Verification

- **Download code** is required and must match `xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx` (8 letters or digits per group, case-insensitive). Example format: `abcd1234-efgh5678-ijkl9012-mnop3456`.
- **Email** is required and must match `name@domain.tld`. Angular's built-in `Validators.email` accepts `z@z`, so the app uses its own pattern.
- **EULA checkbox** is required. The "EULA" link opens the PDF in the default browser through `@tauri-apps/plugin-opener`. The click does not toggle the checkbox.
- **Next** stays disabled until the form is valid and the EULA box is ticked. It sits at the top right of the panel, and a spinner appears beside it while the request runs.
- On success the app moves to screen 2. On failure the error message appears below the EULA checkbox.
- The layout is based on `wire-frames/registration_page_assets/04_registration_design_reference.png`, without its side panel: the form, centred, with the **notifications banner** under it with the QR code for the Caseware notifications app. The banner art is `wire-frames/correct-banner.png` with its text and sample QR code removed (`public/backgrounds/notifications-banner.webp`); the app draws the text itself ("Download the Caseware Notifications App") and shows the genuine QR code (`public/caseware-mobile-qr.svg`, which opens https://mobile.prod.casewareafrica.com/) with "Scan to Download". The old coral Caseware marks on the phone, the bell badge and in the centre of the QR code are replaced with the gradient mark.

### Screen 2: My Software

1. **Products are grouped by `type`** in this order: `cwi` (Caseware Application), `other` (Other), `tmpl` (Template), `custom` (Custom). Unknown types follow at the end, using the raw value as the heading. Each group has a left-aligned heading with a bar in its own colour. Each row is a card with the product name and version; rows have no product icon.
2. **Products within a group are sorted by name** (`localeCompare`).
3. **Each row** has a checkbox, the product name (with a red "New!" badge when `notification` is set), and the version in a smaller font below the name.
4. **Template rows only** show their licence tags on the right, one per `licences[].tagName`. Double spaces in tag names are collapsed. Tags wrap and take at most 60% of the row, so the name is never squashed.
5. **Toolbar** at the top of the list panel: Back on the left; a search button, Select all, Select none and **Download (n)**. Download is disabled at 0 and shows the number selected. It downloads the selected products one at a time with a progress bar under the toolbar, extracts them with 7-Zip (compiled into the exe), then opens step 3. Products already downloaded stay ticked and locked.
6. **Search** matches only the product name. Each word typed must fuzzy-match the name in any order: the letters must appear in order but need not be adjacent. Matching rows get a blue background and the matched letters a yellow highlight. Rows that do not match stay visible. The footer shows "N matching" while a search is active. The search starts as a magnifier button; clicking it opens and focuses the field, which collapses again when it is empty and loses focus. Escape or the × clears the search.
7. **Summary** at the foot of the list panel shows "N products · N selected", plus "· N matching" during a search.

### Layout

- The hero (title and steps), the card's brand row and the toolbar are fixed. Only the `.content` area scrolls.
- The look follows the company-branding wireframe (`wire-frames/Caseware Installer company-branding.png`) in both light and dark mode: a dark hero over `wire-frames/banner.png` and a light card over `wire-frames/background.png` (both exported to WebP in `public/backgrounds`). App styles are in `src/app/app.scss`, loaded globally from `styles.scss`.
- `wire-frames/` holds the design sources (wireframes and source art). It is a local folder that git ignores, so it is not in the repository. The app only uses the exports in `public/`.
- The Caseware logo uses the gradient mark (`wire-frames/caseware-mark-gradient.png`). `app-icon.png` is a 1024px version of it and the source for the window and taskbar icons: run `pnpm tauri icon` to regenerate `src-tauri/icons`.
- The window opens at 1377 × 835 (`tauri.conf.json`). Minimum size is 900 × 640.

## API

`get_org_products(download_code)` is a Rust command, so the request is not subject to browser CORS rules.

- URL: `https://api.prod.casewareafrica.com/api/organisations/orgProducts/byDownloadCode/{downloadCode}`
- The download code is trimmed and checked on the Rust side. Only letters, digits and hyphens up to 64 characters are accepted, because the value is appended to the URL.
- Timeout: 30 seconds. Non-2xx responses return an error message to the UI.
- Fields used: `productId`, `name`, `version`, `type`, `notification`, `licences[].tagName`, and the organisation name from `licences[].organisations[].name` or `licences[].bundles[].organisations[].name` (first one found; shown in the card's brand row on screens 2 and 3). Other fields in the response, including the codes in the organisation objects, are ignored.

## Decisions to revisit

- **Install action:** step 3 lists the downloaded products, but the Install button is a placeholder until the run logic is defined.
- **Remote self-update:** the Import Centre app has one; this app does not.
- **Fourth product type:** the JSON data shows `cwi`, `tmpl`, `other` and `custom`. Unknown values display as their raw text.
