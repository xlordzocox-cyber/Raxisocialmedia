-- Team proposals: ideas created by the Claude-led agents, kept apart from Luis's manual ideas.
create table public.raxi_team_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  external_id text not null check (external_id ~ '^PROP-[A-Z0-9-]{3,60}$'),
  agent_key text not null check (agent_key in ('director','researcher','creative','production','qa','copy','archivist')),
  character_id text check (character_id is null or length(character_id) between 1 and 64),
  title text not null check (length(title) between 1 and 120),
  summary text not null check (length(summary) between 1 and 1000),
  rationale text check (rationale is null or length(rationale) <= 2000),
  channel text check (channel is null or channel in ('INSTAGRAM','INSTAGRAM_STORY','REELS','TEASER','FANVUE_FEED','FANVUE_CHAT','GENERAL')),
  estimated_cost_usd numeric(10,4) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 10),
  status text not null default 'PROPOSED' check (status in ('PROPOSED','ACCEPTED','DISMISSED','IN_PROGRESS','DONE')),
  owner_note text check (owner_note is null or length(owner_note) <= 500),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_id)
);
create index raxi_team_proposals_ws_idx on public.raxi_team_proposals(workspace_id, status, created_at desc);

alter table public.raxi_team_proposals enable row level security;
create policy raxi_team_proposals_owner_read on public.raxi_team_proposals for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_team_proposals from anon;
revoke insert, update, delete, truncate on public.raxi_team_proposals from authenticated;
grant select on public.raxi_team_proposals to authenticated;

-- Owner decision: PROPOSED -> ACCEPTED|DISMISSED, and undo back to PROPOSED while not in production.
create or replace function public.raxi_team_proposal_decide(p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.raxi_team_proposals;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'owner required' using errcode='42501'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'note too long' using errcode='22023'; end if;
  select p.* into v from public.raxi_team_proposals p join public.raxi_workspaces w on w.id = p.workspace_id
   where p.id = p_id and w.owner_user_id = auth.uid() for update of p;
  if not found then raise exception 'not found' using errcode='42501'; end if;
  if p_decision in ('ACCEPTED','DISMISSED') then
    if v.status <> 'PROPOSED' then raise exception 'already decided' using errcode='22023'; end if;
  elsif p_decision = 'PROPOSED' then
    if v.status not in ('ACCEPTED','DISMISSED') then raise exception 'cannot undo' using errcode='22023'; end if;
  else raise exception 'invalid decision' using errcode='22023'; end if;
  update public.raxi_team_proposals
     set status = p_decision, owner_note = coalesce(p_note, owner_note),
         decided_at = case when p_decision = 'PROPOSED' then null else now() end, updated_at = now()
   where id = p_id;
  insert into public.raxi_audit_events(workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v.workspace_id, 'TEAM_PROPOSAL_DECISION', 'HUMAN', auth.uid(), 'raxi_team_proposals', p_id::text, 'raxi-hq-ideas',
           jsonb_build_object('decision', p_decision, 'from', v.status), now(), now());
  return jsonb_build_object('id', p_id, 'status', p_decision);
end $$;
revoke all on function public.raxi_team_proposal_decide(uuid,text,text) from public, anon;
grant execute on function public.raxi_team_proposal_decide(uuid,text,text) to authenticated;
