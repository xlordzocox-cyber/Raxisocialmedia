-- Read-only schema evidence. No user rows, credentials, or storage object paths.
select jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object('name', c.relname, 'rls', c.relrowsecurity,
      'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid,a.atttypmod), 'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      'constraints', (select jsonb_agg(jsonb_build_object('name', conname, 'definition', pg_get_constraintdef(oid))) from pg_constraint where conrelid=c.oid)))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
  'policies', (select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public'),
  'indexes', (select jsonb_agg(to_jsonb(i)) from pg_indexes i where schemaname='public'),
  'grants', (select jsonb_agg(to_jsonb(g)) from information_schema.role_table_grants g where table_schema='public'),
  'functions', (select jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', p.proname, 'definition', pg_get_functiondef(p.oid), 'acl', p.proacl)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
  'buckets', (select jsonb_agg(jsonb_build_object('id', id, 'public', public)) from storage.buckets),
  'migrations', (select jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) order by version) from supabase_migrations.schema_migrations)
) as schema_evidence;
