# Raxi HQ Office v0.3 — Visual Office Pass

Local mock, read-only office demo. No external integrations or credentials.

The v0.3 visual pass adds seven open isometric rooms, procedural furniture and role-specific chibi avatars. All artwork is drawn locally in Pixi, with no external/proprietary assets. Furniture stations match the unchanged v0.2 work endpoints, including all four visual seat slots. Characters and furniture sort together by ground Y; local limb animation never changes the motion coordinates. Verified mock memory events animate an isometric knowledge pulse.

Drag empty floor to pan, use the wheel or +/- to zoom, and choose Centrar to reset. Zoom is limited to 80–280% of the responsive fitted view and panning is bounded. Hover shows a React inspection card; click selects the full agent panel. Only hovered/selected avatars show names. Handoffs produce a short gesture, bubble and transfer packet. The v0.2 engine, reducer, contracts, mock adapters, zone coordinates and route logic are preserved, so the mock campaign retains its original v0.2 title.

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
- Mock timeline covers IDLE, RUNNING, WAITING, BLOCKED, QA and COMPLETED, plus more specific task/waiting states. Research moves to Research Lab, Creative to Aria Link and Performance to Supermemory Core.
- Restart resets snapshots, routes, transient effects and processed event IDs. Cleanup cancels intervals and stale asynchronous initialization, including React StrictMode remounts.
- A memory archive effect requires a verified mock event. It never performs a real memory write.
- The Munder Difflin, GitHub, Aria and Supermemory directories contain boundary documentation only. No connection, generation, publishing, commit or memory-save APIs run.

## Limitations

This is a mock visualization, not an agent runner or a publishing system. Routing uses zone adjacency, not collision-aware tile navigation. Task snapshots remain initial demo data; agent and campaign projections carry the animated scenario. A campaign reaching MOCK_READY does not grant human approvals, approve a visual asset or publish content. External adapters remain future work.

Tests cover 49 zone pairs, deterministic motion, pause/resume, bounded seating, reducer immutability and state coverage, complete mock destinations, StrictMode/restart/selection cleanup and adapter isolation. Security scanning covers application files and build output; registry dependency internals are excluded and checked separately with npm audit.
