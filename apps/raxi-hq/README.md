# Raxi HQ v0.9 — Supabase Auth and real ideas

The authenticated app defaults to Campus REAL, with manual ideas stored in Supabase. Campus DEMO must be selected explicitly and keeps all mock ideas and session-only campaigns separate. The office remains read-only and disconnected until a documented Munder source is available; no autonomous agents are configured.

Copy `.env.example` to ignored `.env.local` and configure the project URL and an `sb_publishable_...` key. Never use a secret/service key in a `VITE_` variable. Start Vite and sign in with a confirmed Email account. `/login` is public; the office is protected. Production SPA hosting must rewrite application paths to `index.html`. Environment values are set at build time.

In Campus REAL, create your own `raxi-hq` workspace if needed, enter a title/note and save. Only a canonical response from the authenticated Edge Function can show a successful save. Failed requests keep the fields editable; retry the original content to reuse the operation and external ID. Reload or sign out/in to fetch the persisted ideas again. Manual ideas start PROPOSED with no inferred research, production approvals or agent activity. Same-user token refresh keeps the form mounted; account changes clear the prior user's UI.

See [backend boundaries and deployment](../../supabase/README.md), [schema baseline](../../supabase/schema-baseline.json), and [acceptance evidence](../../output/reports/raxi-hq-v09-persistence/VALIDATION.md). The client-side route guard is navigation protection; backend reads use RLS and the write service verifies Auth and ownership inside PostgreSQL.

The source selector lets you choose MOCK or LIVE_READ_ONLY. LIVE never silently falls back to mock. Its source-health panel shows connection, source timestamps and loaded counts; the activity panel shows only validated source events. In this checkout no Munder feed was found, so production LIVE has no agents, tasks, events or live animation. Reintentar lectura checks the disconnected source again; returning to MOCK is a manual choice. See the [source discovery](../../docs/RAXI_HQ_V05_SOURCE_DISCOVERY.md) and [Munder boundary](src/adapters/munder/README.md).

The office has seven connected isometric zones, visible corridors and stations, procedural furniture, and role-specific chibi avatars. The v0.4 visual pass improved agent size, contrast and state cues so activity is legible without relying on floating labels. In MOCK, agents follow event destinations, arrive at workstations, and stay aligned while working; active stations light subtly. Characters and furniture sort together by ground Y, with soft shadows and local animation that does not change motion coordinates. All artwork is drawn locally in Pixi, with no external/proprietary assets.

Drag empty floor to pan, use the wheel or +/- to zoom, and choose Centrar to reset. The initial zoom is 105% of the responsive fitted view; zoom and panning are bounded. Optional Seguir críticos briefly focuses important events without overriding manual camera control. Hover shows a React inspection card; click selects the full agent panel. Only hovered/selected avatars show names. Handoffs show approach, a short gesture and a glowing transfer packet before agents resume their event-driven activity. On verified mock MEMORY_ARCHIVED events, a signal travels from the saved request position to Supermemory Core, which briefly shows RECEIVING and INDEXING before settling. This is a visual effect only.

The mock campaign starts at 0% and advances deterministically through workflow milestones to 100% / MOCK_READY. Blocking and waiting do not advance progress without a milestone. At the end of the demo, all eight agents are COMPLETED. Restarting the demo replays the same events, routes, effects and percentages.

## Run and validate

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm run build
npm run typecheck
npm test
node scripts/security-scan.mjs
npm run preview -- --host 127.0.0.1 --port 5175
```

There is currently no lint script or ESLint configuration. On Windows with a trusted root CA installed in the system store, `NODE_USE_SYSTEM_CA=1` allows Node/npm to use that trust store without disabling TLS verification.

## Architecture

`mockAdapter → timed HQEvent → HQStore → pure hqReducer → immutable HQState → React panels + OfficeScene → AgentMotion → AgentSprite`

- Domain contracts are shared data types. The reducer has no React, Pixi or adapter dependency.
- React subscribes with `useSyncExternalStore`. A lifecycle bridge mounts/destroys the scene and forwards snapshots.
- Pixi receives snapshots and emits selection intent through a callback. It imports neither adapters nor the store.
- Only a changed snapshot destination creates a route. Idle agents do not wander. Blocked agents stop; resumed snapshots allow the same route to continue.
- Pixi interpolates coordinates along a deterministic BFS zone graph. Presentation pulses do not choose destinations or update domain state.
- Mock timeline covers IDLE, RUNNING, WAITING, BLOCKED, QA and COMPLETED, plus more specific task/waiting states. Research moves to Research Lab, Creative to Aria Link and Performance to Supermemory Core. Campaign progress comes from numeric milestones on mock events, not elapsed time or frames.
- Restart resets snapshots, routes, transient effects and processed event IDs. Cleanup cancels intervals and stale asynchronous initialization, including React StrictMode remounts.
- A memory archive effect requires a verified mock event. Its request origin is temporary visual state consumed on archive; it never performs a real memory write.
- The Munder boundary validates canonical records but has no real connection; GitHub, Aria Studio and Supermemory remain stubs/read-only. No external generation, publishing, commit or memory-save APIs run.

## Limitations

This is an observer foundation, not an agent runner or a publishing system. There is no live Munder feed in production yet. Routing uses zone adjacency, not collision-aware tile navigation. In MOCK, task snapshots remain initial demo data; agent and campaign projections carry the animated scenario. A campaign reaching MOCK_READY does not grant human approvals, approve a visual asset or publish content. A real raw-data mapper, secure transport and source-specific validation remain future work.

Tests cover 49 zone pairs, deterministic motion and milestone progress, pause/resume, station arrival, visual handoff and memory timelines, temporary memory-origin consumption, reducer immutability and state coverage, complete mock destinations, StrictMode/restart/selection cleanup and adapter isolation. v0.5 adds canonical-feed validation, stable event ordering/deduplication, disconnected/degraded source handling, recovery, explicit mode switching and no silent fallback. The connected-source tests use synthetic fixtures, not an actual Munder feed. Security scanning covers application files and build output; registry dependency internals are excluded and can be checked separately with npm audit.
