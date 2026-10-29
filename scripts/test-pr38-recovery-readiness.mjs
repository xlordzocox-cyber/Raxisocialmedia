// PR38 pure-memory negative tests. No Docker, database, network or writes.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyPr38RecoveryEvidence} from './pr38-recovery-contract.mjs';
if(process.argv.length!==2)throw Error('PR38 STOP: no runtime flags supported');
const root=fileURLToPath(new URL('..',import.meta.url));
const read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const evidence=read('docs/RAXI_HQ_PR38_RECOVERY_EVIDENCE.json');
const manifest=read('supabase/staging/raxi-hq-staging.manifest.json');
const check=(e=evidence,m=manifest)=>verifyPr38RecoveryEvidence(e,m);
const patch=(target,change)=>{const o=structuredClone(target);change(o);return o;};
assert.equal(check().status,'NO_GO_HOSTED_MIGRATION');
console.log('PASS: PR38 baseline classified NO_GO_HOSTED_MIGRATION');
const failures=[
 ['production ref',()=>check(patch(evidence,e=>e.project.ref=e.productionExcluded))],
 ['unknown staging ref',()=>check(patch(evidence,e=>e.project.ref='abcdefghijklmnopqrst'))],
 ['production exclusion tamper',()=>check(patch(evidence,e=>e.productionExcluded='other'))],
 ['manifest identity tamper',()=>check(evidence,patch(manifest,m=>m.project.ref='abcdefghijklmnopqrst'))],
 ['manifest write authorization',()=>check(evidence,patch(manifest,m=>m.authorizations.applySql=true))],
 ['full backup claim',()=>check(patch(evidence,e=>e.provenScope='BACKUP_COMPLETE'))],
 ['hosted GO claim',()=>check(patch(evidence,e=>e.overall='GO_HOSTED_MIGRATION'))],
 ['artifact hash forged',()=>check(patch(evidence,e=>e.observedArchive.sha256='0'.repeat(64)))],
 ['artifact size forged',()=>check(patch(evidence,e=>e.observedArchive.bytes=1000000))],
 ['falsified public tables',()=>check(patch(evidence,e=>e.observedArchive.publicTableCount=20))],
 ['forged Auth backup',()=>check(patch(evidence,e=>e.gaps.authManagedRowsAndSessions='VERIFIED'))],
 ['forged object bytes',()=>check(patch(evidence,e=>e.gaps.storageObjectBytes='VERIFIED'))],
 ['forged offsite copy',()=>check(patch(evidence,e=>e.gaps.offsiteEncryptedCopy='VERIFIED'))],
 ['forged TLS identity',()=>check(patch(evidence,e=>e.gaps.tlsVerifyFullServerIdentity='VERIFIED'))],
 ['invented RPO',()=>check(patch(evidence,e=>e.objectives.rpoMinutes=15))],
 ['invented RTO',()=>check(patch(evidence,e=>e.objectives.rtoMinutes=60))],
 ['unapproved export',()=>check(patch(evidence,e=>e.authorizedOperations.exportManagedAuthData=true))],
 ['unapproved restore',()=>check(patch(evidence,e=>e.authorizedOperations.restore=true))],
 ['unapproved hosted B2',()=>check(patch(evidence,e=>e.authorizedOperations.runB2=true))],
 ['unapproved spending',()=>check(patch(evidence,e=>e.authorizedOperations.additionalSpend=true))],
 ['extra hidden field',()=>check(patch(evidence,e=>e.shadowOverride=true))],
 ['missing explicit denial',()=>check(patch(evidence,e=>delete e.authorizedOperations.deploy))],
 ['unverified but newly labelled covered',()=>check(patch(evidence,e=>e.gaps.hostedRlsAndTenants='COMPLETE'))]
];
for(const [label,run] of failures){assert.throws(run,/PR38 STOP:/,label);console.log('PASS: denied '+label);}
console.log('PASS: PR38_RECOVERY_NEGATIVE_TESTS ('+failures.length+' negative cases, no network, no Docker).');
