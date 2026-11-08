// Issue49 / PR39: offline-only T0/T1 CHECK representation candidates.
// No SQL execution, Docker, network, filesystem writes, or changed migrations.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const fail = reason => { throw Error('ISSUE49 PR39 OFFLINE STOP: ' + reason); };
if (process.argv.length !== 2) fail('no CLI options permitted');
const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'supabase/staging/raxi-hq-staging.manifest.json'), 'utf8'));
const entry = manifest.applicationPlan?.steps?.find(x => x.id === '20261019030541');
const sourcePath = 'supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql';
const expectedSha = 'e0f0a828b5d4f31960f2153ad910bb84a399a449754db8761057e91047cd7ba0';
if (entry?.path !== sourcePath || entry?.sha256Lf !== expectedSha ||
    manifest.executionReady !== false || !manifest.authorizations ||
    Object.values(manifest.authorizations).some(v => v !== false) ||
    manifest.schemaCompatibility?.status !== 'PENDING_PG17_REVIEW') {
  fail('manifest shape, pinned source or no-go authorization changed');
}

const source = readFileSync(join(root, sourcePath), 'utf8').replace(/\r\n/g, '\n');
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
if (hash(source) !== expectedSha) fail('pinned SQL hash changed');

const original = "slug text not null check(length(slug) between 2 and 64 and slug ~ '^[a-z0-9-]+$')";
const explicit = "slug text not null check(length(slug) >= 2 and length(slug) <= 64 and slug ~ '^[a-z0-9-]+$')";
if (source.split(original).length !== 2) fail('original CHECK must occur exactly once');
if (source.includes(explicit)) fail('candidate already unexpectedly present');

// Function replacement keeps the regex end-anchor literal (a replacement string does not).
const variant = source.replace(original, () => explicit);
if (variant === source || variant.replace(explicit, () => original) !== source) {
  fail('variant diff is not the one reviewed change');
}
const regexAnchor = "slug ~ '^[a-z0-9-]+$'";
if (source.split(regexAnchor).length !== 2 ||
    variant.split(regexAnchor).length !== 2) {
  fail('regex anchor was modified in the in-memory candidate');
}

console.log('PASS PR39 DDL SOURCE: pinned migration hash matches manifest; authorizations disabled');
console.log('PR39 T0: baseline BETWEEN grammar fingerprint ' + hash(original).slice(0, 16));
console.log('PR39 T1: explicit-comparisons grammar fingerprint ' + hash(explicit).slice(0, 16));
console.log('PR39 DIFF SCOPE: one in-memory CHECK rewrite only; no migration modified or saved');
console.log('PR39 EXPECTATION: T1 is a hypothesis, NOT a verified catalog-equality result');
console.log('PR39 DECISION: BLOCKED / NOT_VERIFIED; NO_GO_HOSTED_MIGRATION');
