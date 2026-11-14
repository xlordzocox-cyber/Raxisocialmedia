-- Validation of staged Stage B candidate against preinstalled PR59 identity fixture.
-- Real PR59 function is stronger than this synthetic fixture; tests do not
-- constitute hosted JWT or authenticated session E2E verification.
DO $qa_identity_post$
DECLARE current_definition text; installed regprocedure;
BEGIN
 SELECT pg_get_functiondef(to_regprocedure('public.raxi_supervised_host_identity(jsonb)'))
  INTO current_definition;
 IF current_definition IS DISTINCT FROM
    (SELECT expected_definition FROM public.raxi_qa_identity_fingerprint LIMIT 1) THEN
  RAISE EXCEPTION 'Stage B changed the preexisting PR59 identity function';
 END IF;
 installed:=to_regprocedure('public.raxi_supervised_host_command(jsonb,text,jsonb)');
 IF installed IS NULL THEN RAISE EXCEPTION 'Stage B host command missing'; END IF;
 IF has_function_privilege('anon',installed,'EXECUTE')
    OR has_function_privilege('authenticated',installed,'EXECUTE')
    OR NOT has_function_privilege('service_role',installed,'EXECUTE') THEN
  RAISE EXCEPTION 'Stage B host command privileges changed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=installed AND NOT prosecdef) THEN
  RAISE EXCEPTION 'Stage B host command is unexpectedly privileged';
 END IF;
 RAISE NOTICE 'PASS: candidate Stage B preserves preinstalled PR59 identity definition and service-only host command';
END;
$qa_identity_post$;
