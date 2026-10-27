// Offline artifact builder only. No database client, CLI install, network or execution.
import {readFile,writeFile,mkdir,realpath,lstat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPreparationManifest,verifyPreparationManifest,verifySqlSources,sqlDigest} from './staging-manifest.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const candidatePath='supabase/candidates/supervised_runtime_b2.candidate.sql';
const order=['agent_runtime','supervised_host_stage_a','supervised_host_stage_b'];
/** Pure formatting, not approval. Called with source snapshots already checked by verifySqlSources. */
export function assembleRuntimeCandidate(sources,baseCommit) {
 if(!/^[a-f0-9]{40}$/.test(baseCommit)||JSON.stringify(sources.map(s=>s.id))!==JSON.stringify(order)||
  sources.some(s=>s.kind!=='RUNTIME_PROPOSAL'||s.version!==null||typeof s.text!=='string'))throw Error('Candidate sources/order invalid');
 return '-- GENERATED REVIEW CANDIDATE ONLY: NOT A CLI MIGRATION; DO NOT APPLY\n'+
  `-- Candidate base: ${baseCommit}\n-- CLI migration version: UNASSIGNED\n`+
  '-- Sources remain authoritative; regenerate offline, never edit this artifact by hand.\n'+
  sources.map(s=>`\n-- SOURCE ${s.id}; SHA256(LF) ${sqlDigest(s.text)}\n`+s.text.replaceAll('\r\n','\n')).join('\n');
}
export async function buildRuntimeCandidate(manifest) {
 const snapshot=structuredClone(verifyPreparationManifest(manifest));
 const sources=await verifySqlSources(snapshot);
 const sql=assembleRuntimeCandidate(sources.filter(s=>s.kind==='RUNTIME_PROPOSAL'),snapshot.candidate.baseCommit);
 if(snapshot.candidate.path!==candidatePath||snapshot.candidate.cliMigrationVersion!==null||snapshot.candidate.generatedBy!=='OFFLINE_ASSEMBLER_NOT_CLI'||
  sqlDigest(sql)!==snapshot.candidate.sha256Lf)throw Error('Candidate provenance or digest mismatch');
 return sql;
}
export async function checkRuntimeCandidate(manifest) {
 const sql=await buildRuntimeCandidate(manifest);
 const committed=await readFile(resolve(root,candidatePath),'utf8');
 if(committed.replaceAll('\r\n','\n')!==sql)throw Error('Consolidated candidate changed');
 return {candidateSha256:sqlDigest(sql),cliMigrationVersion:null,pg17Validation:'BLOCKED',sqlExecuted:false};
}
export function verifyCandidateText(manifest,text) {
 verifyPreparationManifest(manifest);
 if(sqlDigest(text)!==manifest.candidate.sha256Lf)throw Error('Candidate text changed');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 (async()=>{
  const args=process.argv.slice(2);
  if(args.length>1||args.length===1&&!['--check','--write-candidate'].includes(args[0]))throw Error('Offline candidate flags only');
  // Regeneration checks the pinned manifest/sources without requiring that the
  // generated output already exist. Default --check verifies the whole package.
  const manifest=args[0]==='--write-candidate'?
   verifyPreparationManifest(JSON.parse(await readFile(resolve(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'))):await loadPreparationManifest();
  if(args[0]==='--write-candidate'){
   const sql=await buildRuntimeCandidate(manifest);
   await mkdir(resolve(root,'supabase/candidates'),{recursive:true});
   const parent=await realpath(resolve(root,'supabase/candidates'));
   if(!parent.startsWith((await realpath(root))+sep))throw Error('Candidate directory outside repository');
   const destination=resolve(root,candidatePath);
   try {const stat=await lstat(destination);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Candidate output must be an ordinary file');}
   catch(error){if(error.code!=='ENOENT')throw error;}
   await writeFile(destination,sql);
  }
  console.log(JSON.stringify(await checkRuntimeCandidate(manifest)));
 })().catch(()=>{console.error('Offline candidate verification failed');process.exitCode=1;});
}
