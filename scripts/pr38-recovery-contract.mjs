// Raxi HQ PR38: pure offline NO-GO recovery classification (no I/O or network).
// NOT a backup tool, restore executor, B2 authorization or full recovery validator.
import {verifyPreparationManifest} from '../apps/raxi-hq/scripts/staging-manifest.mjs';

const STOP=reason=>{throw Error('PR38 STOP: '+reason);};
const exactKeys=(obj,keys,label)=>{
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    Object.keys(obj).sort().join('|')!==[...keys].sort().join('|'))STOP(label+' keys changed');
};
const fields={
 project:['ref','name','organizationId','region','postgresMajor'],
 archive:['filename','bytes','sha256','archiveKind','publicSchemaRestored','publicTableCount','observedQueryResult','evidenceKind','noNetworkDisposablePg17'],
 objectives:['rpoMinutes','rtoMinutes','retentionDays','recoveryOwner']
};
export const REVIEWED_GAPS=Object.freeze({
 futureRaxiTablesAndData:'NOT_BACKED_UP',
 authManagedRowsAndSessions:'NOT_BACKED_UP',
 authServiceRecovery:'NOT_TESTED',
 storageMetadata:'NOT_BACKED_UP',
 storageObjectBytes:'NOT_BACKED_UP',
 roleGrantsOwnershipAcl:'NOT_BACKED_UP',
 projectConfigurationAndSecrets:'NOT_RECOVERED',
 edgeFunctionDeployment:'NOT_RECOVERED',
 offsiteEncryptedCopy:'NOT_OBSERVED',
 tlsVerifyFullServerIdentity:'NOT_VERIFIED',
 crossServiceRestore:'NOT_TESTED',
 hostedRlsAndTenants:'NOT_TESTED'
});
export const BLOCKED_OPERATIONS=Object.freeze([
 'exportManagedAuthData','downloadStorageObjects','newBackup','restore','createProject',
 'applySql','runB2','createUsers','deploy','realProviders','additionalSpend'
]);
export function verifyPr38RecoveryEvidence(evidence,manifest){
 try{verifyPreparationManifest(manifest);}
 catch{STOP('the canonical PR21 staging manifest is no longer pinned');}
 if(manifest.executionReady!==false||Object.values(manifest.authorizations).some(x=>x!==false))
  STOP('existing staging authorizations must remain disabled');
 exactKeys(evidence,['kind','formatVersion','project','productionExcluded','upstreamMainBase',
  'overall','provenScope','observedArchive','gaps','objectives','noHostedPermissions',
  'authorizedOperations','nextStep'],'evidence');
 if(evidence.kind!=='RAXI_PR38_RECOVERY_REVIEW_ONLY'||evidence.formatVersion!==1)
  STOP('review-only evidence format changed');
 exactKeys(evidence.project,fields.project,'project');
 if(evidence.project.ref!=='zvhxjindgyvtasstfjut'||
    evidence.project.name!=='raxi-hq-staging'||
    evidence.project.organizationId!=='qpjzdqkvjzgqwvismeku'||
    evidence.project.region!=='us-east-2'||evidence.project.postgresMajor!==17||
    JSON.stringify(evidence.project)!==JSON.stringify(manifest.project))
  STOP('staging project identity does not match pinned manifest');
 if(evidence.productionExcluded!=='jrkefsylpfriiqefcmzq'||
    evidence.upstreamMainBase!=='857c94dd7a8805df899117556688c04599b3169a')
  STOP('production exclusion or PR base changed');
 if(evidence.overall!=='NO_GO_HOSTED_MIGRATION'||
    evidence.provenScope!=='PUBLIC_ONLY_VERIFIED'||
    evidence.noHostedPermissions!==true||
    evidence.nextStep!=='REVIEW_AND_SCOPED_APPROVAL_REQUIRED')
  STOP('recovery NO-GO classification weakened');
 const a=evidence.observedArchive;
 exactKeys(a,fields.archive,'archive evidence');
 if(a.filename!=='raxi-staging-public-20261027-180405.dump'||
    a.bytes!==1679||
    a.sha256!=='214d57ca84bbc3341f53663eb6a88daa52838c451a0858c0a913337c094cd7fd'||
    a.archiveKind!=='PG17_CUSTOM_PUBLIC_SCHEMA_ONLY'||
    a.publicSchemaRestored!==true||a.publicTableCount!==0||
    a.observedQueryResult!=='t|0'||
    a.evidenceKind!=='USER_SUPPLIED_LOCAL_TERMINAL_OUTPUT'||
    a.noNetworkDisposablePg17!==true)
  STOP('user-reported limited archive evidence changed');
 exactKeys(evidence.gaps,Object.keys(REVIEWED_GAPS),'unverified coverage');
 for(const [key,status] of Object.entries(REVIEWED_GAPS))
  if(evidence.gaps[key]!==status)STOP('unverified gap silently marked complete: '+key);
 exactKeys(evidence.objectives,fields.objectives,'unagreed objectives');
 for(const key of fields.objectives)
  if(evidence.objectives[key]!==null)STOP('unapproved RPO/RTO/retention/owner: '+key);
 exactKeys(evidence.authorizedOperations,BLOCKED_OPERATIONS,'blocked operations');
 for(const key of BLOCKED_OPERATIONS)
  if(evidence.authorizedOperations[key]!==false)STOP('operation improperly authorized: '+key);
 return Object.freeze({status:'NO_GO_HOSTED_MIGRATION',scope:'PUBLIC_ONLY_VERIFIED',
  gaps:Object.keys(REVIEWED_GAPS).length,operationsDenied:BLOCKED_OPERATIONS.length,
  hostedAuthAndRecovery:'NOT_VERIFIED'});
}
