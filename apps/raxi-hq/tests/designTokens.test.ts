import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : []);
}
const files = cssFiles(SRC).map((path) => ({ name: relative(SRC, path).replaceAll('\\', '/'), css: readFileSync(path, 'utf8') }));
const tokens = files.find((f) => f.name === 'design/tokens.css')!.css;
const defined = (css: string) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

test('design tokens: the full system is declared once in tokens.css', () => {
  const have = defined(tokens);
  for (const t of ['--bg', '--panel', '--ink', '--muted', '--accent', '--surface-2', '--border', '--border-strong', '--accent-ink',
    '--status-ok', '--status-warn', '--status-danger', '--font-ui', '--font-display', '--text-xs', '--text-sm', '--text-md', '--text-lg',
    '--text-xl', '--text-2xl', '--text-display', '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7',
    '--space-8', '--radius-sm', '--radius-md', '--radius-pill', '--shadow-1', '--ease', '--dur-fast']) assert.ok(have.has(t), `missing ${t}`);
});

test('design tokens: every CSS variable in use is defined', () => {
  const global = defined(tokens);
  for (const f of files) {
    const local = defined(f.css);
    for (const [, name] of f.css.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(global.has(name) || local.has(name), `${f.name} uses undefined ${name}`);
  }
});

// Ratchet: hand-written hex colors may only go down. New stylesheets start at zero.
const HEX_BUDGET: Record<string, number> = { 'design/global.css': 98, 'campus/campus.css': 214, 'portfolio/fototeca.css': 15 };
test('design tokens: hand-written colors never increase outside tokens.css', () => {
  for (const f of files) {
    if (f.name === 'design/tokens.css') continue;
    const count = (f.css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).length;
    assert.ok(count <= (HEX_BUDGET[f.name] ?? 0), `${f.name}: ${count} hex colors, budget ${HEX_BUDGET[f.name] ?? 0}. Use a token.`);
  }
});
