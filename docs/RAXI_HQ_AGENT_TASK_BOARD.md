# P2A — Task Board, main office, read-only

Base verified from GitHub: `aafcf31bdd3918b221a41a7612524eefbb31fb46` (main after merged PR40, corrective HEAD `dc95017`). PR39 was independently checked open/draft at `2fefe4c`; no PR39 checkout or files were changed. Work is on a separate branch/worktree. P2B remains unimplemented and requires separate authorization.

## Architecture and scope

The board reads the same admitted `HQState.tasks`, agents and campaigns as the main office. `OfficeAgentView` supplies existing mode/source/connection labels. It neither queries a repository nor synthesizes tasks from events. `RuntimeOfficePanel` and its independent projection remain outside this increment.

`AgentTaskBoard` owns only two React filter values. It creates no external store, coordinator, ledger, timer or source adapter. The existing `HQStore` remains canonical for agent selection. Filtering does not select an agent, alter assignments, write events, approve work or issue additional requests. The existing mounted App regression checks unchanged canonical snapshots and zero additional fetch/repository reads after repeated filtering.

The component key includes the account scope, office mode, source, connection and historical run. This invalidates filters synchronously when that context changes, including repeated IDs in another account/source. Filter references removed by a roster/task refresh are excluded immediately and cleared; their later reappearance cannot silently reactivate an old filter. The scope is UI invalidation context, not authentication or authorization.

LIVE data is suppressed whenever connection is not CONNECTED, even if a caller retains stale task records. Actual historical admission supplies no Raxi tasks; the board remains empty and does not attribute them to the external Codex executor. Campus REAL is not evidence of a live execution. MOCK labels remain explicit, including when mock events contain `verified:true`.

## State classification

`TaskSnapshot.status` is an open string and the Munder canonical admission checks text, not a state enumeration. Existing MOCK tasks use `mock-ready`; the reducer updates agent statuses, not those task records. A list/grid was chosen over an editable Kanban.

The exact, closed display vocabulary below reuses tokens already accepted by the existing `RuntimeOfficeStore` task contract. This is only a visual taxonomy: it neither connects that runtime nor upgrades a source status into operational proof. No trimming, case conversion, aliases, agent-status mapping or event-derived state is applied. The original string is always visible.

| Exact token | Visual classification |
| --- | --- |
| `QUEUED` | En cola |
| `RUNNING` | En ejecución · declarado |
| `BLOCKED` | Bloqueada |
| `COMPLETED` | Completada · declarado |
| `FAILED` | Fallida |
| `CANCELED` | Cancelada |
| Everything else, including `mock-ready`, `READY`, `WORKING`, lowercase or padded values | Sin clasificación |

`approvalRequired:true` displays a **declared requirement**, explicitly not proof of an actual pending approval. `false` grants no permission and absence is shown as not informed. There are no approve, execute, assign, edit, drag/drop, retry or publish controls.

## Relationship integrity

The owner filter means **declared owner ID**, not confirmed active assignment. It includes declared owners absent from this office and retains contradictory rows with their warnings, instead of silently reassigning/filtering them under another agent. Campaign filtering likewise uses only the task's declared campaign ID.

The existing P1 owner/campaign coherence logic was extracted to the pure `taskOwnerMetadata` helper. P1's current-task ID check, return states and conservative handling of partial metadata remain unchanged and covered by its 24 regressions. This is presentation integrity, not a duplicate Auth/admission/security validator.

| Available metadata | Board presentation |
| --- | --- |
| Owner present, task-owner/campaign metadata coherent, owner's currentTaskId matches | Relación consistente · metadatos (never authorization or proof of processing) |
| Owner declares a different current task, or none | Relación no confirmada como tarea actual; this alone does not contradict ownership of a queued/future task |
| Declared owner absent | Explicit owner-not-present message; no substitute agent |
| Missing owner or unilateral campaign metadata | Información incompleta |
| Foreign agents claim this task, owner/campaign conflicts, or inconsistent campaign catalog identity | Información contradictoria |

All own task records remain cards, including contradictory ones: listing a task globally is distinct from attributing it as confirmed work of the selected agent. Owner IDs, available roster names, campaign IDs and currentTaskId references remain descriptive. A missing campaign catalog entry is a visible missing-detail warning, not an invented campaign. A matching pair without campaign metadata invents no campaign.

Task dictionary key/record-ID mismatch or repeated record IDs suppresses the whole board projection with an inconsistency message; no winning duplicate is chosen. Existing canonical source validation is unchanged. Own-property lookup/Map/Set prevent inherited IDs from resolving to tasks, owners, campaigns or dependencies. A real own `constructor` record remains a record; inherited properties do not.

Dependency order and multiplicity remain visible. Missing IDs and duplicate dependency references are warnings. Tarjan's strongly connected components mark self/multi-node/cross-edge cycles without modifying the graph, changing status, inferring a schedule or calling an executor. Upstream nodes are not falsely labeled cycle members. Agent current-task references missing from the task snapshot produce separate warnings, never phantom cards or event-reconstructed tasks. These reference warnings are also suppressed when LIVE evidence is unavailable.

Resource work is over the existing admitted snapshots (canonical LIVE bounds: 256 tasks, 32 dependencies/task and 32 agents). Cycle analysis is O(V+E); the projection does not relax those producer bounds or accept a new raw feed. The graph code is not a general unbounded-input parser.

## Files

- `apps/raxi-hq/src/App.tsx`: board from existing office state/view and account scope.
- `apps/raxi-hq/src/office/ui/AgentTaskBoard.tsx`: accessible native filters, read-only cards and source labels.
- `apps/raxi-hq/src/office/ui/taskBoardSelectors.ts`: display vocabulary, relationship/reference projections and cycle warnings.
- `apps/raxi-hq/src/office/ui/agentViewSelectors.ts`: shared P1 metadata helper, same P1 behavior.
- `apps/raxi-hq/src/design/global.css`: responsive grid, wrapping, 44px selects and visible keyboard focus.
- `apps/raxi-hq/tests/taskBoard.test.tsx`: 32 new regressions.
- `apps/raxi-hq/tests/officeUX.test.tsx`: mounted App filter checks alongside original P1 lifecycle tests.
- `apps/raxi-hq/scripts/test.mjs`: register the new test file.
- This document and `output/reports/raxi-hq-task-board/` screenshots.

No dependency/lockfile, runtime, host, Supabase, SQL/migration/manifest, domain/store/reducer, office scene, camera, AgentSprite/AgentMotion, handoff effect, Aria, publication, approval-security, Guardian or historical-observer changes. Original ten JPEG deletions stay outside this checkout/PR.

## Acceptance and verification

All tests are local; fixtures and simulated providers do not establish hosted Auth, live agency, RLS or production persistence.

| EARS | Verification |
| --- | --- |
| 01 Existing tasks only | Immutable projections; empty/event-only snapshots never create cards |
| 02 Filters are presentation | Repeated native filters; mounted App and standalone StrictMode tests, no snapshot writes or extra calls |
| 03 Unknown states | Exact-token positives and unknown/MOCK/case/padding/prototype-token negatives preserve original status |
| 04 Absent owner | Declared missing ID remains absent, no substitute |
| 05 Contradictions | Foreign current-task claims, campaign conflicts, partial metadata and catalog identity warnings |
| 06 Source/session | Account/source/mode/connection/run key; stale-filter removal and no later reactivation; existing lifecycle tests |
| 07 Disconnected LIVE | Retained stale tasks suppressed; actual admitted historical replay empty; no MOCK fallback |
| 08 Approval requirement | Descriptive label; zero action buttons/commands |
| 09 Keyboard/mobile | Native labeled selects, browser keyboard and responsive QA |
| 10 Operational integrity | Frozen snapshot regression and mounted App fetch/repository spies |
| 11 Dependencies | Missing/repeated IDs, self/mutual/cross-edge cycles, no upstream false membership or graph writes |

Reproduce from `apps/raxi-hq`:

```text
npm ci --ignore-scripts
npm run typecheck
npm test
node tests/stagingSafety.test.mjs
npm run build
npm audit --json
```

The existing local visual harness was reused without modification:

```text
npm run dev -- --host 127.0.0.1 --port 5177 --strictPort
http://127.0.0.1:5177/tests/manual/observation.html
```

Auth/repositories in that harness are explicitly test doubles. No workspace/user is created and no provider is invoked. The optional dev process is bound only to loopback and stopped after QA.

### Final results

- Reproducible installation from the unchanged lockfile: PASS (`npm ci --ignore-scripts`, no lifecycle scripts).
- Final application suite: **682/682 PASS**, including 32 new task-board regressions and the extended mounted App test.
- Focused task-board + P1 suite: **56/56 PASS** (included in the application total).
- Offline staging guard: **1/1 PASS**, **683 total**, zero failed/skipped/canceled.
- Typecheck, build, diff/protected-path checks, three relative evidence links and staged secret/path inspection across 12 paths: PASS. No staged deletions.
- Dependency audit: exit 1, one preexisting moderate `qs` advisory, zero high/critical; dependency files unchanged.
- Local independent prepublication Codex review: no blocking findings; separately repeated 32/32 new tests. The later immutable published HEAD review is distinct and reported in the PR.

The final suite was repeated after adding warnings for orphan `agent.currentTaskId` references. The first passing intermediate suite is not used in place of the final result. Raw logs and generated bundles remain ignored under the application's `.validation/`, not in this PR. Final log SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| `task-board-final-tests.log` | `7b5e0774a1ece6930b5b0cf31653637e7aef4946534114deac33ef59a752b01d` |
| `task-board-focused.log` | `acda2b88148c5ae6678c361b5040025a6529f7f301a000daf02a3c19e43bfaa4` |
| `task-board-guard.log` | `0e770ba463cb3ec34e07b2e7a112c0a9602294d34ef8aa6a624c9a0c41441853` |
| `task-board-typecheck.log` | `236189c12f0a4a176be02a7e6dae4a48b84cf0bc7b101374891c5d1457577ede` |
| `task-board-build.log` | `2cfaff0344e5c1b02fbd7b98fbb3b097d7e12de23a228df2021e156286a51649` |
| `task-board-audit.json` | `e5f34547f0af478c4918deed42013f3a55f67da8284ed208dd14059a99beb485` |

## Browser evidence and limitations

Actual browser/WebGL QA observed three MOCK tasks (all `mock-ready`, correctly unclassified), 1-of-3 owner filtering via Home/ArrowDown/Enter, Tab focus advancing to the campaign filter with a visible outline, campaign filtering, mobile filtering and explicit non-authoritative approval text. At 390×844 the document width was 375 (scrollbar excluded), with no horizontal overflow. Returning to LIVE removed rows/options/filters; loading historical capture retained zero Raxi tasks. No errors were observed after the successful harness reload/QA start.

Initial in-app browser attachment/navigation timed out, and the first dev load reported a React-refresh preamble error. Reattaching the already-created tab and reloading resolved it; no application workaround or new dependency was introduced. Those initial failures are not presented as passing QA.

- [Desktop MOCK board, full context](../output/reports/raxi-hq-task-board/desktop-mock.jpg)
- [Mobile filtered board, full context](../output/reports/raxi-hq-task-board/mobile-filtered.jpg)
- [Mobile card/approval indicator, viewport](../output/reports/raxi-hq-task-board/mobile-board-viewport.jpg)

Viewport testing is not certification on physical phones or with a screen reader. Negative/cycle cases are automated fixtures, not real source activity. LIVE remains disconnected; no operational data connection was enabled by this PR.

## Security and human gates

The preexisting moderate `qs@6.16.0` advisory [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) remains in the unchanged Pixi dependency chain. `npm audit` reports 1 moderate, 0 high/critical and exits 1; remediation is a separate increment. Existing react-test-renderer deprecation warnings remain. No vulnerability-free or deployed-service claim is made.

Independent Codex review is required on the immutable published HEAD. A local review/test result is distinct from a GitHub review completion or merge authorization. P2B, messaging, execution, hosted tests and approvals remain outside scope. Rollback is a revert of this presentation/test/documentation change; no data/schema/service recovery is needed. Keep the PR draft/open and stop for human review.
