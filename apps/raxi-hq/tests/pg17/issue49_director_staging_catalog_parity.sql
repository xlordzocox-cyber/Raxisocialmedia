-- Read-only schema shape snapshot from Supabase staging zvhxjindgyvtasstfjut,
-- captured 2026-11-14 MX / 2026-11-15 UTC. No row values or secrets.
-- Checks exact 6 core runtime dependencies; NOT full Supabase Auth catalog.
-- Intended ONLY on isolated, reconstructed repository migrations in PG17.
-- MD5 below is a deterministic catalog comparison, NOT security hashing.
\set ON_ERROR_STOP on
do $check$
declare mismatch jsonb;
begin
with expected(relname,columns_count,constraints_count,triggers_count,rls,auth_select,service_delete,columns_md5,constraints_md5,triggers_md5,policies_md5) as (
 values
 ('raxi_agent_profiles',9,7,0,true,true,true,'b1b1f17e9fe00b141c1b47b5246f93ee','efa8cb6e48b88ddeb41f24baf806f868','d41d8cd98f00b204e9800998ecf8427e','fb92d2d776d60e555468f780ddc0c6e1'),
 ('raxi_agent_runs',21,10,1,true,false,false,'a689e4b9390899e5cff3c0b4615bab5b','9c23fce166fc1ea7a35437cb722c590c','0717e4608c99da0d8d14163c42f3d5fc','d41d8cd98f00b204e9800998ecf8427e'),
 ('raxi_agent_tasks',13,9,0,true,true,true,'13627d6c2aae2637ccb616c59a87420e','bedc9cd731e9913715c92656fc7c56fe','d41d8cd98f00b204e9800998ecf8427e','1551dde2be2293a83757e2f02038c216'),
 ('raxi_approvals',10,9,2,true,true,true,'03fefdd81958f14f19044fdb8418ed03','1539a8a895a92445138eab16045d84eb','d3b5d705441867cef60efb67fd2c68e1','cab86cadcc24bc136665f2480f9f276c'),
 ('raxi_runtime_policies',13,9,1,true,false,false,'fb953b67ba2daaec66133540975a5cf5','e62a42cb2ae16685cea6037969e25e79','1694060b5dee906d4c915132f3b14a20','d41d8cd98f00b204e9800998ecf8427e'),
 ('raxi_workspaces',7,6,0,true,true,true,'968b91f9f0ed8e48a1703b98ac44bfbe','59013b87b744051c36bea243b85a5c2f','d41d8cd98f00b204e9800998ecf8427e','6094b710e1ae32b64efe17b62bb8255a')
),actual as (
 select c.relname,
   (select count(*)::int from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns_count,
   (select count(*)::int from pg_constraint a where a.conrelid=c.oid) as constraints_count,
   (select count(*)::int from pg_trigger a where a.tgrelid=c.oid and not a.tgisinternal) as triggers_count,
   c.relrowsecurity as rls,
   has_table_privilege('authenticated',c.oid,'SELECT') as auth_select,
   has_table_privilege('service_role',c.oid,'DELETE') as service_delete,
   (select md5(string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,
    '|' order by a.attnum)) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns_md5,
   (select md5(coalesce(string_agg(co.conname||'='||pg_get_constraintdef(co.oid,true),'|' order by co.conname),'')) from pg_constraint co where co.conrelid=c.oid) as constraints_md5,
   (select md5(coalesce(string_agg(t.tgname||'='||pg_get_triggerdef(t.oid,true),'|' order by t.tgname),'')) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) as triggers_md5,
   (select md5(coalesce(string_agg(p.polname||'='||pg_get_expr(p.polqual,p.polrelid),'|' order by p.polname),'')) from pg_policy p where p.polrelid=c.oid) as policies_md5
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
)
select coalesce(jsonb_agg(jsonb_build_object('table',e.relname,'expected',to_jsonb(e),
'actual',to_jsonb(a))), '[]'::jsonb) into mismatch
from expected e left join actual a on a.relname=e.relname
where a.relname is null or
 (e.columns_count,e.constraints_count,e.triggers_count,e.rls,e.auth_select,e.service_delete,
  e.columns_md5,e.constraints_md5,e.triggers_md5,e.policies_md5)
 is distinct from
 (a.columns_count,a.constraints_count,a.triggers_count,a.rls,a.auth_select,a.service_delete,
  a.columns_md5,a.constraints_md5,a.triggers_md5,a.policies_md5);
if mismatch <> '[]'::jsonb then
 raise exception 'ISSUE49_STAGING_SCHEMA_SIGNATURE_MISMATCH: %',mismatch;
end if;
if to_regprocedure('public.raxi_supervised_host_identity(jsonb)') is null then
 raise exception 'ISSUE49_MISSING_HOST_IDENTITY_RPC_IN_REPOSITORY_MIGRATIONS';
end if;
raise notice 'PASS: 6 runtime table signatures and identity RPC match staging catalog snapshot';
end; $check$;
