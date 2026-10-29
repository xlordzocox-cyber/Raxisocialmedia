// Offline only. Reads pinned repository JSON; no Docker, network or SQL.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyPr38RecoveryEvidence} from './pr38-recovery-contract.mjs';
if(process.argv.length!==2)throw Error('PR38 STOP: no export/restore/hosted flags supported');
const root=fileURLToPath(new URL('..',import.meta.url));
const read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const evidence=read('docs/RAXI_HQ_PR38_RECOVERY_EVIDENCE.json');
const manifest=read('supabase/staging/raxi-hq-staging.manifest.json');
const checked=verifyPr38RecoveryEvidence(evidence,manifest);
console.log('PASS: PR38_OFFLINE_RECOVERY_EVIDENCE');
console.log('CLASSIFICATION: '+checked.status+'; only '+checked.scope);
console.log('BLOCKED: '+checked.gaps+' unverified gaps, '+checked.operationsDenied+' denied operations; hosted Auth/Storage restore NOT verified.');
console.log('NO execution: no backups, restores, remote SQL, Docker, providers, projects, deploy or spending.');
