import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['provider-key', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})\b/g],
  ['assigned-credential', /\b(?:api[_-]?key|password|passwd|client[_-]?secret|access[_-]?token|authorization)\b\s*[:=]\s*["'][^"'\s]{8,}["']/gi],
  ['bearer-value', /\bBearer\s+[A-Za-z0-9._-]{16,}/g],
  ['url-userinfo', /https?:\/\/[^\s/"']+:[^\s/"']+@/g],
  ['private-url', /https?:\/\/(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[^\s/"']+\.(?:internal|local|corp))(?=[:/\s"'])/g],
  ['credential-in-url', /https?:\/\/[^\s"']*[?&](?:api[_-]?key|token|password|secret)=[^\s&"']+/gi],
];
const findings = []; let scanned = 0; let modelReferences = 0;
async function scan(dir) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    if (['node_modules','.git','.validation'].includes(entry.name)) continue;
    const path = join(dir,entry.name);
    if (entry.isDirectory()) { await scan(path); continue; }
    const data = await readFile(path); if (data.includes(0)) continue;
    const source=data.toString('utf8'); scanned++;
    if (!path.endsWith('security-scan.mjs')) modelReferences += [...source.matchAll(/gpt-5\.5/g)].length;
    for (const [rule,pattern] of rules) {
      for (const match of source.matchAll(pattern)) findings.push({file:relative('.',path).replaceAll('\\','/'),line:source.slice(0,match.index).split('\n').length,rule});
    }
  }
}
await scan('.');
console.log(JSON.stringify({scanned,modelReferences,findings,scope:'Application source, configuration, lockfile, docs, tests and production build. Dependency internals excluded; npm audit covers dependencies.'},null,2));
process.exitCode=findings.length?1:0;
