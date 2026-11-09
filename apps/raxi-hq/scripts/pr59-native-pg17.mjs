// Explicitly authorized local PG17 only. No lifecycle operations, TCP, or secrets.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { loadPreparationManifest, sqlDigest, verifySqlSources } from './staging-manifest.mjs';

async function readInputs() {
  const sources = await verifySqlSources(await loadPreparationManifest());
  assert.equal(sources.length, 7);
  const read = path => readFile(new URL('../../../supabase/' + path, import.meta.url), 'utf8');
  const [bootstrap, campaign, proposal, fixture] = await Promise.all([
    read('tests/pg17-bootstrap.sql'), read('migrations/20261020234358_raxi_hq_campaign_strategy_pending_review.sql'),
    read('proposals/supervised_campaign_requests.sql'), read('tests/pr59_supervised_requests_native.sql'),
  ]);
  // B2 excludes Campaign/Strategy. This separately reviewed Meta A dependency is local only.
  assert.equal(sqlDigest(campaign), '48a5061fb0be589a5f68158973079ad78cbc980a91cf5a11fcf678396849951f', 'Campaign/Strategy migration digest mismatch');
  return [bootstrap, ...sources.slice(0,4).map(source => source.text), campaign,
    ...sources.slice(4).map(source => source.text), proposal, fixture];
}
if (process.argv.length === 3 && process.argv[2] === '--check-inputs') {
  await readInputs();
  console.log('PR59 offline: seven reviewed sources plus the separate Campaign/Strategy migration verified');
  process.exit(0);
}
const [gate, id, action, ...extra] = process.argv.slice(2);
assert.ok(gate === '--authorized-local-pr59' && /^[a-f0-9]{64}$/.test(id ?? '') &&
  ['prepare', 'session'].includes(action) && extra.length === 0, 'Explicit lab authorization and full container ID required');
assert.equal(process.platform, 'win32', 'Windows local Docker pipe required');
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_API_VERSION','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) {
  assert.ok(!process.env[key], 'Docker overrides are not permitted');
}
const host = ['--host', 'npipe:////./pipe/docker_engine'];
const image = 'sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const data = '/var/lib/postgresql/data';
const fields = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},"network":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}},"bindings":{{json .HostConfig.PortBindings}},"publishAll":{{json .HostConfig.PublishAllPorts}},"privileged":{{json .HostConfig.Privileged}},"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}}}';
const psql = [...host, 'exec', '-i', id, 'psql', '-X', '-w', '-U', 'raxi_local', '-d', 'raxi_validation', '-h', '/var/run/postgresql', '-v', 'ON_ERROR_STOP=1'];
const verify = "do $$begin if current_database()<>'raxi_validation' or current_user<>'raxi_local' or inet_server_addr() is not null or current_setting('server_version_num')::int<>170011 or current_setting('data_directory')<>'/var/lib/postgresql/data' then raise exception 'PR59 lab identity rejected'; end if; end$$;";
function inspect() {
  const out = execFileSync('docker', [...host, 'inspect', '--type=container', id, '--format', fields], {
    encoding: 'utf8', timeout: 12000, stdio: ['ignore','pipe','ignore'],
  });
  const lab = JSON.parse(out);
  assert.ok(lab.id === id && lab.image === image && lab.running === true && lab.paused === false && lab.restarting === false &&
    lab.network === 'none' && Object.keys(lab.networks ?? {}).every(name => name === 'none') &&
    lab.privileged === false && lab.publishAll === false && !Object.keys(lab.bindings ?? {}).length &&
    Object.values(lab.ports ?? {}).every(value => value === null) &&
    Object.keys(lab.tmpfs ?? {}).length === 1 && Object.hasOwn(lab.tmpfs, data) &&
    (lab.mounts ?? []).every(m => m.Type === 'tmpfs' && m.Destination === data), 'Container isolation rejected');
}

if (action === 'prepare') {
  const inputs = await readInputs();
  const empty = "do $$begin if exists(select 1 from pg_namespace where nspname in ('auth','storage','raxi_pr59_fixture')) or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f')) or exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) then raise exception 'PR59 lab is not empty'; end if; end$$;";
  inspect();
  const result = spawnSync('docker', [...psql, '-q', '-f', '-'], {
    input: ['begin;', verify, empty, ...inputs, 'commit;'].join('\n'),
    encoding: 'utf8', stdio: ['pipe','pipe','pipe'], timeout: 60000,
  });
  // Avoid dumping SQL, environment or fixture values on errors.
  if (result.status !== 0) throw Error('PR59 native preparation failed. Inspect the dedicated lab before retrying.');
  console.log('PR59 fixture installed in an isolated PostgreSQL 17.11 lab');
} else {
  inspect();
  // Verify the actual SQL connection before accepting the operator's first statement.
  const result = spawnSync('docker', [...psql, '-c', verify, '-c', "select pg_backend_pid() as backend_pid, current_setting('server_version_num') as server_version;", '-f', '-'], {
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
}
