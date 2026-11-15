-- Raxi HQ Issue #49 / PROPOSAL ONLY, not a hosted migration.
-- NEVER apply to Supabase without separate explicit authorization.
-- Node-only pre-JWT admission for the one-owner Director readiness endpoint.
-- No user/task/provider data or plaintext IP stored; only an HMAC digest
-- derived from a TRUSTED ingress key by a server-only secret.
-- READ COMMITTED, atomic across multiple Node instances / PG connections.
-- Global max 60 allowed/minute; single HMAC identity max 8/minute.
-- Limited transactional garbage collection for inactive client slots.
-- This does not replace upstream WAF/DoS protection.
create table public.raxi_director_preauth_counters (
 slot text primary key check(slot='GLOBAL' or slot ~ '^CLIENT:[a-f0-9]{64}$'),
 minute_epoch bigint not null check(minute_epoch>0),
 hit_count integer not null check(hit_count between 0 and 60),
 touched_at timestamptz not null default clock_timestamp()
);
create index raxi_director_preauth_expiration
 on public.raxi_director_preauth_counters(touched_at)
 where slot<>'GLOBAL';
alter table public.raxi_director_preauth_counters enable row level security;
revoke all on public.raxi_director_preauth_counters from public,anon,authenticated,service_role;
-- DELETE is permitted ONLY for disposable old rate-counter entries.
-- NEVER grant DELETE on immutable Director pilots, tasks or audit.
grant select,insert,update,delete on public.raxi_director_preauth_counters to service_role;

create function public.raxi_director_preauth_admit(p_client_digest text)
returns jsonb language plpgsql security invoker set search_path='' as $f$
declare
 v_now timestamptz;
 v_minute bigint;
 v_global_epoch bigint; v_global_hits integer;
 v_client_epoch bigint; v_client_hits integer;
 v_slot text;
begin
 if current_user<>'service_role' then
  raise exception 'preauth denied' using errcode='42501';
 end if;
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'read committed required' using errcode='25001';
 end if;
 if p_client_digest is null or p_client_digest !~ '^[a-f0-9]{64}$' then
  raise exception 'invalid trusted digest' using errcode='22023';
 end if;
 v_slot:='CLIENT:'||p_client_digest;
 -- This global row is locked FIRST by every caller, making the exact quota
 -- atomic even across independent Node hosts or PgBouncer transactions.
 insert into public.raxi_director_preauth_counters(slot,minute_epoch,hit_count)
 values('GLOBAL',1,0) on conflict(slot) do nothing;
 select minute_epoch,hit_count into v_global_epoch,v_global_hits
 from public.raxi_director_preauth_counters
 where slot='GLOBAL' for update;
 if not found then raise exception 'global gate unavailable' using errcode='42501'; end if;

 -- Evaluate PostgreSQL clock AFTER acquiring global lock, not before.
 v_now:=clock_timestamp();
 v_minute:=floor(extract(epoch from v_now)/60)::bigint;
 if v_global_epoch=v_minute and v_global_hits>=60 then
  return jsonb_build_object('status','RATE_LIMITED');
 end if;

 -- An attacker cannot allocate unbounded rows within a minute: global
 -- successful requests cap NEW client slots at 60 per minute.
 insert into public.raxi_director_preauth_counters(slot,minute_epoch,hit_count)
 values(v_slot,v_minute,0) on conflict(slot) do nothing;
 select minute_epoch,hit_count into v_client_epoch,v_client_hits
 from public.raxi_director_preauth_counters
 where slot=v_slot for update;
 if not found then raise exception 'client gate unavailable' using errcode='42501'; end if;
 if v_client_epoch=v_minute and v_client_hits>=8 then
  return jsonb_build_object('status','RATE_LIMITED');
 end if;

 update public.raxi_director_preauth_counters
 set minute_epoch=v_minute,hit_count=case when v_global_epoch=v_minute
      then v_global_hits+1 else 1 end,touched_at=v_now
 where slot='GLOBAL';
 update public.raxi_director_preauth_counters
 set minute_epoch=v_minute,hit_count=case when v_client_epoch=v_minute
      then v_client_hits+1 else 1 end,touched_at=v_now
 where slot=v_slot;

 -- Bounded retention: at most 8 inactive CLIENT slots per admitted request,
 -- and only after 2 hours. No background job/cron required.
 -- All admissions lock GLOBAL first; no concurrent admission can mutate a
 -- client slot during this transaction. Skip any other externally held locks.
 delete from public.raxi_director_preauth_counters
 where slot in (
   select slot from public.raxi_director_preauth_counters
   where slot<>'GLOBAL' and touched_at<v_now-interval '2 hours'
   order by touched_at limit 8 for update skip locked
 );
 return jsonb_build_object('status','ALLOWED');
end; $f$;

-- PostgreSQL PUBLIC EXECUTE defaults must be explicitly revoked.
revoke all on function public.raxi_director_preauth_admit(text)
 from public,anon,authenticated,service_role;
grant execute on function public.raxi_director_preauth_admit(text) to service_role;
