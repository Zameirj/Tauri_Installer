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
  styles.scss             Material theme (azure palette, light and dark) and icon font
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
| 1 | Registration | Download code, email, EULA checkbox, Next |
| 2 | My Software | Product list with search, selection and Download |
| 3 | Install/Distribution | Not built yet |

### Screen 1: Registration

- **Download code** is required and must match `xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx` (8 letters or digits per group, case-insensitive). Example format: `abcd1234-efgh5678-ijkl9012-mnop3456`.
- **Email** is required and must match `name@domain.tld`. Angular's built-in `Validators.email` accepts `z@z`, so the app uses its own pattern.
- **EULA checkbox** is required. The "EULA" link opens the PDF in the default browser through `@tauri-apps/plugin-opener`. The click does not toggle the checkbox.
- **Next** stays disabled until the form is valid and the EULA box is ticked. It sits in the top toolbar, and a spinner appears beside it while the request runs.
- On success the app moves to screen 2. On failure the error message appears above the EULA checkbox.

### Screen 2: My Software

1. **Products are grouped by `type`** in this order: `cwi` (Caseware Application), `other` (Other), `tmpl` (Template), `custom` (Custom). Unknown types follow at the end, using the raw value as the heading. Each group has a centred heading in its own colour.
2. **Products within a group are sorted by name** (`localeCompare`).
3. **Each row** has a checkbox, the product name (with a red "New!" badge when `notification` is set), and the version in a smaller font below the name.
4. **Template rows only** show their licence tags on the right, one per `licences[].tagName`. Double spaces in tag names are collapsed. Tags wrap and take at most 60% of the row, so the name is never squashed.
5. **Toolbar:** Back, a search icon (opens a 260px search field), Select all, Select none, and **Download (n)**. Download is disabled at 0 and shows the number selected. Its action is a placeholder snackbar until the download step is defined.
6. **Search** matches only the product name. Each word typed must fuzzy-match the name in any order: the letters must appear in order but need not be adjacent. Matching rows get a blue background and the matched letters a yellow highlight. Rows that do not match stay visible. The footer shows "N matching" while a search is active. Escape or the × clears the search and collapses the field.
7. **Footer** shows "N products · N selected", plus "· N matching" during a search.

### Layout

- The app header, the steps, and the toolbar are fixed at the top. Only the `.content` area scrolls.
- The window opens at 1377 × 835 (`tauri.conf.json`). Minimum size is 900 × 640.

## API

`get_org_products(download_code)` is a Rust command, so the request is not subject to browser CORS rules.

- URL: `https://api.prod.casewareafrica.com/api/organisations/orgProducts/byDownloadCode/{downloadCode}`
- The download code is trimmed and checked on the Rust side. Only letters, digits and hyphens up to 64 characters are accepted, because the value is appended to the URL.
- Timeout: 30 seconds. Non-2xx responses return an error message to the UI.
- Fields used: `productId`, `name`, `version`, `type`, `notification`, `licences[].tagName`. Other fields in the response are ignored.

## Decisions to revisit

- **Download action:** the Download button is a placeholder. The next step needs a definition (what is downloaded, where it is saved, whether it uses the `versions` list).
- **Install/Distribution:** step 3 is shown in the header but has no screen.
- **Remote self-update:** the Import Centre app has one; this app does not.
- **Fourth product type:** the JSON data shows `cwi`, `tmpl`, `other` and `custom`. Unknown values display as their raw text.
