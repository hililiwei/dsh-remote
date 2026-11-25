# Headless Multi-Server Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native always-on-top desktop pet to DSH Remote that aggregates task state from multiple remote DSH servers using DSH's existing Remote protocol, without loading a DSH page or changing remote servers.

**Architecture:** A main-process headless Cordis client per server connects through the existing `/api/remote.mux` WebSocket with the server's saved cookie, mounts the generated `session` and `workspace` Remote namespaces, and normalizes `session.list` plus `workspace.follow` into a server snapshot. A separate transparent `BrowserWindow` renders the mascot and aggregated card, independent of the tab views.

**Tech Stack:** Electron 45, TypeScript, React for the existing renderer, vanilla TS for the pet page, Cordis, DSH client packages `0.2.2-rc.5`, `ws`.

**Spec:** `docs/superpowers/specs/2026-11-25-headless-pet-design.md`

## Global Constraints

- Do not modify remote DSH or add a new Remote/HTTP endpoint.
- Never write cookies or tokens to logs or renderer state.
- The pet must survive tab switches and stay `alwaysOnTop` above normal application windows.
- Existing servers.json files without `pet` settings must load with defaults.
- Windows is the verification target; macOS code paths must still typecheck.
- Keep the existing `--no-sandbox` install behavior and installer format.

## Review Focus

- A server with no valid cookie: pet shows the server offline, app remains usable.
- A server with a self-signed certificate: headless WebSocket uses the server's `allowInvalidCertificate` setting.
- A running session completing while another tab is active: it appears as `done` until that server is opened.
- A session with a pending question: it outranks running sessions and shows `needs-you`.
- Closing all main windows while the pet window exists: the app still quits when `closeToTray` is false.

---

### Task 1: Dependencies and headless client spike in the app

**Files:**
- Modify: `package.json`
- Create: `src/main/pet/dsh-client.ts`
- Test: `tests/main/pet/dsh-client.test.ts` (only pure helpers; integration via temporary spike)

**Interfaces:**
- Produces: `connectHeadlessDsh(options): Promise<HeadlessConnection>` with `listSessions()`, `followWorkspaces(signal)`, `close()`.
- Produces: `buildTransportCookie(cookies)`? Not needed; `connectHeadlessDsh` accepts a `cookie` string, `baseUrl`, `allowInvalidCertificate`.

- [ ] Add exact dependencies and install.
- [ ] Implement a minimal dynamic-import Cordis connection using `session.list` and `workspace.follow`.
- [ ] Verify with the existing 3099 test server token (token read from its log; do not commit it).
- [ ] Commit.

### Task 2: Pure aggregator and state semantics

**Files:**
- Create: `src/main/pet/aggregate.ts`
- Test: `tests/main/pet/aggregate.test.ts`

**Interfaces:**
- `aggregateServerSnapshot(input: ServerSnapshotInput): PetServerSnapshot`
- `mergePetSnapshots(servers: PetServerSnapshot[]): PetSnapshot`
- `PetSessionState = 'needs-you' | 'running' | 'done' | 'idle'`

- [ ] Write failing tests for filtering, state ranking, counts, workspace mapping, done transition.
- [ ] Implement the pure functions.
- [ ] Run tests.
- [ ] Commit.

### Task 3: Pet window and renderer

**Files:**
- Create: `src/main/pet/pet-window.ts`
- Create: `src/preload/pet.ts`
- Create: `src/renderer/pet.html`
- Create: `src/renderer/src/pet/PetApp.ts` (or `pet.ts`)
- Create: `src/renderer/src/pet/pet.css`
- Modify: `electron.vite.config.ts`
- Modify: `src/main/paths.ts`

**Interfaces:**
- `createPetWindow(store, callbacks): PetWindowController` with `show`, `hide`, `toggle`, `sendSnapshot`, `destroy`, `isPetWindow`.
- Pet preload exposes `window.dshPet`: `getSnapshot`, `onSnapshot`, `focusServer`, `hide`, `openManager`.

- [ ] Build a transparent frameless always-on-top window at bottom-right.
- [ ] Render cat SVG, bubble, grouped card; click pet toggles card; click row sends server id.
- [ ] Persist position; hide on disable.
- [ ] Add a visual test with fake snapshots.
- [ ] Commit.

### Task 4: Multi-server manager and lifecycle

**Files:**
- Create: `src/main/pet/pet-manager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/menu.ts`
- Modify: `src/main/tray.ts`

**Interfaces:**
- `PetManager` consumes `ConfigStore`, `SessionManager`, `TabManager`, `getActiveServerId()`.
- `start()`, `applySettings(settings)`, `refreshServers()`, `focusServer(id)`, `destroy()`.

- [ ] Reconcile headless clients with saved servers and cookies.
- [ ] Aggregate snapshots and push to pet window.
- [ ] Add tray/menu toggles and settings IPC.
- [ ] Handle main-window closure so the pet does not keep the app alive unexpectedly.
- [ ] Commit.

### Task 5: Settings, tests, build, install

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/config-store.ts`
- Modify: `src/renderer/src/components/SettingsPanel.tsx`
- Modify: `src/renderer/src/App.tsx` and settings hook types if needed
- Modify: `README.md`
- Test: `npm run typecheck`, `npm run test:unit`, `npm run build`
- Build: `npm run package:win-zip`

- [ ] Add `pet` settings with defaults and sanitization.
- [ ] Add settings UI toggles.
- [ ] Run typecheck/unit/build.
- [ ] Install the ZIP build to the existing `D:\Programs\DSH Remote` path, launch, verify pet with 127 and 33, verify always-on-top and tab switching.
- [ ] Commit.