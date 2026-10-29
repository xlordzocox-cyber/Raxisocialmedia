// PR36 offline preflight: no SQL connections, Docker, network or filesystem writes.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReadinessInputs} from './pr36-readiness-contract.mjs';
if(process.argv.length!==2)throw Error('PR36 STOP: no runtime flags or hosted execution accepted');
const root=fileURLToPath(new URL('..',import.meta.url));
const read=(path)=>readFileSync(resolve(root,path),'utf8');
const manifest=JSON.parse(read('supabase/staging/raxi-hq-staging.manifest.json'));
const sql=read('supabase/tests/staging-b2-preflight.readonly.sql');
// Use fixed review path before the manifest's untrusted path is validated.
const expected=read('supabase/staging/raxi-hq-staging.expected-schema.json');
const status=verifyReadinessInputs(manifest,read,sql,expected);
console.log('PASS: PR36_OFFLINE_STAGING_READINESS_CONTRACT');
console.log('PROJECT: '+status.projectRef+'; '+status.sqlSources+' pinned ordered SQL sources; '+status.hostedFlagsDisabled+' disabled hosted flags.');
console.log('LIMITS: '+status.expectedSchema+'; '+status.effectiveAuthPrivileges+'; '+status.hostedRls+'; '+status.workspaceIsolation+'; '+status.recovery+'.');
console.log('NO-GO: B2, hosted SQL, user creation, provider calls, deployment and production. No Docker/network/SQL called.');
