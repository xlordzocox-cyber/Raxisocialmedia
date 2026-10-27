// Offline check only. No SQL application, credentials or network.
import {loadPreparationManifest,REVIEWED_STAGING_MANIFEST_SHA256} from './staging-manifest.mjs';
import {checkRuntimeCandidate} from './consolidate-runtime-candidate.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function checkStagingPreparation() {
 const m=await loadPreparationManifest();
 const candidate=await checkRuntimeCandidate(m);
 return {kind:m.kind,projectRef:m.project.ref,manifestSha256:REVIEWED_STAGING_MANIFEST_SHA256,
  sqlSources:m.applicationPlan.steps.length,executionReady:m.executionReady,schemaCompatibility:m.schemaCompatibility.status,
  candidate,remoteAccess:false,sqlApplied:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 checkStagingPreparation().then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Offline staging preparation verification failed');process.exitCode=1;});
}
