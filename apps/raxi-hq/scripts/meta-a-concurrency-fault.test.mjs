// Meta A concurrency fault-injection harness. FAKE_ONLY: never invokes Docker/SQL/network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';

const file=new URL('./meta-a-native-pg17-concurrency.mjs',import.meta.url);
const source=readFileSync(file,'utf8').replace(/^import\s+.*?;\s*$/gm,'');
if(source.includes('import {')) throw Error('Unexpected module syntax');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run=new AsyncFunction('execFileSync','spawn','assert','process','console','setTimeout',source);
const id='f8e8d43f6eac5b6ae2216e7272613d70b14fb53cebec6fdbf02c85f799481168';
const image='sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const base='raxi_campaign_qa|postgres|170011|LOCAL\ntables=18\nusers=0\nworkspaces=0\nrpc=true';

async function scenario(kind) {
 const state={calls:[],spawn:[],fixture:false,cleaned:false,output:[],errors:[],backends:new Set()};
 const proc={platform:'win32',env:kind==='remote'?{DOCKER_HOST:'tcp://remote.example:2375'}:{},exitCode:0};
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
  if(sql.includes('INSERT INTO auth.users')){state.fixture=true;return '';}
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
 try {await run(execFileSync,spawn,assert,proc,log,setTimeout);}catch(e){state.error=e.message;}
 state.exitCode=proc.exitCode;
 return state;
}

test('remote Docker context blocked before any daemon interaction',async()=>{
 const r=await scenario('remote');
 assert.match(r.error??'',/local Windows Docker pipe/);
 assert.equal(r.calls.length,0);assert.equal(r.spawn.length,0);
});
test('A early failure: no false PASS and guarded fixture cleanup',async()=>{
 const r=await scenario('a-fail');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,true);assert.equal(r.fixture,false);
 assert.equal(r.spawn.length,1);
 assert.ok(r.errors.some(s=>s.includes('NOT VERIFIED')));
 assert.ok(!r.output.some(s=>s.includes('two PostgreSQL sessions overlapped')));
});
test('B early failure: terminate A then clean exact synthetic fixture',async()=>{
 const r=await scenario('b-fail');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,true);assert.equal(r.fixture,false);
 assert.equal(r.spawn.length,2);assert.ok(r.spawn[0].killed&&r.spawn[0].closed);
 assert.ok(!r.output.some(s=>s.includes('two PostgreSQL sessions overlapped')));
});
test('nominal fake overlap: no real Docker, successful cleanup',async()=>{
 const r=await scenario('success');
 assert.equal(r.exitCode,0);assert.equal(r.cleaned,true);assert.equal(r.fixture,false);
 assert.ok(r.output.some(s=>s.includes('two PostgreSQL sessions overlapped')));
});

test('session A fails after lock observation while B hangs: fail fast, cancel B and clean',async()=>{
 const r=await scenario('a-fail-after-lock');
 assert.equal(r.exitCode,1);assert.equal(r.cleaned,true);assert.equal(r.fixture,false);
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
