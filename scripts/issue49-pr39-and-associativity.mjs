// Issue49 / PR39: finite complete three-valued AND associativity test.
// Pure offline proof for the exact 3-operand regrouping only, NOT PG catalog equivalence.
// No imports, IO, network, SQL, Docker, or mutable global state.
const truth = [true, false, null];
function and3(...values) {
  if (values.some(v => v === false)) return false;
  if (values.some(v => v === null)) return null;
  return true;
}
let tested=0;
for(const L of truth) for(const U of truth) for(const R of truth){
  const nested=and3(and3(L,U),R);
  const flat=and3(L,U,R);
  if(nested !== flat) throw Error('AND ASSOCIATIVITY FAILED at '+JSON.stringify([L,U,R]));
  tested++;
}
if(tested!==27) throw Error('Incomplete truth table');
const gate = Object.freeze({
  truthTableCases:tested,
  logicalClaim:'THREE_VALUED_AND_ASSOCIATIVE_FOR_FIXED_PURE_OPERANDS',
  scope:'OFFLINE_BOOLEAN_ONLY',
  sourceRestoredCatalogEquivalent:false,
  nativeSemanticsValidated:false,
  decision:'BLOCKED',
  semanticEquivalence:'NOT_VERIFIED',
  allowCatalogPass:false,
  hostedMigration:'NO_GO_HOSTED_MIGRATION'
});
if(gate.decision!=='BLOCKED'||gate.allowCatalogPass!==false||gate.hostedMigration!=='NO_GO_HOSTED_MIGRATION'){
  throw Error('Gate weakened');
}
console.log('PASS PR39 BOOLEAN ALGEBRA: 27 of 27 three-valued combinations; decision BLOCKED / NOT_VERIFIED');
