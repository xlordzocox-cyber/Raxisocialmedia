# RAXI GUARDIAN — Runtime Status

**Date:** 2026-10-16  
**Policy:** `docs/security/RAXI_GUARDIAN.md`  
**Policy status:** ACTIVE  
**Runtime status:** GUARDIAN NOT ACTIVE

## Verified environment

- Codex: `0.162.0-alpha.17.2`
- NVIDIA SkillSpector CLI: not installed / command not found at verification time
- NVIDIA `skill-inspector` skill: installed
- Existing hooks: four hooks detected and preserved
- Local workspace: no Git metadata; remote canonical policy was read directly from GitHub `main`
- Canonical policy commit verified by Codex: `89264be7db3952ba594b669266eca58752562c63`

## Blocking compatibility issue

The current Codex build does not support the approval behavior required by RAXI GUARDIAN for `DO_NOT_INSTALL` decisions:

```text
PreToolUse.permissionDecision = "ask"
```

Codex parses `permissionDecision: "ask"` but treats it as unsupported. The hook run is reported as failed and the pending command may continue. This means the intended human-approval escalation cannot currently be implemented safely with this build.

Official reference:

- https://learn.chatgpt.com/docs/hooks#pretooluse

## Decision

Do not activate the RAXI GUARDIAN runtime on Codex `0.162.0-alpha.17.2` under the current policy.

Do not silently replace `ask` with `allow` or `deny`, because either substitution changes the approved decision model.

The canonical security policy remains active, but runtime interception remains disabled until a future Codex build explicitly supports and successfully demonstrates `permissionDecision: "ask"` for `PreToolUse`.

## Pending work

When Codex adds support for `permissionDecision: "ask"`:

1. Re-check official hooks documentation and installed Codex behavior.
2. Verify `skillspector --help` and install SkillSpector CLI only if still absent.
3. Create the guard script.
4. Show the exact configuration diff before changing hooks/settings.
5. Preserve all existing hooks.
6. Run simulated tests without cloning/installing targets.
7. Prove the real `PreToolUse → Guardian → SkillSpector → decision` runtime chain.
8. Only then change status to `GUARDIAN ACTIVE`.

Until then, manual use of `skill-inspector`, Sentry `skill-scanner`, and the RAXI security policy remains available for pre-installation review, but must not be represented as an active runtime guard.
