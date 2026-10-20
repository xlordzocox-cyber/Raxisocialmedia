import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.validation', { recursive: true });
const entries = ['office.test.ts', 'ideaCenter.test.ts', 'ideaCenterUI.test.tsx', 'ideaCenterSession.test.tsx', 'campaignWorkspace.test.tsx', 'strategyStudio.test.tsx', 'ariaPilot.test.tsx', 'auth.test.tsx', 'realPersistence.test.tsx'];
await build({ entryPoints: entries.map(name => `tests/${name}`), outdir: '.validation', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-router-dom', 'react-test-renderer', '@supabase/supabase-js'] });
const result = spawnSync(process.execPath, ['--test', ...entries.map(name => `.validation/${name.replace(/\.tsx?$/, '.mjs')}`)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
