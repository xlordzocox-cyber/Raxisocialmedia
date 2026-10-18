import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.validation', { recursive: true });
await build({ entryPoints: ['tests/office.test.ts', 'tests/ideaCenter.test.ts', 'tests/ideaCenterUI.test.tsx', 'tests/ideaCenterSession.test.tsx', 'tests/campaignWorkspace.test.tsx', 'tests/strategyStudio.test.tsx', 'tests/ariaPilot.test.tsx'], outdir: '.validation', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom/server', 'react/jsx-runtime'] });
const result = spawnSync(process.execPath, ['--test', '.validation/office.test.mjs', '.validation/ideaCenter.test.mjs', '.validation/ideaCenterUI.test.mjs', '.validation/ideaCenterSession.test.mjs', '.validation/campaignWorkspace.test.mjs', '.validation/strategyStudio.test.mjs', '.validation/ariaPilot.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
