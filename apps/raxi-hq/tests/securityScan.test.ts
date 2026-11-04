import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';

// Run the actual scanner against disposable synthetic trees. Never use real tokens.
const scanner=readFileSync(join(process.cwd(),'scripts/security-scan.mjs'),'utf8');
const tokenKey=['access','token'].join('_');

function scanFixture(filename:string,text:string) {
 const root=mkdtempSync(join(tmpdir(),'raxi-security-regression-'));
 try {
  const target=join(root,filename);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,text);
  writeFileSync(join(root,'security-scan.mjs'),scanner);
  const result=spawnSync(process.execPath,['security-scan.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.error,undefined);
  return {code:result.status,report:JSON.parse(result.stdout) as {findings:{file:string;line:number;rule:string}[]}};
 } finally {rmSync(root,{recursive:true,force:true});}
}

test('generated bundle: exact OAuth key/value self-label is not a secret',()=>{
 const v=scanFixture('dist/assets/index-fixture.js',`${tokenKey}:"${tokenKey}"`);
 assert.equal(v.code,0);
 assert.deepEqual(v.report.findings,[]);
});

test('the exact same self-label is not exempted in application source',()=>{
 const v=scanFixture('src/fixture.js',`${tokenKey}:"${tokenKey}"`);
 assert.equal(v.code,1);
 assert.deepEqual(v.report.findings,[{file:'src/fixture.js',line:1,rule:'assigned-credential'}]);
});

test('other bundled values for access_token still trigger the credential guard',()=>{
 const v=scanFixture('dist/assets/index-fixture.js',`${tokenKey}:"synthetic_placeholder_different"`);
 assert.equal(v.code,1);
 assert.deepEqual(v.report.findings,[{file:'dist/assets/index-fixture.js',line:1,rule:'assigned-credential'}]);
});

test('other bundled credential keys remain guarded',()=>{
 const key=['pass','word'].join('');
 const v=scanFixture('dist/assets/index-fixture.js',`${key}:"synthetic_placeholder_different"`);
 assert.equal(v.code,1);
 assert.deepEqual(v.report.findings,[{file:'dist/assets/index-fixture.js',line:1,rule:'assigned-credential'}]);
});
