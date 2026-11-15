-- Fototeca v1: portfolio collections/items, Aria archive queue, owner decision RPC, storage read-policy fix.
create extension if not exists pg_net with schema extensions;

-- 1) Fix: storage owner-read policy compared against raxi_workspaces.name instead of storage.objects.name.
drop policy if exists raxi_hq_private_owner_read on storage.objects;
create policy raxi_hq_private_owner_read on storage.objects for select to authenticated
using (bucket_id = 'raxi-hq-private' and exists (
  select 1 from public.raxi_workspaces w
  where w.id::text = split_part(storage.objects.name, '/', 1) and w.owner_user_id = (select auth.uid())));

-- 2) Collections (a campaign as shown in the Fototeca).
create table public.raxi_portfolio_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  external_id text not null check (length(external_id) between 1 and 128),
  character_id text not null check (length(character_id) between 1 and 64),
  title text not null check (length(title) between 1 and 160),
  channel text not null check (channel in ('INSTAGRAM','INSTAGRAM_STORY','TEASER','FANVUE_FEED','FANVUE_CHAT')),
  status text not null default 'DRAFT' check (status in ('DRAFT','IN_REVIEW','APPROVED','PUBLISHING','PUBLISHED','ARCHIVED')),
  concept text check (length(concept) <= 4000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_id),
  unique (workspace_id, id)
);

-- 3) Items (one publication: photo + text + status).
create table public.raxi_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  collection_id uuid not null,
  position integer not null check (position between 1 and 999),
  asset_id uuid,
  aria_file text check (length(aria_file) <= 300),
  caption text check (length(caption) <= 2200),
  alt_text text check (length(alt_text) <= 1000),
  hashtags text[] not null default '{}' check (cardinality(hashtags) <= 30),
  crop text not null default '4:5' check (crop in ('1:1','4:5','9:16','16:9','ORIGINAL')),
  qa_status text not null default 'VISUAL_REVIEW_REQUIRED' check (qa_status in ('VISUAL_REVIEW_REQUIRED','PRELIMINARY_PASS','NEEDS_FIX','PASS','FAIL')),
  qa_notes text check (length(qa_notes) <= 2000),
  human_decision text not null default 'PENDING' check (human_decision in ('PENDING','APPROVED','REJECTED')),
  decided_at timestamptz,
  status text not null default 'DRAFT' check (status in ('DRAFT','READY','PUBLISHED','SKIPPED')),
  published_url text check (published_url is null or published_url ~ '^https://(www\.)?instagram\.com/'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, collection_id, position),
  foreign key (workspace_id, collection_id) references public.raxi_portfolio_collections(workspace_id, id) on delete restrict,
  foreign key (workspace_id, asset_id) references public.raxi_assets(workspace_id, id) on delete restrict
);
create index raxi_portfolio_items_collection_idx on public.raxi_portfolio_items(workspace_id, collection_id, position);

-- 4) Archive queue: privileged roles enqueue; the Edge Function processes; owner can read status.
create table public.raxi_archive_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  source_url text not null check (source_url like 'https://studio.ariacruz.com/mcp/img?%'),
  aria_file text not null check (length(aria_file) between 1 and 300),
  character_id text not null,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','DONE','FAILED')),
  asset_id uuid,
  error text,
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, asset_id) references public.raxi_assets(workspace_id, id) on delete restrict
);
create unique index raxi_archive_requests_file_uidx on public.raxi_archive_requests(workspace_id, aria_file) where status <> 'FAILED';

-- 5) RLS: owner read only; no direct client writes.
alter table public.raxi_portfolio_collections enable row level security;
alter table public.raxi_portfolio_items enable row level security;
alter table public.raxi_archive_requests enable row level security;
create policy raxi_portfolio_collections_owner_read on public.raxi_portfolio_collections for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
create policy raxi_portfolio_items_owner_read on public.raxi_portfolio_items for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
create policy raxi_archive_requests_owner_read on public.raxi_archive_requests for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_portfolio_collections, public.raxi_portfolio_items, public.raxi_archive_requests from anon;
revoke insert, update, delete, truncate on public.raxi_portfolio_collections, public.raxi_portfolio_items, public.raxi_archive_requests from authenticated;
grant select on public.raxi_portfolio_collections, public.raxi_portfolio_items, public.raxi_archive_requests to authenticated;

-- 6) Owner decision on one publication (approve / reject / reset / mark published).
create or replace function public.raxi_portfolio_decide(p_item uuid, p_decision text, p_published_url text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.raxi_portfolio_items;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'owner required' using errcode='42501'; end if;
  select i.* into v from public.raxi_portfolio_items i join public.raxi_workspaces w on w.id=i.workspace_id
   where i.id=p_item and w.owner_user_id=auth.uid() for update of i;
  if not found then raise exception 'not found' using errcode='42501'; end if;
  if p_decision = 'APPROVED' then
    if v.qa_status in ('FAIL','NEEDS_FIX') then raise exception 'QA blocks approval' using errcode='22023'; end if;
    update public.raxi_portfolio_items set human_decision='APPROVED', status='READY', decided_at=now(), updated_at=now() where id=p_item;
  elsif p_decision = 'REJECTED' then
    update public.raxi_portfolio_items set human_decision='REJECTED', status='SKIPPED', decided_at=now(), updated_at=now() where id=p_item;
  elsif p_decision = 'PENDING' then
    if v.status = 'PUBLISHED' then raise exception 'already published' using errcode='22023'; end if;
    update public.raxi_portfolio_items set human_decision='PENDING', status='DRAFT', decided_at=null, updated_at=now() where id=p_item;
  elsif p_decision = 'PUBLISHED' then
    if v.human_decision <> 'APPROVED' then raise exception 'approve first' using errcode='22023'; end if;
    if p_published_url is null or p_published_url !~ '^https://(www\.)?instagram\.com/' then raise exception 'instagram url required' using errcode='22023'; end if;
    update public.raxi_portfolio_items set status='PUBLISHED', published_url=p_published_url, updated_at=now() where id=p_item;
  else raise exception 'invalid decision' using errcode='22023'; end if;
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v.workspace_id, 'PORTFOLIO_DECISION', 'HUMAN', auth.uid(), 'raxi_portfolio_items', p_item::text, 'raxi-hq-fototeca', jsonb_build_object('decision',p_decision), now(), now());
  return jsonb_build_object('id',p_item,'decision',p_decision);
end $$;
revoke all on function public.raxi_portfolio_decide(uuid,text,text) from public, anon;
grant execute on function public.raxi_portfolio_decide(uuid,text,text) to authenticated;
