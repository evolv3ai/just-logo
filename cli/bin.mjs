#!/usr/bin/env node
// Shim so `just-logo` works as a bin: run the TypeScript CLI through tsx.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const result = spawnSync(
  process.execPath,
  [tsx, path.join(here, 'index.ts'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    cwd: path.resolve(here, '..'),
  },
);
process.exit(result.status ?? 1);
