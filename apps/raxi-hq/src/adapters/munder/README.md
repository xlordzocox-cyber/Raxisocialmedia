# Munder Adapter Boundary

Reserved for a future read-only adapter that maps Munder Difflin/Codex task and handoff events into Raxi HQ contracts.

Rules for v0.2:

- no real connection;
- no control of agents;
- no writes;
- no credentials in frontend;
- renderer consumes only `AgentSnapshot`, `TaskSnapshot`, and `HQEvent`.
