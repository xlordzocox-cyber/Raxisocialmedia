// Meta A concurrency fault-injection harness. FAKE_ONLY: never invokes Docker/SQL/network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';

const file=new URL('./meta-a-native-pg17-concurrency.mjs',import.meta.url);
const source=readFileSync(file,'utf8').replace(/^import\s+.*?;\s*$/gm,'');
if(source.includes('import {')) throw Error('Unexpected module syntax');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run=new AsyncFunction('execFileSync','spawn','assert','process','console','setTimeout',
 'mkdirSync','writeFileSync','readFileSync','unlinkSync','rmdirSync','homedir','join','randomUUID',source);
const id='f8e8d43f6eac5b6ae2216e7272613d70b14fb53cebec6fdbf02c85f799481168';
const image='sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const base='raxi_campaign_qa|postgres|170011|LOCAL\ntables=18\nusers=0\nworkspaces=0\nrpc=true';

let fakeSerial=0;
async function scenario(kind,sharedLock=new Map()) {
 const state={calls:[],spawn:[],fixture:false,cleaned:false,output:[],errors:[],backends:new Set()};
 const proc={platform:'win32',pid:31000+(++fakeSerial),
  env:kind==='remote'?{DOCKER_HOST:'tcp://remote.example:2375'}:{},exitCode:0};
 const lockCalls=[];
 const filesystem={
   mkdirSync:(path)=>{lockCalls.push('acquire');if(sharedLock.has(path))throw Error('EEXIST: exclusive lock exists');sharedLock.set(path,{owner:null});},
   writeFileSync:(path,value)=>{const dir=path.slice(0,path.lastIndexOf('/'));const entry=sharedLock.get(dir);if(!entry||entry.owner!==null)throw Error('EEXIST owner');entry.owner=value;},
   readFileSync:(path)=>{const dir=path.slice(0,path.lastIndexOf('/'));return sharedLock.get(dir)?.owner;},
   unlinkSync:(path)=>{const dir=path.slice(0,path.lastIndexOf('/'));const entry=sharedLock.get(dir);if(!entry)throw Error('Missing owner');entry.owner=null;},
   rmdirSync:(path)=>{if(sharedLock.get(path)?.owner!==null)throw Error('Owner not removed');sharedLock.delete(path);lockCalls.push('release');},
   homedir:()=>'/fake-user',join:(...parts)=>parts.join('/'),
   randomUUID:()=>`fake-run-${proc.pid}`
 };
 state.lockCalls=lockCalls;
 state.sharedLock=sharedLock;
 const log={log:(...x)=>state.output.push(x.join(' ')),error:(...x)=>state.errors.push(x.join(' '))};
 function execFileSync(command,args,opts) {
  state.calls.push(args.join(' '));
  assert.equal(command,'docker');
  assert.equal(args[0],'--host');assert.equal(args[1],'npipe:////./pipe/docker_engine');
  assert.equal(args.filter(x=>x==='--host').length,1,'Docker host must appear exactly once');
  assert.equal(opts.env.DOCKER_HOST,undefined);
  if(args.includes('inspect'))return JSON.stringify({id,image,running:true,network:'none',privileged:false,ports:{},mounts:[],tmpfs:{'/var/lib/postgresql/data':'rw,nosuid,size=512m'}});
  const sql=args.at(-1);
  if(sql.includes('current_database()||')&&sql.includes('tables='))return state.fixture?base.replace('users=0','users=1').replace('workspaces=0','workspaces=1'):base;
  if(sql.includes('INSERT INTO auth.users')){
   if(kind==='setup-conflict'){state.fixture=true;throw Error('unique violation: fixture belongs to prior invocation');}
   state.fixture=true;return '';
  }
  if(sql.includes('DELETE FROM auth.users')){assert.equal(state.fixture,true);state.fixture=false;state.cleaned=true;return '';}
  if(sql.includes('pg_stat_activity')){
   if(sql.includes('wait_event_type'))return (kind==='success'||kind==='a-fail-after-lock')?'1':'0';
   return String(state.backends.size);
  }
  if(sql.includes('SELECT campaign_version'))return '1|0';
  if(sql.includes('SELECT count(*) FROM public.raxi_audit_events'))return '0';
  if(sql.includes('SELECT count(*) FROM public.raxi_approvals'))return '0';
  throw Error('Unexpected fake SQL: '+sql.slice(0,100));
 }
 function spawn(command,args,opts) {
  assert.equal(command,'docker');assert.equal(args[0],'--host');assert.equal(args[1],'npipe:////./pipe/docker_engine');assert.equal(args.filter(x=>x==='--host').length,1);
  assert.equal(opts.env.DOCKER_HOST,undefined);
  const cp=new EventEmitter();cp.stdout=new EventEmitter();cp.stderr=new EventEmitter();cp.stdin=new EventEmitter();
  const winner=args.join(' ').includes('meta_a_cas_winner');
  const entry={winner,closed:false,killed:false};state.spawn.push(entry);
  const backendName=winner?'meta_a_cas_winner':'meta_a_cas_loser';
  state.backends.add(backendName);
  const close=(code)=>{if(entry.closed)return;entry.closed=true;
   if(kind!=='backend-survives'||code!==143)state.backends.delete(backendName);
   cp.emit('close',code);};
  cp.kill=()=>{entry.killed=true;queueMicrotask(()=>close(143));return true;};
  cp.stdin.end=()=>{
   setTimeout(()=>{
    if(kind==='a-fail'&&winner){cp.stderr.emit('data',Buffer.from('failed A'));close(1);return;}
    if((kind==='b-fail'||kind==='backend-survives')&&!winner){cp.stderr.emit('data',Buffer.from('failed B'));close(1);return;}
    if(winner){cp.stdout.emit('data',Buffer.from('LOCK_HELD\n'));
     if(kind==='success')setTimeout(()=>{cp.stdout.emit('data',Buffer.from('WINNER_COMMITTED\n'));close(0);},400);
     if(kind==='a-fail-after-lock')setTimeout(()=>{cp.stderr.emit('data',Buffer.from('A failed while B waits'));close(1);},260);
    }else if(kind==='success')setTimeout(()=>{cp.stdout.emit('data',Buffer.from('LOSER_REJECTED\n'));close(0);},460);
   },0);
  };
  return cp;
 }
 try {await run(execFileSync,spawn,assert,proc,log,setTimeout,
  filesystem.mkdirSync,filesystem.writeFileSync,filesystem.readFileSync,
  filesystem.unlinkSync,filesystem.rmdirSync,filesystem.homedir,
  filesystem.join,filesystem.randomUUID);}catch(e){state.error=e.message;}
 state.exitCode=proc.exitCode;
 return state;
}

test('remote Docker context blocked before any daemon interaction',async()=>{
 const r=await scenario('remote');
 assert.match(r.error??'',/local Windows Docker pipe/);
 assert.equal(r.calls.length,0);assert.equal(r.spawn.length,0);
 assert.equal(r.lockCalls.length,0);
});
test('A early failure: no false PASS and guarded fixture cleanup',async()=>{
 const r=await scenario('a-fail');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,false);assert.equal(r.fixture,true);
 assert.equal(r.spawn.length,1);
 assert.ok(r.errors.some(s=>s.includes('NOT VERIFIED')));
 assert.ok(!r.output.some(s=>s.includes('two PostgreSQL sessions overlapped')));
});
test('B early failure: terminate A then clean exact synthetic fixture',async()=>{
 const r=await scenario('b-fail');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,false);assert.equal(r.fixture,true);
 assert.equal(r.spawn.length,2);assert.ok(r.spawn[0].killed&&r.spawn[0].closed);
 assert.ok(!r.output.some(s=>s.includes('two PostgreSQL sessions overlapped')));
});
test('nominal fake overlap: no real Docker, successful cleanup',async()=>{
 const r=await scenario('success');
 assert.equal(r.exitCode,0);assert.equal(r.cleaned,true);assert.equal(r.fixture,false);
 assert.deepEqual(r.lockCalls,['acquire','release']);assert.equal(r.sharedLock.size,0);
 assert.ok(r.output.some(s=>s.includes('two PostgreSQL sessions overlapped')));
});

test('session A fails after lock observation while B hangs: fail fast, cancel B and clean',async()=>{
 const r=await scenario('a-fail-after-lock');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,false);assert.equal(r.fixture,true);
 assert.equal(r.spawn.length,2);
 assert.equal(r.spawn[1].killed,true);
 assert.ok(r.errors.some(s=>s.includes('NOT VERIFIED')));
 assert.ok(!r.output.some(s=>s.includes('two PostgreSQL sessions overlapped')));
});

test('client killed but remote postgres backend survives: cleanup MUST be blocked',async()=>{
 const r=await scenario('backend-survives');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,false);
 assert.equal(r.fixture,true);
 assert.equal(r.spawn.length,2);assert.ok(r.spawn[0].killed&&r.spawn[0].closed);
 assert.ok(r.backends.size>0);
 assert.ok(r.errors.some(s=>s.includes('Cleanup BLOCKED: server-side PostgreSQL backends not proven stopped')));
 assert.ok(!r.output.some(s=>s.includes('two PostgreSQL sessions overlapped')));
});

test('failed setup cannot delete a fixture owned by another invocation',async()=>{
 const r=await scenario('setup-conflict');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,false);assert.equal(r.fixture,true);
 assert.equal(r.spawn.length,0);
 assert.ok(r.errors.some(s=>s.includes('NOT VERIFIED')));
});

test('unexpected session closure blocks cleanup despite transient zero backend visibility',async()=>{
 const r=await scenario('b-fail');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,false);assert.equal(r.fixture,true);
 assert.ok(!r.output.some(s=>s.includes('PASS: exact synthetic fixture removed')));
});

test('two overlapping instances: second is rejected by atomic exclusive lock before Docker',async()=>{
 const shared=new Map();
 const first=scenario('success',shared);
 await new Promise(resolve=>setTimeout(resolve,40));
 const second=await scenario('success',shared);
 assert.match(second.error??'',/EEXIST/);
 assert.equal(second.calls.length,0);assert.equal(second.spawn.length,0);
 assert.deepEqual(second.lockCalls,['acquire']);
 const finished=await first;
 assert.equal(finished.exitCode,0);assert.equal(finished.cleaned,true);
 assert.deepEqual(finished.lockCalls,['acquire','release']);
 assert.equal(shared.size,0);
});
test('failed invocation retains lock; later run cannot enter Docker',async()=>{
 const shared=new Map();
 const failed=await scenario('a-fail',shared);
 assert.equal(failed.exitCode,1);assert.equal(failed.cleaned,false);
 assert.deepEqual(failed.lockCalls,['acquire']);
 const repeat=await scenario('success',shared);
 assert.match(repeat.error??'',/EEXIST/);
 assert.equal(repeat.calls.length,0);
 assert.equal(shared.size,1);
});
