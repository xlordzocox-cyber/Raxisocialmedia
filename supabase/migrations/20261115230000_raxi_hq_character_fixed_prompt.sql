-- Fixed prompt per character (written by Luis): Production always puts it BEFORE the scene of every photo,
-- so identity and anatomy never depend on what the Creative remembered to write.
create table public.raxi_character_profiles (
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  character_id text not null check (length(character_id) between 1 and 64),
  fixed_prompt text not null check (length(fixed_prompt) between 1 and 4000),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, character_id)
);
alter table public.raxi_character_profiles enable row level security;
create policy raxi_character_profiles_owner_read on public.raxi_character_profiles for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_character_profiles from anon;
revoke insert, update, delete, truncate on public.raxi_character_profiles from authenticated;
grant select on public.raxi_character_profiles to authenticated;
