-- NEGATIVE LAB ONLY. Opens a transaction in the runner script.
-- This weak identity must never pass package preflight.
CREATE OR REPLACE FUNCTION public.raxi_supervised_host_identity(p_identity jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $weak_identity$
BEGIN
 -- A project ref string in the function body alone is not authorization.
 RETURN true;
END;
$weak_identity$;
