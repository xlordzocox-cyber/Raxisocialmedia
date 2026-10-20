# Raxi HQ v0.9 — manual idea persistence

The first three files in `migrations/` were fetched from the existing remote history with Supabase CLI 2.121.0. They are a baseline, not new deployments. Their hashes and the original table/RLS inventory are in `schema-baseline.json`. Do not reapply them to the existing project or reset production.

`20261019231655_raxi_hq_real_idea_write.sql` adds only two audit uniqueness indexes and four RPCs. No table was recreated, no existing operational write grant was widened, and no DEMO data was seeded. The SQL was applied in a transaction using `db query` while validating, then the exact generated version was recorded once using `migration repair --status applied`. `migration list` confirms all four local and remote versions match. A local shadow database was not used; no second `db pull` baseline or duplicate migration was generated.

## Trust boundaries

- `raxi_get_workspace`, `raxi_create_workspace`, and `raxi_list_manual_ideas` run as `SECURITY INVOKER` for `authenticated`. Workspace creation derives `auth.uid()` and uses the existing owner INSERT policy. Reads retain the existing RLS policies.
- The browser calls `create-real-idea` using its session JWT and publishable key. Edge calls Auth `getUser(token)` and rejects missing, invalid and anonymous sessions. Request data cannot choose actor, provenance, scores, approvals, status or timestamps.
- Edge alone calls `raxi_create_manual_idea(actor, command)` with its managed server service credential. `PUBLIC`, `anon` and `authenticated` cannot execute this RPC. It checks workspace ownership inside the transaction, locks the workspace, validates inputs again, creates a PROPOSED manual idea, and inserts its audit event atomically. No `SECURITY DEFINER` functions are used.
- Replays are serialized by the workspace lock. The same operation and JSON command return the original row/audit. Changing that payload, or reusing an external ID for a new operation, is a conflict. Unique indexes independently enforce one audit per operation and per created idea.
- Stored audit records carry the authenticated actor, external ID, exact operation and creation timestamp. Timestamps come from PostgreSQL. Both ideas and audit are read-only for browser clients.

This increment supports only creating and reading manual ideas. Approvals, transitions, campaigns, photos, agents and Realtime remain outside this write API. A manual reference is opaque, unverified text, never fetched or counted as research.

## Deployment and verification

Use an authorized CLI session, never a privileged browser environment variable:

```sh
supabase db query --linked --project-ref jrkefsylpfriiqefcmzq --file supabase/inspection.sql --output json
supabase migration list --linked --project-ref jrkefsylpfriiqefcmzq
supabase functions deploy create-real-idea --project-ref jrkefsylpfriiqefcmzq --use-api
supabase db query --linked --project-ref jrkefsylpfriiqefcmzq --file supabase/tests/idea-persistence.sql --output json
supabase db advisors --linked --project-ref jrkefsylpfriiqefcmzq
```

`tests/idea-persistence.sql` uses the actual owner from the workspace and a different generated JWT subject to exercise the real PostgreSQL roles/RLS. It checks anonymous/direct writes, cross-workspace reads, forged ownership, service-only execution, replay, conflicts, external IDs, forbidden transitions, and audit atomicity. All probe rows are rolled back; sequence gaps are expected. This does not create another Auth account.

Managed Edge environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) remain on the server. The frontend uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, in ignored `.env.local`. Migration inspection deliberately excludes user rows and credentials. Do not run inspection SQL that exports Auth tokens or account secrets.
