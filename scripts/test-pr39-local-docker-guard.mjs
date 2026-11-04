// PR39: pure/offline Docker endpoint policy and optional runner fail-closed tests.
// Must NEVER invoke Docker, create containers, perform SQL or access a daemon.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {selectPr39LocalDockerHost} from './pr39-local-docker-guard.mjs';

assert.equal(process.argv.length,2,'No flags accepted');
const inspect=(name,host,other={})=>[{
 Name:name,Endpoints:{docker:{Host:host,SkipTLSVerify:false}},
 TLSMaterial:{},...other
}];
const run=(platform,contextName,host,environment={})=>
 selectPr39LocalDockerHost({platform,contextName,environment,
  inspection:inspect(contextName,host)});
assert.equal(run('win32','default','npipe:////./pipe/docker_engine'),
 'npipe:////./pipe/docker_engine');
assert.equal(run('win32','desktop-linux','npipe:////./pipe/dockerDesktopLinuxEngine'),
 'npipe:////./pipe/dockerDesktopLinuxEngine');
assert.equal(run('linux','default','unix:///var/run/docker.sock'),
 'unix:///var/run/docker.sock');

let denied=0;
function negative(label,fn){
 assert.throws(fn,/PR39 STOP: local Docker daemon endpoint not proven/,label);
 denied++;
}
const win='npipe:////./pipe/docker_engine';
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG',
 'DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']){
 negative('override '+key,()=>run('win32','default',win,{[key]:'remote'}));
 negative('empty override '+key,()=>run('win32','default',win,{[key]:''}));
}
for(const [label,host] of [
 ['TCP remote','tcp://10.0.0.2:2376'],
 ['TCP loopback','tcp://127.0.0.1:2375'],
 ['SSH','ssh://user@host'],
 ['custom Windows npipe','npipe:////./pipe/other'],
 ['Unix remote alias','unix:///tmp/docker.sock'],
 ['whitespace suffix',win+' '],
 ['case alteration','NPIPE:////./pipe/docker_engine'],
 ['hidden newline',win+'\n']
])negative(label,()=>run('win32','default',host));
negative('remote current context',()=>run('win32','production',win));
negative('unreviewed current context',()=>run('win32','staging',win));
negative('Desktop Linux context with default pipe',()=>run('win32','desktop-linux',win));
negative('default with Desktop Linux named pipe is permitted? reviewed desktop-only',()=>{
 const name='desktop-linux';
 const obj=inspect(name,win);
 return selectPr39LocalDockerHost({platform:'win32',contextName:name,environment:{},inspection:obj});
});
negative('Linux remote forwarded Unix socket',()=>run('linux','default','unix:///home/unknown/docker.sock'));
negative('Linux TCP loopback',()=>run('linux','default','tcp://localhost:2375'));
negative('Mac unreviewed socket',()=>run('darwin','default','unix:///var/run/docker.sock'));
negative('unrecognized platform',()=>run('freebsd','default','unix:///var/run/docker.sock'));
negative('null inspection',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:null}));
negative('empty inspection',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:[]}));
negative('two contexts',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:[...inspect('default',win),...inspect('default',win)]}));
negative('context name mismatch',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:inspect('production',win)}));
negative('skip TLS verify',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:[{Name:'default',Endpoints:{docker:{Host:win,SkipTLSVerify:true}},TLSMaterial:{}}]}));
negative('missing SkipTLSVerify',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:[{Name:'default',Endpoints:{docker:{Host:win}},TLSMaterial:{}}]}));
negative('extra endpoint',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:[{Name:'default',Endpoints:{docker:{Host:win,SkipTLSVerify:false},other:{Host:'ssh://remote'}},TLSMaterial:{}}]}));
negative('configured TLS material',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:inspect('default',win,{TLSMaterial:{key:'private'}})));
negative('malformed Docker endpoint',()=>selectPr39LocalDockerHost({platform:'win32',environment:{},contextName:'default',inspection:[{Name:'default',Endpoints:{docker:null},TLSMaterial:{}}]}));

const runner=resolve(fileURLToPath(new URL('.',import.meta.url)),'pr39-local-synthetic-recovery.mjs');
const text=readFileSync(runner,'utf8');
assert.match(text,/selectPr39LocalDockerHost\(/);
assert.match(text,/\['--host',pinnedLocalDockerHost,\.\.\.args\]/);
assert.match(text,/\['--host',pinnedLocalDockerHost,'exec',id,'pg_isready'/);
assert.match(text,/pinnedLocalDockerHost=selectPr39LocalDockerHost\(/);
assert.ok(text.indexOf('pinnedLocalDockerHost=selectPr39LocalDockerHost(')<text.indexOf("docker(['image','inspect'"),
 'Endpoint pin must precede Docker daemon operations');
assert.ok(text.indexOf("docker(['info','--format'")<text.indexOf("docker(['image','inspect'"),
 'Docker Linux engine check must precede image/container operations');

// Process-level checks: reject all overrides even when Docker is unavailable.
// Preflight may read reviewed sources locally; it must never execute a daemon.
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG']){
 const env={...process.env,[key]:'tcp://remote.example:2375',PATH:''};
 const child=spawnSync(process.execPath,[runner,'--run-local'],{
  env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576
 });
 assert.equal(child.error,undefined,'No process hang on '+key);
 assert.equal(child.status,1,'Override must fail without Docker: '+key);
 assert.match(child.stderr,new RegExp('Docker endpoint override prohibited: '+key));
 denied++;
}
const noFlags=spawnSync(process.execPath,[runner],{
 env:{...process.env,PATH:''},encoding:'utf8',windowsHide:true,
 timeout:30000,maxBuffer:1048576
});
assert.equal(noFlags.status,0,'Default preflight never needs Docker: '+noFlags.stderr);
assert.match(noFlags.stdout,/PRECHECK ONLY: no Docker, network, SQL, backup or restore performed\./);
console.log('PASS: PR39_LOCAL_DOCKER_DAEMON_GUARD_OFFLINE ('+denied+
 ' denied endpoint/environment cases, 3 accepted local sockets; no Docker/SQL).');
