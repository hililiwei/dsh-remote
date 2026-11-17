# DSH Remote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Electron desktop shell that saves remote `dsh web` servers, performs the one-time token exchange, and opens each remote DSH UI in an isolated, persistent session.

**Architecture:** Electron main process owns config, sessions, windows and OS integration; a local React renderer provides server management and token re-authentication; remote DSH pages load in separate BrowserWindows with no preload or Node access.

**Tech Stack:** Electron 45, electron-vite 6, Vite 8, React 19, TypeScript 5, Vitest 5, Playwright 1.65, electron-builder 26.

**Spec:** `docs/superpowers/specs/2026-11-17-dsh-remote-electron-design.md`

## Global Constraints

- Product name `DSH Remote`, package `dsh-remote`, appId `com.dshremote.app`.
- Windows 10/11 x64 and macOS universal (x64 + arm64); no Linux.
- Remote page must have `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and no preload.
- Never persist or log a launch token; config stores only a clean base URL.
- Only `http:` and `https:` URLs are accepted; reject credentials in URLs.
- Each server uses `persist:dsh-remote-<id>`; deleting a server clears that partition.
- UI copy is Chinese; code identifiers and logs are English.
- No UI component library, no `electron-store`, no auto-updater in v1.
- macOS output is unsigned and un-notarized.
- All production behavior in `src/main` and shared modules starts from a failing Vitest test.

## Review Focus

- A pasted launch URL with no `token`, multiple `token` values, a hash, or unrelated query parameters must either be rejected clearly or normalized without losing the token.
- A token URL whose host differs from the saved server must be rejected before any network request, so a token cannot be sent to another origin.
- A corrupt or partially-written `servers.json` must not crash startup or silently erase every server.
- A 401 that arrives after the page loaded (API call), not only on initial navigation, must still open the reconnect flow once, without a dialog storm.
- Proxy and certificate decisions must be scoped to one server; trusting one self-signed origin must not trust another.

---

### Task 1: Scaffold project, build config and test harness

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `.npmrc`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/shared/types.ts`
- Test: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm run test:unit`, `npm run test:e2e`, `npm run dist:win`, `npm run dist:mac`.
- Produces: `src/shared/types.ts` with all public types used by later tasks.

- [ ] **Step 1: Create package metadata and install dependencies**

`package.json` scripts: `dev`, `build`, `start`, `test:unit`, `test:e2e`, `typecheck`, `dist:win`, `dist:mac`, `icons`.
Dependencies: `react`, `react-dom`. Dev: `electron`, `electron-vite`, `electron-builder`, `vite`, `typescript`, `vitest`, `@playwright/test`, `@vitejs/plugin-react`, `@types/node`, `@types/react`, `@types/react-dom`, `png2icons`.

- [ ] **Step 2: Write a failing smoke test**

```ts
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '../../src/shared/constants'

describe('smoke', () => {
  it('exports the product name', () => {
    expect(APP_NAME).toBe('DSH Remote')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm run test:unit -- tests/unit/smoke.test.ts`  
Expected: FAIL because `src/shared/constants.ts` does not exist.

- [ ] **Step 4: Add `src/shared/constants.ts` and the minimal app shell**

Add `APP_NAME`, `APP_ID`, `AUTH_COOKIE_HINT`, default window sizes. Create an Electron main entry that opens a blank window and a preload that exposes nothing yet. Create a React renderer that renders `DSH Remote`.

- [ ] **Step 5: Verify build and test**

Run: `npm run test:unit` → PASS.  
Run: `npm run typecheck` → PASS.  
Run: `npm run build` → PASS, output under `out/`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig*.json vitest.config.ts playwright.config.ts .gitignore .npmrc src tests
git commit -m "chore: scaffold Electron app"
```

---

### Task 2: URL, token and redaction utilities

**Files:**
- Create: `src/main/url-tools.ts`
- Test: `tests/unit/url-tools.test.ts`

**Interfaces:**
- Produces:
  - `parseConnectionInput(input: string): ParsedConnection`
  - `buildTokenUrl(baseUrl: string, token: string): string`
  - `normalizeBaseUrl(input: string): string`
  - `redactUrl(input: string): string`
  - `sameOrigin(a: string, b: string): boolean`
- `ParsedConnection = { baseUrl: string; token?: string; hadToken: boolean; warnings: string[] }`

- [ ] **Step 1: Write failing tests**

Cover:
- `https://dsh.example.com/?token=abc` → base `https://dsh.example.com/`, token `abc`.
- `https://dsh.example.com/` → no token, base with trailing slash.
- `https://dsh.example.com/team/?token=abc&x=1` → base `https://dsh.example.com/team/`, token `abc`, warning about non-root path.
- `https://dsh.example.com/?token=a&token=b` → error.
- `ftp://...`, `javascript:...`, `file://...`, `https://user:pass@host/` → error.
- `redactUrl('https://h/?token=secret')` does not contain `secret`.
- `buildTokenUrl` encodes the token and keeps the path.
- `sameOrigin` compares protocol + host + port.

- [ ] **Step 2: Run and watch fail**

Run: `npm run test:unit -- tests/unit/url-tools.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement minimal utilities**

Use `new URL`, reject non-http(s), reject `url.username || url.password`, normalize pathname to end with `/`, strip `token` and hash, collect warnings for non-root path, deduplicate/validate token count.

- [ ] **Step 4: Run tests and full suite**

Run: `npm run test:unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/url-tools.ts tests/unit/url-tools.test.ts
git commit -m "feat: parse DSH launch URLs and redact tokens"
```

---

### Task 3: Persistent server configuration store

**Files:**
- Create: `src/main/config-store.ts`
- Test: `tests/unit/config-store.test.ts`

**Interfaces:**
- Produces: `class ConfigStore`
  - `constructor(filePath: string)`
  - `load(): Promise<AppSettings>`
  - `getSettings(): AppSettings`
  - `saveServer(input: ServerInput): Promise<ServerProfile>`
  - `deleteServer(id: string): Promise<void>`
  - `setDefaultServer(id: string | null): Promise<void>`
  - `updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>`
  - `rememberBounds(key: string, bounds: WindowBounds): Promise<void>`
- Produces default settings with `version: 1`, `servers: []`, `autoConnect: true`, `closeToTray: false`, `theme: 'system'`, `windowBounds: {}`.

- [ ] **Step 1: Write failing tests**

Use a temp directory per test. Cover:
- missing file → defaults;
- add server → parse URL, trim name, default name from hostname, persist to disk;
- duplicate URL → error;
- update by id → changes name/flags but keeps id/createdAt;
- delete → removes and clears default when it pointed at it;
- set default;
- corrupt JSON → loads empty settings and writes a `.corrupt-<timestamp>` backup, does not throw;
- atomic write leaves valid JSON after save.

- [ ] **Step 2: Run and watch fail**

Run: `npm run test:unit -- tests/unit/config-store.test.ts`  
Expected: FAIL, module not found.

- [ ] **Step 3: Implement store**

Use `fs/promises`, `JSON.stringify(..., null, 2)`, write to `<file>.tmp-<pid>` then `rename`. Validate each server entry on load; drop malformed entries and keep valid ones. Never log tokens.

- [ ] **Step 4: Run tests and full suite**

Run: `npm run test:unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/config-store.ts tests/unit/config-store.test.ts
git commit -m "feat: add atomic server configuration store"
```

---

### Task 4: Session, proxy and connection status

**Files:**
- Create: `src/main/session-manager.ts`, `src/main/server-status.ts`
- Test: `tests/unit/server-status.test.ts`

**Interfaces:**
- Produces: `partitionFor(id: string): string`
- Produces: `class SessionManager` with `get(id, server): Session`, `applyProxy(session, mode): Promise<void>`, `clear(id): Promise<void>`
- Produces: `checkServer(session: Session, baseUrl: string): Promise<TestResult>`
- `TestResult = { status: 'online' | 'auth-required' | 'forbidden' | 'error' | 'offline'; httpStatus?: number; message?: string }`

- [ ] **Step 1: Write failing tests with a real local HTTP server**

Start a Node `http` server in the test:
- `/` with cookie → 200;
- `/` without cookie → 401;
- `/forbidden` → 403;
- unreachable port → offline.

Assert `checkServer` maps statuses, respects a 5s timeout, and never throws.

- [ ] **Step 2: Run and watch fail**

Run: `npm run test:unit -- tests/unit/server-status.test.ts`  
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`checkServer` uses `session.fetch(baseUrl, { redirect: 'manual', signal })`. Map 200/2xx/3xx → online, 401 → auth-required, 403 → forbidden, other HTTP → error, network error → offline. Always clear the timeout.

- [ ] **Step 4: Run tests and full suite**

Run: `npm run test:unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/session-manager.ts src/main/server-status.ts tests/unit/server-status.test.ts
git commit -m "feat: add isolated sessions and connection checks"
```

---

### Task 5: Electron lifecycle, manager window, IPC and menus

**Files:**
- Create: `src/main/index.ts`, `src/main/manager-window.ts`, `src/main/ipc.ts`, `src/main/menu.ts`, `src/main/tray.ts`, `src/main/logger.ts`, `src/main/paths.ts`, `src/main/security.ts`
- Create: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Test: manual launch + `tests/integration/manager.spec.ts` (added after Task 8 harness)

**Interfaces:**
- Produces: preload API `window.dshRemote` with methods from the spec.
- Produces: IPC channels `servers:list`, `servers:save`, `servers:delete`, `servers:test`, `servers:connect`, `settings:get`, `settings:update`, `window:context`, `auth:submit`, `auth:cancel`, `app:open-external`, `app:open-manager`, `app:clear-session`.
- Produces: `createManagerWindow()`, `showManager()`, `refreshMenu()`, `refreshTray()`.

- [ ] **Step 1: Implement secure window factory**

Manager: `preload`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; load `ELECTRON_RENDERER_URL` in dev or `out/renderer/index.html` in production. Remote server windows are created in Task 6.

- [ ] **Step 2: Implement IPC validation and config wiring**

Every handler validates ids/URLs; `servers:save` calls `parseConnectionInput`, stores clean base URL, and returns `{ server, inputHadToken }`. Errors are converted to `{ ok: false, message }` or thrown with safe messages; never include a token.

- [ ] **Step 3: Implement single instance, app menu and tray**

`app.requestSingleInstanceLock()`; second instance focuses manager or opens `--server=<id>`. Menu lists servers with Cmd/Ctrl+1..9, manager, reload, open in browser. Tray mirrors the server list. macOS uses `window-all-closed` keep-alive.

- [ ] **Step 4: Launch manually**

Run: `npm run dev`  
Expected: Manager window appears, no console errors, server list empty.

- [ ] **Step 5: Commit**

```bash
git add src/main src/preload src/shared
git commit -m "feat: add Electron lifecycle, IPC, menus and tray"
```

---

### Task 6: Remote server windows, token exchange and re-auth

**Files:**
- Create: `src/main/server-window.ts`, `src/main/auth-window.ts`, `src/main/connection.ts`
- Modify: `src/main/index.ts`, `src/main/ipc.ts`, `src/main/menu.ts`
- Test: `tests/integration/auth-flow.spec.ts` (Task 8 harness)

**Interfaces:**
- Produces: `class ServerWindowManager`
  - `open(server: ServerProfile, tokenUrl?: string): Promise<BrowserWindow>`
  - `focus(id: string): boolean`
  - `close(id: string): void`
  - `reload(id: string): void`
- Produces: `openAuthWindow(serverId, reason)`
- Produces: `exchangeLaunchUrl(server, tokenUrl): Promise<void>`

- [ ] **Step 1: Implement server window**

Create `BrowserWindow` with the server partition, no preload, sandbox. Set `setWindowOpenHandler` (external links to `shell.openExternal`, same-origin/auth popups allowed with same partition), `will-navigate` protocol guard, window bounds restore/save, title from server name.

- [ ] **Step 2: Implement navigation outcome handling**

`did-navigate` with `httpResponseCode`:
- 200 → resolve ready, update `lastUsedAt`, focus.
- 401 → reject with `AuthRequiredError`, open auth window.
- other → show error dialog with Retry / Open in browser / Edit.
`did-fail-load` → map cert/DNS/refused errors; offer trust-certificate action when applicable.

- [ ] **Step 3: Implement API 401 watcher**

Use `session.webRequest.onCompleted` filtered to the server origin; if status 401 and URL path starts with `/api`, debounce 1s and open the auth window once per server while no auth window is open. On successful re-auth, `reload()`.

- [ ] **Step 4: Implement auth window**

Local renderer `?view=auth&serverId=...&reason=first|expired`. On submit:
1. `parseConnectionInput(tokenUrl)`; require token and same origin as server.
2. Navigate the existing server window to `buildTokenUrl`.
3. Resolve on 200; show inline error on 401/timeout.
4. Close auth window on success.

- [ ] **Step 5: Verify manually against a real local `dsh web`**

Start `dsh web` on a spare port with a temp `DSH_HOME`, copy the printed token URL, add it in the app, connect. Then restart the app and reconnect without the token. Capture a screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/main
git commit -m "feat: load remote DSH with token exchange and re-auth"
```

---

### Task 7: Manager and auth renderer UI

**Files:**
- Create: `src/renderer/src/App.tsx`, `src/renderer/src/api.ts`, `src/renderer/src/hooks/useServers.ts`
- Create: `src/renderer/src/components/ServerList.tsx`, `ServerDetails.tsx`, `ServerForm.tsx`, `AuthView.tsx`, `EmptyState.tsx`, `HelpDialog.tsx`, `StatusBadge.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/integration/manager.spec.ts`, `tests/integration/auth-flow.spec.ts`

**Interfaces:**
- Consumes `window.dshRemote` from Task 5.
- Produces UI states: loading, empty, list, form (add/edit), auth, error banner.

- [ ] **Step 1: Build manager shell**

Two-pane layout: sidebar server list + “添加服务器”; main pane details/form. Dark/light via `prefers-color-scheme`. Show status dot, last used, default badge. Buttons: 连接、测试、编辑、删除、设为默认.

- [ ] **Step 2: Build add/edit form**

Fields: 名称、服务器地址（接受 `https://host/` 或完整 `dsh web:` URL）、代理模式、信任自签名证书. Inline validation from main errors. Helper text explains how to get the launch URL. “保存并连接” and “仅保存”.

- [ ] **Step 3: Build auth view**

Shows server host and reason. Textarea for the full `dsh web:` URL; primary “连接”; “取消”. Inline errors for missing token, host mismatch, timeout. Auto-focus.

- [ ] **Step 4: Build help dialog**

Explains: start `dsh web` on the server, copy the `dsh web:` line, paste it; after first success the cookie is remembered; if 401, repeat with the new URL.

- [ ] **Step 5: Verify with Playwright**

Manager renders empty state; add server persists; edit and delete work; auth view rejects a token from another host.

- [ ] **Step 6: Commit**

```bash
git add src/renderer tests/integration
git commit -m "feat: add server manager and token auth UI"
```

---

### Task 8: Fake DSH server and Electron end-to-end tests

**Files:**
- Create: `tests/helpers/fake-dsh-server.ts`, `tests/integration/launch.spec.ts`, `tests/integration/auth-flow.spec.ts`
- Modify: `playwright.config.ts`, `package.json`

**Interfaces:**
- Produces: `startFakeDsh(): Promise<{ url, tokenUrl, close }>` implementing:
  - `GET /?token=good` → 303 `./` + `Set-Cookie: dsh-auth=...; Path=/; HttpOnly`
  - `GET /` with cookie → HTML `<h1>Fake DSH</h1>`
  - `GET /` without cookie → 401 `dsh web authentication required`
  - `GET /api/me` without cookie → 401
- Produces: `launchApp(userDataDir)` helper using `_electron.launch`.

- [ ] **Step 1: Write failing launch test**

Launch app with temp userData; expect one manager window, title `DSH Remote`; add the fake server token URL; expect a second window whose title contains `Fake DSH`; assert `servers.json` has no `token`.

- [ ] **Step 2: Run and watch fail**

Run: `npm run test:e2e -- tests/integration/launch.spec.ts`  
Expected: FAIL because the fake server/harness does not exist.

- [ ] **Step 3: Implement fake server and test harness**

Use Node `http`, random port, no external deps. Launch Electron with `args: ['.']`, `env: { ...process.env, DSH_REMOTE_USER_DATA: tempDir, NODE_ENV: 'test' }`. App honors `DSH_REMOTE_USER_DATA` only in test/dev.

- [ ] **Step 4: Run green**

Run: `npm run test:e2e` → PASS.

- [ ] **Step 5: Add re-auth test**

After first success, make the fake server require a new cookie (rotate token), trigger reload, expect auth window, paste new token URL, expect recovery. Assert only one auth window opens when multiple 401s occur.

- [ ] **Step 6: Commit**

```bash
git add tests playwright.config.ts package.json
git commit -m "test: cover token exchange and re-auth end to end"
```

---

### Task 9: Icons, installers, macOS CI and documentation

**Files:**
- Create: `scripts/generate-icons.mjs`, `build/icon.png`, `build/icon.ico`, `build/icon.icns`, `build/tray.png`, `build/trayTemplate.png`
- Create: `electron-builder.yml`, `.github/workflows/build.yml`
- Create: `README.md`, `docs/remote-server.md`, `docs/macos-unsigned.md`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Produces: `npm run icons`, `npm run dist:win`, `npm run dist:mac`.
- Produces: Windows NSIS installer and macOS DMG/zip config.

- [ ] **Step 1: Generate icon assets**

Use PowerShell/System.Drawing to draw a 1024×1024 PNG (rounded dark tile + white prompt glyph + blue accent), then `png2icons` for `.ico` and `.icns`. Generate 32×32 tray icons. Commit binaries.

- [ ] **Step 2: Configure electron-builder**

Windows NSIS per-user, no admin, start menu + desktop shortcut, artifact name. macOS universal DMG/zip, `identity: null`, unsigned. Include `build/` resources.

- [ ] **Step 3: Add CI**

Windows and macOS jobs; `npm ci`, unit tests, build, package, upload artifacts. macOS job sets `CSC_IDENTITY_AUTO_DISCOVERY=false`.

- [ ] **Step 4: Write docs**

README: features, screenshots, install, first connection, multiple servers, security/proxy/TLS. Remote guide: `dsh web` flags, token URL, reverse proxy/trusted-host, proxy mode. macOS guide: unsigned open instructions, build steps, future signing.

- [ ] **Step 5: Build Windows installer**

Run: `npm run dist:win`  
Expected: `dist/DSH Remote-0.1.0-win-x64.exe` (or configured artifact name). Install, launch, verify, uninstall.

- [ ] **Step 6: Commit**

```bash
git add build scripts electron-builder.yml .github README.md docs
git commit -m "build: add cross-platform packaging, icons and docs"
```

---

### Task 10: Final verification and review

**Files:** none

- [ ] Run `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, `npm run build`.
- [ ] Launch installed Windows app against a real local `dsh web`; verify first token, restart persistence, server switching, external link, download.
- [ ] Inspect `servers.json` and logs for token leakage.
- [ ] Review final diff; run a fresh code-review subagent; fix actionable findings.
- [ ] Commit any fixes and produce final report with installer path and macOS build instructions.