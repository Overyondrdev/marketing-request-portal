#!/usr/bin/env node
// Syntax-check every browser module in public/js (they ship unbundled, so a typo breaks the app).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})('public/js');
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(String(e.stderr || e.message));
  }
}
console.log(`${files.length - failed}/${files.length} browser modules OK`);
process.exit(failed ? 1 : 0);
