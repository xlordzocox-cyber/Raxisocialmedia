-- Permit an authenticated owner to create their own workspace; RLS checks auth.uid().
grant insert on public.raxi_workspaces to authenticated;;
