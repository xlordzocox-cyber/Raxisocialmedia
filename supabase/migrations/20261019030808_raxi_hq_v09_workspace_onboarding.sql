-- Workspace creation requires owner-scoped RLS and least-privilege column grants.
-- The v0.9 private core already grants exactly these three INSERT columns.
-- Reassert the same grants for onboarding; NEVER grant whole-table INSERT.
grant insert (owner_user_id, slug, name) on public.raxi_workspaces to authenticated;
