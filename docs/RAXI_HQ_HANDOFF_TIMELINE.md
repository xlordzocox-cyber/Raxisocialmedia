# P2B — Handoff Timeline & Evidence-Gated Visuals

Date: 2026-10-31. Base verified: main `d265454c7b8ce2db22e94667f9b9fda84d5b1714`, after merged P1/PR40 and P2A/PR41. Separate branch/worktree; PR39 remained open/draft at `2fefe4c` and was not modified. The ten image deletions in the original checkout are outside this increment.

## Confirmed problem and reproduction

Before changing production code, two new regressions called the actual `OfficeScene.update()` path with present sender/receiver motions and an initial LIVE history event dated `2000-01-01T00:00:00Z`. Both `verified:true` and `verified:false` constructed **one actual HandoffEffect**, where zero was expected. This was a behavioral reproduction, not a static assumption. Node uses a minimal canvas resource adapter for Pixi graphics; it is not evidence of hosted execution or a WebGL test.

The old event loop applied no adequate source/evidence gate. It could animate initial LIVE history, and a repeated snapshot only happened to be suppressed by the scene's existing seen-ID set.

## Minimal architecture

- `handoffPolicy.ts` is a pure shared projection/policy, used by the React timeline and Pixi scene. It does not admit a new feed, authenticate a source, authorize execution or replace the canonical source validators.
- `HandoffTimeline` reads admitted `HQState.events` beside the task board. It ignores `HQState.handoffs` as evidence. It adds no store, transport, subscription, timer, operational callback or event correlation.
- `OfficeScene` uses the policy before constructing or retaining handoff effects. It reuses existing `HandoffEffect`, `handoffFrame`, current `AgentMotion.position`, camera behavior and the P1 reduced-motion preference. No motion routes or agent task/state/approval data are changed.
- Existing `HandoffEffect` adds only optional original event-ID/header-key references for transient cleanup. The key is an exact JSON header comparison, not a cryptographic digest, signature or receipt. Labels and payloads never authorize or drive this representation.
- `AgentSprite.cancelHandoff()` is the necessary narrow avatar addition: destroying a packet alone would leave the existing bubble/handing flag active until its timeout. Cancellation hides that bubble and expires only its handoff flag; the next existing animation tick restores ordinary status visuals. It grants no capability and changes no domain metadata.

No new runtime, coordinator, ledger, adapters, HTTP/RPC/MCP endpoints, permissions, provider registrations or hosted source of trust is introduced.

## Trust policy

| Context | Timeline | Handoff animation |
| --- | --- | --- |
| Coherent MOCK | DEMO/MOCK, even when source tags say aria/github/supermemory or verified is true | Existing DEMO animation only for HANDOFF_SENT/ASSET_RECEIVED with coherent available references, distinct present endpoints and finite positions |
| Connected LIVE_READ_ONLY using the existing main-office Munder contract | Source declarations, explicitly without independent evidence | **Always disabled**, regardless of verified, event age, initial load, later arrival or future timestamp |
| LIVE disconnected/degraded or inconsistent context | No stale declaration rows; explicit unavailable state | Remove handoff effects; never substitute MOCK |
| HISTORICAL_REPLAY | Current admitted Codex capture has no Raxi handoffs | Disabled; no invented task/asset/receiver or attribution to Director/Researcher |

MOCK coherence requires matching mode/mockMode/source-health mode, mock source health and CONNECTED. A LIVE context labeled mock/codex is not silently accepted as the main-office live contract. LIVE header/source disagreement remains visibly unconfirmed, never independently certified. Existing canonical admission remains responsible for raw source validation.

The LIVE rule is intentionally stronger than a freshness watermark: **no LIVE event currently has an admitted independent transfer-evidence chain**, so even a newly received verified header cannot start a transfer animation. No caller timestamp is interpreted as execution time, liveness, receipt time or authority. Native ISO timestamps are displayed unchanged as declared metadata, with no relative-time correlation.

### Meaning and references

- HANDOFF_SENT: sending declared, not reception confirmed.
- HANDOFF_RECEIVED: reception declared, not approval or task completion. P2B records it but does not add a new DEMO choreography for it.
- ASSET_RECEIVED: asset reception declared, not QA passed, a stored original, or publication authorized.
- Source names resolve only through own records in the current office, with matching record IDs. Missing IDs remain missing; unresolved IDs remain visible references. Reserved strings never resolve through inherited properties.
- Optional task/asset IDs are not fabricated. A missing optional ID remains a warning; an available contradictory reference blocks DEMO eligibility. A referenced task must be an own record with the same ID; a declared owner outside the endpoints or contradictory task/event/agent campaigns is warned, without changing ownership.
- A local independent reviewer reproduced a missed case: task/owner campaigns conflicted while event.campaignId was absent. The fix reuses P1 `taskOwnerMetadata` with the task's present declared owner, so the conflict is caught without inferring an owner or requiring an event campaign. A dedicated regression covers it.
- Duplicate IDs within a snapshot are collapsed to an explicit ambiguous-ID row; no version's endpoint/time/type fields are selected as canonical and no animation is allowed. Distinct event IDs are never paired through matching task/asset/time values.

The timeline does not render arbitrary source labels, payload bodies, instructions, guessed links, asset paths, messages or model results. Its evidence label describes limitations; it is not an approval control.

## Lifecycle and resource controls

The existing scene seen-ID set prevents replay on repeated snapshots. Skipped events (reduced motion, unavailable positions, occupied endpoints) are consumed, not queued to animate later. An active effect references its original ID and exact relevant header, so a changed header, duplicate/conflicting row, withdrawn reference or lost context cancels it.

At most **two handoff effects** run at once, with no shared endpoint. They retain the original finite 1900ms visual timeline. Packet cancellation restores affected sprites to their current motion positions and cancels only their handoff bubble; it does not teleport the underlying motion or mutate snapshots. Turning reduced motion on cancels active effects and suppresses new ones; it does not replay them when turned off.

Mode/source/historical-scope changes retain the existing full scene reset semantics. Connection/context/reference loss also removes handoffs when no full reset occurs. Account/logout invalidation continues through HQStore's existing scope mechanism and App ownership, with no new session system. Destruction cancels handoff effects and rejects later frames/updates. Manual focus/selection and the existing critical-follow opt-in keep P1 behavior; a handoff's zone highlight does not acquire camera authority.

### Explicit residual risk outside handoffs

`MemoryArchiveEffect` and its existing verified-boolean path remain unchanged. They are **not** certified by this policy; their provenance/initial-history treatment needs its own review. A regression verifies that handoff-only cleanup preserves unrelated effects instead of silently changing them. Existing context-wide resets still dispose all visual resources as before. P2B does not claim that every other office animation has an independent evidence chain.

## Future real-transfer contract — proposal only

Before enabling any real-transfer visualization, a separately reviewed producer/contract would need authenticated source and workspace scope, immutable native event/run/task/agent identities, explicit send/receive semantics, original receipt references, canonical asset ID/version/hash when applicable, independently checked integrity/provenance, replay/order/conflict handling, revocation/freshness policy and fail-closed snapshot admission. Dispatch alone must not mean provider processing; asset receipt must not mean human QA or publication approval. Correlation must use documented identifiers, never approximate timestamps.

This is not implemented in P2B. No SQL, source adapter, signing scheme, receipt ledger or new evidence endpoint was added. Browser fields and a verified boolean cannot self-authorize the future policy.

## Files and boundaries

- `apps/raxi-hq/src/office/handoffPolicy.ts`: shared pure rules and header identity.
- `apps/raxi-hq/src/office/ui/HandoffTimeline.tsx`: provenance, declared fields, missing/conflicting references, native keyboard-accessible details.
- `apps/raxi-hq/src/office/OfficeScene.ts`: gated creation/retention, bounded effects, handoff-only cleanup.
- `apps/raxi-hq/src/office/effects/HandoffEffect.ts`: optional original event references only; visual timeline unchanged.
- `apps/raxi-hq/src/office/agents/AgentSprite.ts`: narrow cancellation method only.
- `apps/raxi-hq/src/App.tsx`, `src/design/global.css`: adjacent P2A integration, dark/cyan/lilac responsive presentation.
- `apps/raxi-hq/tests/handoffTimeline.test.tsx`, existing test-runner registration: new regressions, previous tests retained.
- `apps/raxi-hq/tests/manual/handoffs.{html,tsx}`: isolated, explicit synthetic presentation lab; no new admitted source or real activity. An optional `?motion=reduce` preference fixture is labeled and changes no OS setting.
- This document and screenshots under `output/reports/raxi-hq-handoff-evidence/`.

Runtime/host, Supabase, SQL/migrations/manifests, canonical adapters, domain contracts, HQStore/reducer, historical observer, P1/P2A components, motion routes, camera helper, `visualTimelines.ts`, MemoryArchiveEffect, provider integrations and dependencies/lockfile are unchanged. No real provider, Aria, image generation, publication, new billable infrastructure, recurring work or Guardian activation occurred.

## Validation and authorization boundary

Reproducible installation used `npm ci --ignore-scripts` against the unchanged lockfile. The mission's initial no-SQL rule conflicted with the existing full suite, which uses local PGlite. The user explicitly authorized **only SQL in the existing local test suite with synthetic data**, without Docker or hosted Supabase. No such exception was assumed and no hosted SQL/migration was applied.

Commands from `apps/raxi-hq`:

```text
npm ci --ignore-scripts
npm test
node tests/stagingSafety.test.mjs
npm run typecheck
npm run build
npm audit --json
```

Final executed results: **720/720 application tests PASS**, including **38 new P2B regressions**; **214/214 focused tests** (P1, P2A, observer and P2B, included in the application total); **1/1 offline staging guard PASS**, **721 total**. Zero failures/skips/cancellations. Typecheck, build and diff checks PASS. An earlier intermediate 717-test run is not substituted for the rebuilt final suite after the reviewer fix and extra lifecycle tests.

Regressions cover real scene construction of a HandoffEffect before/after the critical fix, verified true/false LIVE, multiple MOCK source tags, missing/foreign/inherited endpoints, exact and conflicting duplicates, task/campaign contradictions including absent event campaign, optional IDs, unpaired sent/received declarations, old initial history and later headers, repeated snapshots, trust loss/restoration, preserved unrelated effects, changed IDs/headers, account/logout subscription invalidation, destruction, StrictMode/read-only UI, reduced motion, avatar bubble cancellation, bounded effects and preserved camera/selection. No earlier test was removed.

`npm audit` exits 1 with the unchanged preexisting moderate `qs@6.16.0` advisory [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), zero high/critical. Remediation stays separate; this is not a vulnerability-free claim. Existing react-test-renderer deprecation warnings remain.

Ignored `.validation/` logs and compiled bundles are not published. SHA-256 of final logs:

| Artifact | SHA-256 |
| --- | --- |
| `handoff-final-tests.log` | `d9b0c3c6d9b015271778be5081353550efefc990a2b3bf0f718b41289c4c0aac` |
| `handoff-focused-final.log` | `7e9d118b3ef476c6c10f50f3c6e33b36f39ae5cbbec3688f10853a2af03eb53c` |
| `handoff-staging-guard.log` | `e1b6c85f3526eeb2ea98d9f8f95541ff827292b465332ec4f283372bddb14d8c` |
| `handoff-typecheck.log` | `236189c12f0a4a176be02a7e6dae4a48b84cf0bc7b101374891c5d1457577ede` |
| `handoff-build.log` | `67c9d7a8238a62d40c44c33c6b81177349cb4e3e01882d1e1dd855972a2957a0` |
| `handoff-audit.json` | `e5f34547f0af478c4918deed42013f3a55f67da8284ed208dd14059a99beb485` |

## Browser QA and evidence

The existing localhost Vite script was used on loopback port 5178; no deployment or service installation. The synthetic lab explicitly labels **all** its inputs as fixtures (including its LIVE mode); it is not an integration with Munder or an executor. The existing App observation harness separately admitted the actual pinned Codex historical capture, with Auth/repositories still test doubles.

Real browser/WebGL observations:

- DEMO envelope and handoff visuals were captured on screen, alongside DEMO/MOCK evidence labels and missing optional IDs.
- Switching an active DEMO to the synthetic LIVE verified:true scenario removed transfer representation; details said source declaration without independent evidence.
- Disconnection removed rows; synthetic historical showed no handoffs. The actual App's admitted historical capture also showed no Raxi tasks/handoffs, preserving P2A.
- Native summary Enter/Space exposed provenance fields, with visible keyboard focus. At 390×844 the page width was 375 (scrollbar excluded), without horizontal overflow.
- The mobile reduced-motion fixture retained declarations/details while suppressing the transfer. Exact no-effect/cancellation guarantees are asserted by tests, not inferred from a still image.
- Initial development loads encountered React-refresh preamble/createRoot hot-reload errors. A clean reload after source edits resolved the harness state; the final reload/QA window reported no new console errors. No production entrypoint workaround was added.

Screenshots are native browser captures, not generated images:

- [Desktop DEMO envelope](../output/reports/raxi-hq-handoff-evidence/demo-transfer-desktop.jpg)
- [Synthetic LIVE verified:true, declaration only](../output/reports/raxi-hq-handoff-evidence/live-verified-declared.jpg)
- [Synthetic LIVE disconnected](../output/reports/raxi-hq-handoff-evidence/live-disconnected.jpg)
- [Synthetic historical without handoffs](../output/reports/raxi-hq-handoff-evidence/historical-no-handoffs.jpg)
- [Mobile reduced-motion fixture](../output/reports/raxi-hq-handoff-evidence/mobile-reduced-demo.jpg)
- [App with authentic admitted historical capture](../output/reports/raxi-hq-handoff-evidence/app-authentic-historical.jpg)

These prove presentation in a real browser, not real transfers, hosted identity, physical-device/screen-reader certification or a receipt chain. Still images do not establish exact animation timing; deterministic scene regressions cover that.

## Review and rollback

Independent local review found and reproduced the additional task/owner campaign P2, now corrected using P1's shared rule and a new regression. Review of the immutable published HEAD and a GitHub Codex review are separate gates; test success does not grant merge authority. If review quota is unavailable, report it rather than claiming review completion.

Rollback is a revert of this visual/test/documentation increment. There is no data/schema recovery, hosted rollout or receipt reconciliation to undo. Keep the PR open in draft and stop for human approval; enabling actual transfer evidence requires a separately authorized design/implementation.
