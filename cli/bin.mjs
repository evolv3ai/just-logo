#!/usr/bin/env node
// Shim so `just-logo` works as a bin: run the TypeScript CLI through tsx.
// The caller's working directory is preserved so relative --out and --config
// paths resolve where the user is; tsx is pointed at this repo's tsconfig so
// the `@/` path alias still resolves from anywhere.
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
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: path.resolve(here, '..', 'tsconfig.json'),
    },
  },
);
if (result.signal) {
  process.stderr.write(`error: just-logo was killed by ${result.signal}\n`);
  process.exit(1);
}
process.exit(result.status);
