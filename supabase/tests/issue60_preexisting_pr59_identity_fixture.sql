-- EPHEMERAL PostgreSQL 17 fixture ONLY. Never apply to Supabase staging.
-- Simulates the presence (not the full behavior) of the stricter PR59 identity.
create function public.raxi_supervised_host_identity(p_identity jsonb) returns boolean
language plpgsql security invoker set search_path='' as $qa_identity$
begin
 if current_user<>'service_role'
  or p_identity->>'projectRef' is distinct from 'zvhxjindgyvtasstfjut'
  or p_identity->>'provenance' is distinct from 'SUPABASE_AUTH_STAGING'
 then raise exception 'fixture identity denied' using errcode='42501'; end if;
 return true;
end;
$qa_identity$;
revoke all on function public.raxi_supervised_host_identity(jsonb) from public,anon,authenticated;
grant execute on function public.raxi_supervised_host_identity(jsonb) to service_role;
create table public.raxi_qa_identity_fingerprint(expected_definition text not null);
insert into public.raxi_qa_identity_fingerprint(expected_definition)
 select pg_get_functiondef(to_regprocedure('public.raxi_supervised_host_identity(jsonb)'));
