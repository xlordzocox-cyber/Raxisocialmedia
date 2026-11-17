-- Conexiones v1: provider API keys stored in Supabase Vault. Clients never read or write the secret.
create extension if not exists supabase_vault with schema vault;

create table public.raxi_provider_connections (
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  provider text not null check (provider in ('WAVESPEED')),
  secret_id uuid not null,
  last4 text not null check (length(last4) = 4),
  status text not null check (status in ('CONNECTED','INVALID')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);
alter table public.raxi_provider_connections enable row level security;
create policy raxi_provider_connections_owner_read on public.raxi_provider_connections for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_provider_connections from anon, authenticated;
grant select (workspace_id, provider, last4, status, verified_at, updated_at) on public.raxi_provider_connections to authenticated;

-- Store or rotate a key. Called only by the provider-connection Edge Function (service_role) after it verified the key.
create or replace function public.raxi_connection_store(p_actor uuid, p_provider text, p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_secret uuid; v_last4 text;
begin
  if p_provider not in ('WAVESPEED') then raise exception 'invalid provider' using errcode = '22023'; end if;
  if p_secret is null or length(p_secret) < 16 or length(p_secret) > 512 then raise exception 'invalid secret' using errcode = '22023'; end if;
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  v_last4 := right(p_secret, 4);
  select c.secret_id into v_secret from public.raxi_provider_connections c where c.workspace_id = v_ws and c.provider = p_provider for update;
  if found then
    perform vault.update_secret(v_secret, p_secret);
    update public.raxi_provider_connections set last4 = v_last4, status = 'CONNECTED', verified_at = now(), updated_at = now()
     where workspace_id = v_ws and provider = p_provider;
  else
    v_secret := vault.create_secret(p_secret, 'raxi_' || lower(p_provider) || '_' || v_ws::text, 'Raxi HQ provider key');
    insert into public.raxi_provider_connections (workspace_id, provider, secret_id, last4, status, verified_at)
     values (v_ws, p_provider, v_secret, v_last4, 'CONNECTED', now());
  end if;
  insert into public.raxi_audit_events (workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_ws, 'PROVIDER_CONNECTION_STORED', 'HUMAN', p_actor, 'raxi_provider_connections', p_provider, 'raxi-hq-conexiones', jsonb_build_object('provider', p_provider), now(), now());
  return jsonb_build_object('provider', p_provider, 'last4', v_last4, 'status', 'CONNECTED');
end $$;

create or replace function public.raxi_connection_remove(p_actor uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_secret uuid;
begin
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  delete from public.raxi_provider_connections where workspace_id = v_ws and provider = p_provider returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
  insert into public.raxi_audit_events (workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_ws, 'PROVIDER_CONNECTION_REMOVED', 'HUMAN', p_actor, 'raxi_provider_connections', p_provider, 'raxi-hq-conexiones', jsonb_build_object('provider', p_provider), now(), now());
  return jsonb_build_object('provider', p_provider, 'status', 'NOT_CONNECTED');
end $$;

-- Read the decrypted key. Server-side only: used by provider-connection (test) and, later, creation-command.
create or replace function public.raxi_connection_secret(p_actor uuid, p_provider text)
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
  from public.raxi_provider_connections c
  join public.raxi_workspaces w on w.id = c.workspace_id and w.owner_user_id = p_actor and w.slug = 'raxi-hq'
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.provider = p_provider;
$$;

create or replace function public.raxi_connection_mark(p_actor uuid, p_provider text, p_status text)
returns void language sql security definer set search_path = '' as $$
  update public.raxi_provider_connections c set status = p_status, verified_at = case when p_status = 'CONNECTED' then now() else c.verified_at end, updated_at = now()
  from public.raxi_workspaces w
  where w.id = c.workspace_id and w.owner_user_id = p_actor and w.slug = 'raxi-hq' and c.provider = p_provider and p_status in ('CONNECTED','INVALID');
$$;

revoke all on function public.raxi_connection_store(uuid, text, text) from public, anon, authenticated;
revoke all on function public.raxi_connection_remove(uuid, text) from public, anon, authenticated;
revoke all on function public.raxi_connection_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.raxi_connection_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.raxi_connection_store(uuid, text, text) to service_role;
grant execute on function public.raxi_connection_remove(uuid, text) to service_role;
grant execute on function public.raxi_connection_secret(uuid, text) to service_role;
grant execute on function public.raxi_connection_mark(uuid, text, text) to service_role;
