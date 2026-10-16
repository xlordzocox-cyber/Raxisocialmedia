import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.validation', { recursive: true });
await build({ entryPoints: ['tests/office.test.ts', 'tests/ideaCenter.test.ts'], outdir: '.validation', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm' });
const result = spawnSync(process.execPath, ['--test', '.validation/office.test.mjs', '.validation/ideaCenter.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
