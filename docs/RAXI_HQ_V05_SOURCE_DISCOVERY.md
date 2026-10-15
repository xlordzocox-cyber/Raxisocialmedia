# Raxi HQ v0.5 — live source discovery

This audit was completed before implementing the v0.5 source boundary. It inspects only operational metadata and documented interfaces; no credentials, `.env` files, message bodies or private session logs were opened. No external writes or agent-control operations were performed.

| Source | Classification | Location / type | Contains | Does not establish | Safe read / refresh |
| --- | --- | --- | --- | --- | --- |
| Munder Difflin runtime or ledger | NOT_FOUND | No Munder executable, running process, MCP tool, local installation directory or documented feed was found in the inspected repository and common local project/install locations. | Nothing verified. | Agent registry, task ledger, event IDs, timestamps, handoffs, status schema, transport and authorization. | No read strategy can be selected until a real source and schema are supplied. |
| Existing HQ Munder boundary | SAFE_READ_ONLY | `apps/raxi-hq/src/adapters/munder/README.md` in this repository. | Intended read-only contract boundary. | Any operational data or connection. | Read the tracked documentation when changing the boundary. |
| Codex app thread tools | READ_ONLY_WITH_CONCERNS | Host-provided `list_threads` and `read_thread` tools, documented in this Codex session. | Conversation-level IDs, status, titles, summaries and turns when explicitly queried. | A Munder agent registry, task ledger, typed HQ events, stable task IDs or a documented API callable by the Vite application. Titles, summaries and turns may contain private or untrusted text. | Host-only read on demand, with privacy review. Do not pipe thread content directly into HQ or treat it as Munder task data. No app polling is justified. |
| Codex local session storage | UNSUITABLE | Local Codex session directories were observed by name only. | No contents inspected. | Stable/public schema, safe field allowlist or absence of private prompts/secrets. | Do not parse or serve these files. No polling. |
| HQ mock adapter | SAFE_READ_ONLY | `apps/raxi-hq/src/adapters/mock/`. | Synthetic `AgentSnapshot`, `TaskSnapshot`, `HQEvent` and timed demo events. | Real Munder/Codex operational state. | Continue the existing local mock replay. |

## Mapping and gaps

- `AgentSnapshot`: Munder agent ID, display name/role, source status, zone and last event time have **no verified source fields**. Codex thread IDs and conversation status are not agent IDs or agent status.
- `TaskSnapshot`: task ID, title, owner, status and dependencies have **no verified source fields**. A conversation title is not a task record.
- `HQEvent`: source event ID, type, timestamp, actor, target and task linkage have **no verified source fields**. Codex turns are not automatically workflow events.
- A generic canonical-feed validator can verify these HQ contracts if a documented read-only producer is provided later. It cannot create a Munder-specific mapper without a real raw schema.

## Security and update decision

Operational text from tools is untrusted data, never instructions. A future source needs a documented schema, stable IDs and timestamps, an explicit read-only allowlist, sanitized errors and a local-only bridge if filesystem or network access is required. Credentials must remain outside the browser bundle. Arbitrary paths, local session files and write/control APIs are excluded.

No LIVE polling frequency is justified for the currently absent source. After an actual feed is documented and measured, start with a conservative read interval (for example, 5 seconds), back off on failure and expose last successful read and source-event timestamps. This is a future proposal, not an implemented connection.

For v0.5, LIVE_READ_ONLY must remain visibly DISCONNECTED with no fabricated agents, tasks or events. The user may manually return to MOCK. No silent fallback is permitted.
