# Agent Focus & Dock — P1, main office only

Base: `03e0455fca01a2a9b178a75ec846b9e05850af35`. Review date: 2026-10-30.
This increment changes presentation only. It does not connect an executor or prove live activity.

## Architecture and scope

- `App` replaces its roster and inspector with `AgentDock` and `AgentInspector`. The shared sprite/dock handler checks the ID against the current `HQStore`, selects there, then requests scene focus. Repeating the same ID is an explicit new focus request.
- `officeAgentView` is a pure projection, not a store or source admission layer. Existing canonical validators, limits and ownership/session boundaries remain authoritative. No additional fetch, RPC, permission, approval or execution event is introduced by selection.
- `OfficeScene.focusAgent` snapshots the existing sprite's rendered feet, including a handoff offset, at the current zoom. The finite camera interpolation reuses `advanceCameraFocus`; it does not track an agent continuously or update an agent's destination, motion or state.
- Manual selection, pan, zoom and centering cancel the prior focus and suspend critical following. The existing toggle must be explicitly reenabled. Its React state is synchronized through a presentation callback. Viewport resize cancels focus and restores the existing fit behavior.
- Removal or selection change cancels the relevant target; source/mode/historical scope changes clear it. Empty or disconnected source transitions cancel critical targets too. `HQStore` already invalidates account/logout evidence. Scene destruction rejects late focus/update/tick calls.
- `prefers-reduced-motion` is read from the browser. Camera focus finishes on one tick using the existing bounded interpolation. Agent animation/motion is not changed. No polling, timers or listeners are added for the preference.
- Native buttons provide Enter/Space activation, Tab traversal, `aria-pressed`, descriptive source/status/security references and visible focus. Horizontal roster scrolling remains inside the dock; it is in document flow, directly below the canvas and before the inspector on mobile.
- MOCK is explicitly simulation. HISTORICAL_REPLAY retains Codex external-executor identity and has no current status. LIVE_READ_ONLY shows the actual source/connection and an empty roster when unavailable. Source claims are displayed, not elevated into authorization. Missing details say so; the visible event window is not claimed to be a full execution history.

`RuntimeOfficePanel` retains its own existing runtime projection and scene. The new dock belongs only to the main office. There is no global roster, second Director, coordinator, ledger or runtime.

## Changed files

- `apps/raxi-hq/src/App.tsx`: shared selection/focus handler, extracted UI, synchronized critical toggle and actual Campus label.
- `apps/raxi-hq/src/office/OfficeScene.ts`: manual focus, cancellation, manual priority and reduced camera motion.
- `apps/raxi-hq/src/office/ui/{AgentDock,AgentInspector}.tsx`: read-only components.
- `apps/raxi-hq/src/office/ui/agentViewSelectors.ts`: derived view only.
- `apps/raxi-hq/src/design/global.css`: dock, focus styles and responsive layout.
- `apps/raxi-hq/tests/officeUX.test.tsx`: 13 new regressions; registered in the existing test runner.
- `apps/raxi-hq/tests/manual/observation.tsx`: optional `?motion=reduce` browser QA fixture, visibly identified, excluded from production entrypoint. It changes neither OS preferences nor Auth/server behavior.
- This document and visual evidence under `output/reports/raxi-hq-agent-focus-dock/`.

No changes to `camera.ts`, `AgentMotion`, `AgentSprite`, domain/reducer/store, runtime, providers, Supabase, SQL, migrations, manifests, Guardian, or the PR39 runner/design. The ten image deletions in the original checkout are outside this branch.

## Reproducible validation

From `apps/raxi-hq`:

```text
npm ci --ignore-scripts
npm run typecheck
npm test
node tests/stagingSafety.test.mjs
npm run build
npm audit --json
```

The lockfile is unchanged. Lifecycle scripts were not run during installation. Tests use existing local test doubles/PGlite; no hosted SQL, Docker, B2, providers, workers, users or production data are used. Tests that mention REAL authorization are fixture regressions, not real provider calls.

New tests cover rendered-position snapshots/repeated selection, A→B replacement, invalid IDs/coordinates, manual priority and critical reenablement, zoom/center cancellation, reduced motion, removal, external selection, source/disconnection/historical scope changes, destruction, safe own-property lookups, native-button semantics, immutable operational snapshots and zero extra fetch/repository reads. The mounted App regression includes StrictMode, historical/DEMO/LIVE transitions, account change, remount and cleanup. The new test uses controlled interval fixtures so demo clock ticks cannot produce flaky snapshot comparisons.

Node scene fixtures exercise production methods without WebGL. They do not substitute for browser QA or establish live executor behavior.

Final local results: **639/639 application tests PASS**, including the 13 new P1 regressions; **1/1 staging guard PASS** (640 total). Typecheck and production build PASS. Five relative evidence links PASS. Staged diff/secret-path scan PASS across 15 files; no staged deletions. Dependency audit exits 1 for the single preexisting moderate advisory below (zero high/critical).

Raw command logs remain ignored under the application's `.validation/` directory; no generated test bundles or temporary files are published. SHA-256 fingerprints of this run:

| Artifact | SHA-256 |
| --- | --- |
| `office-p1-final-tests.log` | `a1d520ebb82e2b1a3315c1271a2343b7d46e6a96b8fdf7378a7600a1ae1fbd9d` |
| `office-p1-staging-guard.log` | `056d9a3042e9d874bfa51195c9cbe0bd97594c13f364cd13ee95dd9d3f7d290c` |
| `office-p1-typecheck.log` | `236189c12f0a4a176be02a7e6dae4a48b84cf0bc7b101374891c5d1457577ede` |
| `office-p1-build.log` | `e3778c54d343eefd7f45954611687cb3adf08ec5541621a5ba0ad967aaf6583e` |
| `office-p1-audit.json` | `e5f34547f0af478c4918deed42013f3a55f67da8284ed208dd14059a99beb485` |

## Browser QA and evidence

Use the existing local harness:

```text
npm run dev -- --host 127.0.0.1 --port 5176 --strictPort
http://127.0.0.1:5176/tests/manual/observation.html
http://127.0.0.1:5176/tests/manual/observation.html?motion=reduce
```

Auth/repositories are explicitly TEST DOUBLES. No workspace is created. The Codex capture is authentic historical metadata already pinned by the existing observer, not a current Raxi execution. MOCK agents/tasks/events remain simulations even when source fixture fields contain `verified:true`.

Observed in the actual browser with WebGL/Pixi:

| Case | Observed result |
| --- | --- |
| Sprite selection | Clicking the Creative avatar selected Creative and updated its inspector |
| Dock and repeat | Research → Creative → Research, then Enter on Research: correct selected agent and finite refocus |
| Manual priority | Enabling critical follow, then dragging the canvas changed the toggle to false |
| Keyboard | Enter/Space selected agents; Tab advanced Research → Strategy with solid visible focus; mobile Space reached Performance through the scrolling dock |
| Source reset | Returning to Campus REAL cleared the mock roster and inspector; LIVE remained disconnected without fallback |
| Historical | Codex remained EXTERNAL_EXECUTOR/HISTORICAL, with no invented task/provider/capabilities |
| Desktop | 1440×1000: main office, dock and separate inspector preserved |
| Mobile | 390×844: page width 375 (scrollbar excluded), dock viewport 325, roster scroll width 1294; no page overflow |
| Other breakpoints | 320×740: document width 305; 768×1024: width 753; single-column workspace and no page overflow |
| Reduced preference fixture | 390×844: explicit reduced-motion fixture note; focus and selection remain usable. Exact one-tick behavior is asserted by the method regression, not inferred from a still image |
| Console | Browser error log query returned no errors |

Screenshots are captured from the local browser, not generated illustrations. Full-page files preserve context and source labels:

- [Desktop MOCK](../output/reports/raxi-hq-agent-focus-dock/desktop-mock.jpg)
- [Desktop historical](../output/reports/raxi-hq-agent-focus-dock/desktop-historical.jpg) — reduced-preference fixture also active.
- [Mobile MOCK](../output/reports/raxi-hq-agent-focus-dock/mobile-mock.jpg)
- [Mobile historical, reduced fixture](../output/reports/raxi-hq-agent-focus-dock/mobile-historical-reduced.jpg)
- [Mobile focus viewport](../output/reports/raxi-hq-agent-focus-dock/mobile-focus-viewport.jpg)

The QA verifies responsive layout with browser viewport overrides, not physical phone hardware or a screen-reader certification. The reduced preference is a clearly labeled browser test fixture; no system accessibility setting was changed.

## Security, review and residual risks

- Manual diff/protected-path checks and a staged secret/path scan are required before publication. Screenshots contain only local fixture UI and already-versioned historical references, no credentials or private originals.
- `npm audit` found one **preexisting moderate** advisory: `qs@6.16.0`, transitively through `pixi.js → @pixi/core → @pixi/utils → url`. Advisory: [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw). No lockfile/dependency change is included. Audit exits 1; do not describe it as vulnerability-free. Dependency remediation needs a separately reviewed change; no claim of unreachability is made here.
- Initial audit access failed certificate verification. Repeating with `NODE_USE_SYSTEM_CA=1` obtained the report; TLS validation was not disabled.
- Independent Codex subagent review found no blocking issue and ran 13/13 focused tests. Its accessibility suggestion (announcing source/status/security through `aria-describedby`) was incorporated. Final GitHub review remains a separate publication gate.
- Existing `react-test-renderer` deprecation warning remains. No new accessibility/rendering dependencies were installed.
- Guardian is not claimed active; security labels are descriptive. No live bridge, provider execution, hosted Auth/RLS validation or production persistence is proven by this UX PR.

Rollback is a revert of this presentation-only change after human review; no schema/data rollback or infrastructure cleanup is required. Keep the PR unmerged for review.
