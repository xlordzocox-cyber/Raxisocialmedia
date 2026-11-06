# Issue #49 — Docker Engine API over Windows named pipe: D1/D2

Status: **D1 design and D2 mock implementation only**. This document does not authorize a native pipe connection, a Docker subprocess, container mutation, SQL, Supabase access, hosted migrations, deployment, or PR merge. Existing Windows real transport gate remains **BLOCKED**.

## Context and trust

- PR #50 is draft. Previous mock core and driver battery passed 40/40 in Windows. Codex reviewed the original fail-closed Windows driver gate without findings.
- Docker Desktop local observed context: \`desktop-linux\`, \`npipe:////./pipe/dockerDesktopLinuxEngine\`, daemon Linux. The native named-pipe spelling proposed for later *separately authorized* probe is \`\\.\pipe\dockerDesktopLinuxEngine\`.
- Image observed \`sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe\`, \`PG_VERSION=17.11-1.pgdg13+2\`, linux/amd64; image publisher/provenance **not independently established**.
- Docker Engine API is a full-power daemon interface. Application request allowlists are not OS-level least privilege. Socket access must remain outside the UI, MCP/agent arbitrary tools, browser and externally accessible API.
- The objective is to **eliminate the path-based docker.exe spawn** and its TOCTOU window. Real Docker Desktop transport is not implemented here.

## D1 architecture and hard policy

\`\`\`
strict source + manifest + explicit operator consent
                     |
             native T0/T1 runner
                     |
         constrained request builder
                     |
       fake Engine API exchange (D2)
                     |
        simulated fixtures ONLY
\`\`\`

**Separate future D4**: Node \`http.request\` against one hard-coded local Windows pipe, with no TCP, SSH, proxy, environment-inferred socket, Docker CLI subprocess, shell, or redirects. Do not implement this connection at D2.

### Operation allowlist

Each operation is one closed shape with fixed HTTP method/path and closed JSON schema. Versioned path \`/v1.51\` is provisional and must be verified against the local daemon and the published API spec at D4 before any communication. No generic URL, HTTP method, JSON body or arbitrary command may be passed through the public API.

| Name | Request | Expected response |
|---|---|---|
| \`ping\` | GET \`/_ping\` | status 200, bounded text \`OK\` |
| \`version\` | GET \`/version\` | status 200, strict version shape |
| \`info\` | GET \`/info\` | status 200, Linux daemon ID |
| \`imageInspect\` | GET \`/images/<pinned SHA256>/json\` | 200, immutable ID, 17.11, linux/amd64 |
| \`listVolumes\` | GET \`/volumes\` | 200, exhaustive inventory (no partial success) |
| \`listContainers\` | GET \`/containers/json?all=1\` | 200, complete inventory |
| \`inspectContainer\` | GET \`/containers/<exact 64-hex ID>/json\` | 200, closed owner/isolation checks in native driver |
| \`createContainer\` | POST \`/containers/create?name=<closed role name>\` | 201, full created container ID |
| \`startContainer\` | POST \`/containers/<exact ID>/start\` | 204 |
| \`createExec\` | POST \`/containers/<exact ID>/exec\` | 201, full exec ID |
| \`startExec\` | POST \`/exec/<exact ID>/start\` | 200/101, binary framed response; no TTY |
| \`inspectExec\` | GET \`/exec/<exact ID>/json\` | 200, \`Running=false\`, \`ExitCode=0\` |
| \`deleteContainer\` | DELETE \`/containers/<exact ID>?force=1&v=1\` | 204, then independent inventory confirmation |

**D2 deliberately does not implement POST /exec/start with request-body streaming, framing/connection hijack, or server-side disconnect handling.** It only builds a mock descriptor and parses mock binary frames. These features are **blockers** for D4/D5; no assumption that an HTTP response alone demonstrates execution completion.

### Closed synthetic container policy

- Only four roles \`T0_SOURCE\`, \`T0_RESTORED\`, \`T1_SOURCE\`, \`T1_RESTORED\` within a fixed 24-character lowercase hex session.
- Name exactly \`raxi-t0t1-<session>-<role-slug>\`; label \`raxi.issue49.owner=raxi.issue49.trial.<session>\`. Image passed by exact 64-digit SHA256; no tag or pull.
- Create config: \`Image\`, \`Labels\`, \`Env\` (only synthetic trust auth), \`Tty:false\`, \`AttachStdin/Stdout/Stderr:false\`, \`OpenStdin:false\`, \`HostConfig.NetworkMode:none\`, \`Privileged:false\`, \`PublishAllPorts:false\`, \`PortBindings:{}\`, \`Binds:[]\`, \`AutoRemove:false\`, \`RestartPolicy.Name:no\`. No other fields by default. Verify what Engine defaults imply; explicitly deny arbitrary mounts, user-supplied environment and paths.
- No global \`prune\`; never delete preexisting resources. Only the exact recorded IDs, freshly owned and re-inspected, with the expected anonymous PGDATA volume.
- **Failure after POST create but before response:** do not guess ID or delete by name. Mark \`UNKNOWN_CREATED_IDENTITY\`, require operator-controlled recovery/inspection; never announce cleanup PASS.
- Capture per-resource audit evidence (operation ID, allowed path, status, content hash/size, daemon ID, immutable container ID, volume ID). Do not record secrets or a misleading operational PASS.

### Streaming and response safety

- Docker Engine non-TTY multiplexed stdout/stderr stream: 8-byte header, first byte 1 stdout / 2 stderr, next three bytes zero, last four bytes big-endian payload length. The binary test parser must reject reserved bits, unknown stream type, truncated frames and total streams larger than 8 MiB.
- Stderr is retained separately and never spliced into pg_dump archive; a successful stream is **not** proof of successful command. Independently inspect exec and require \`Running=false\` and \`ExitCode=0\`.
- Future HTTP implementation needs verified response upgrade/hijack semantics and stdin framing, cancellation, response limits, timeout, accurate transfer of binary pg_dump/archive to pg_restore, and cleanup under failure. D2 deliberately doesn't claim support.
- Docker non-2xx or wrong successful status code are errors; never reinterpret missing inventory as empty. Daemon ID must be stable across calls, including cleanup.

### Validation gates

- **D1:** specification, risk model, no runtime connection — documented.
- **D2:** pure request builder, fake-only strict response validator and binary parser, negative regressions. No Node \`http\`, \`net\`, \`spawn\`, socket path open, SQL client, Docker SDK, subprocess or network imports.
- **D3:** Node Windows QA of this exact SHA and independent Codex review; test denied endpoints, malformed IDs/names, unexpected status, missing fields, multipart/multiplex corruption and boundaries. Keep real Windows execution blocked.
- **D4:** separately authorized read-only named-pipe connectivity probe, current Docker version/API compatibility and image provenance checks. No mutate calls.
- **D5:** separately authorized synthetic four-container run, only after reviewed and tested full HTTP exec/streaming/cleanup semantics. No hosted migration without another separate review.

### Primary references

- Docker Engine API reference: https://docs.docker.com/reference/api/engine/version/v1.51/
- Docker Engine API versions: https://docs.docker.com/reference/api/engine/version-history/
- Docker daemon security: https://docs.docker.com/engine/security/
- Node.js IPC and Windows pipes: https://nodejs.org/api/net.html

### Explicit exclusions

No user-approved production integration, no real Docker pipe access, no container creation, no \`docker.exe\` spawn, no Supabase, no hosted SQL, no deployment, no merge. \`decision=BLOCKED\`, \`allowCatalogPass=false\`, \`semanticEquivalence=NOT_VERIFIED\` and \`NO_GO_HOSTED_MIGRATION\` remain invariants.
