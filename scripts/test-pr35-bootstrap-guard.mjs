// Offline negative tamper tests: no Docker, network or SQL.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {strict as assert} from 'node:assert';
import {assertBootstrapIntegrity} from './pr35-bootstrap-guard.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const original=readFileSync(resolve(root,'supabase/tests/pg17-bootstrap.sql'),'utf8');
assert.equal(assertBootstrapIntegrity(original),true);
for(const [name,changed] of [
 ['privilege escalation',original+"\ngrant service_role to authenticated;\n"],
 ['role deletion',original.replace('create role service_role nologin bypassrls;','')],
 ['auth implementation edit',original.replace("request.jwt.claims","request.jwt.claim")]
]){
 assert.notEqual(changed,original,'fixture mutation failed: '+name);
 assert.throws(()=>assertBootstrapIntegrity(changed),/bootstrap SHA256 changed/);
 console.log('PASS: rejected '+name);
}
console.log('PASS: unchanged bootstrap accepted; three modified bootstraps rejected.');
