// Pure guard regressions: no Docker calls, SQL or host processes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Local opt-in harness imports inertly.
import {validateLab,validateSqlTarget,LAB,bindFixtureSql,PG17_SCHEMA_SHA256} from '../scripts/native-pg17-lab.mjs';
// @ts-ignore Existing offline manifest digest, no hosted authorization changes.
import {digest} from '../scripts/staging-manifest.mjs';
const valid=()=>({id:LAB.id,name:'/'+LAB.name,image:LAB.image,tag:'postgres:17',running:true,paused:false,restarting:false,privileged:false,publishAll:false,
 bindings:{},ports:{'5432/tcp':null},networks:{[LAB.network]:{NetworkID:'test-network'}},mounts:[{Type:'tmpfs',Destination:'/var/lib/postgresql/data'}]});
const network=()=>({Name:LAB.network,Id:'test-network',Internal:true});
test('native lab guard accepts only reviewed immutable container and isolation',()=>{assert.equal(validateLab(valid(),network()).dataStorage,'tmpfs');});
for(const [name,change] of Object.entries({name:{name:'/other'},id:{id:'other'},image:{image:'other'},tag:{tag:'postgres:18'},
 stopped:{running:false},paused:{paused:true},restarting:{restarting:true},privileged:{privileged:true},publishAll:{publishAll:true},
 binding:{bindings:{'5432/tcp':[{}]}},port:{ports:{'5432/tcp':[{}]}},extraNetwork:{networks:{[LAB.network]:{NetworkID:'test-network'},bridge:{}}},
 disk:{mounts:[{Type:'volume',Destination:'/var/lib/postgresql/data'}]},extraMount:{mounts:[...valid().mounts,{Type:'bind',Destination:'/other'}]}})){
 test(`native lab rejects ${name} before SQL`,()=>{assert.throws(()=>validateLab({...valid(),...change},network()));});
}
test('native lab rejects public or mismatched network',()=>{for(const change of [{Internal:false},{Id:'different'},{Name:'bridge'}])assert.throws(()=>validateLab(valid(),{...network(),...change}));});
test('native SQL identity denies arbitrary database/user/version/remote/data directory',()=>{
 const row={db:LAB.database,actor:LAB.user,version:170011,data:'/var/lib/postgresql/data',remote:null};validateSqlTarget(row);
 for(const change of [{db:'postgres'},{db:'jrkefsylpfriiqefcmzq'},{actor:'postgres'},{version:180001},{remote:'127.0.0.1'},{data:'/persistent'}])assert.throws(()=>validateSqlTarget({...row,...change}));
});
test('static fixture binding quotes data and rejects non-finite/missing parameters',()=>{
 assert.equal(bindFixtureSql('select $1,$2',["';select 1;--",false]),"select ''';select 1;--',false");
 for(const params of [[],[Infinity],[NaN],['\0']])assert.throws(()=>bindFixtureSql('select $1',params));
});
test('native PG17 schema reference is pinned separately without changing hosted readiness',()=>{
 const snapshot=JSON.parse(readFileSync('../../supabase/tests/pg17.expected-schema.json','utf8'));
 assert.equal(snapshot.postgresMajor,17);assert.equal(digest(snapshot),PG17_SCHEMA_SHA256);
 snapshot.tables[0].sha256='0'.repeat(64);assert.notEqual(digest(snapshot),PG17_SCHEMA_SHA256);
 const manifest=JSON.parse(readFileSync('../../supabase/staging/raxi-hq-staging.manifest.json','utf8'));
 assert.equal(manifest.executionReady,false);assert.ok(Object.values(manifest.authorizations).every(x=>x===false));
});
