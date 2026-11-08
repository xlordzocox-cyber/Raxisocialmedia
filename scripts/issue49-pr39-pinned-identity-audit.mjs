// Issue49 / PR39. Offline-only inspection of function volatility claims in the
// already-pinned PRIVATE native synthetic capture. No catalog waiver is possible.
// Run from repository root: git show <sha>:scripts/issue49-pr39-pinned-identity-audit.mjs |
//   node --input-type=module - "<PRIVATE_REPORT_PATH>"
// No Docker, SQL, network, file writes, or raw conbin output.
import {
  readPr39BoundedEvidenceFile,
  inspectPr39PinnedEvidenceBytes
} from './scripts/pr39-pg17-structural-attestation.mjs';

if (process.argv.length!==3 || !process.argv[2]) {
  throw Error('Expected exactly one private report filepath argument');
}
const evidence=readPr39BoundedEvidenceFile(process.argv[2]);
const structural=inspectPr39PinnedEvidenceBytes(evidence);
if(structural.decision!=='BLOCKED' || structural.allowCatalogPass!==false ||
   structural.semanticEquivalence!=='NOT_VERIFIED' ||
   structural.comparedOccurrences!==35 || structural.identicalOperandSubtrees!==3){
  throw Error('PINNED EVIDENCE GUARD FAILED');
}
const capture=JSON.parse(evidence.toString('utf8'));
const summary=[];
for (const [name,side] of [['source',capture.source],['restored',capture.restored]]) {
  const unique=new Map();
  for (const row of side.positionalBindings) {
    if (row.kind!=='function' || row.oid==='0') continue;
    const identity=row.identity;
    if(!identity || identity.schema!=='pg_catalog' ||
       typeof identity.name!=='string' || typeof identity.volatility!=='string' ||
       !/^[0-9a-f]{64}$/.test(identity.implementationSha256)){
      throw Error('Function identity missing or not pinned');
    }
    const key=row.oid;
    const earlier=unique.get(key);
    const representation=JSON.stringify(identity);
    if (earlier && earlier!==representation) throw Error('Conflicting identity for function OID');
    unique.set(key,representation);
    summary.push({side:name,oid:key,name:identity.name,volatility:identity.volatility});
  }
}
const uniquePairs=new Map();
for(const item of summary){
 const label=item.oid+':'+item.name;
 const entry=uniquePairs.get(label) || {};
 entry[item.side]=item.volatility;
 uniquePairs.set(label,entry);
}
if(!uniquePairs.size)throw Error('No function metadata found');
let incomplete=0;
for(const [key,v] of uniquePairs){
 if(v.source!=='i'||v.restored!=='i')incomplete++;
 console.log('PR39 DECLARED FUNCTION VOLATILITY: '+key+' source='+v.source+' restored='+v.restored);
}
if(incomplete) throw Error('Non-immutable or incomplete declared function volatility, STOP');
console.log('PASS PR39 PINNED FUNCTION METADATA: '+uniquePairs.size+' unique functions marked immutable on both sides');
console.log('PR39 REMAINS BLOCKED / NOT_VERIFIED: self-reported metadata cannot prove native purity, execution semantics, or full catalog equivalence');
