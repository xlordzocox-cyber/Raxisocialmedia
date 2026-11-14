-- NEGATIVE LAB ONLY. Trigger a failure AFTER all 4 DDL sources ran.
-- Must cause the whole externally managed migration transaction to roll back.
DO $forced_abort$
BEGIN
  RAISE EXCEPTION 'EXPECTED_AFTER_FULL_DDL_ABORT';
END;
$forced_abort$;
