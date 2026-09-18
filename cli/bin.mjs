#!/usr/bin/env node
// Shim so `just-logo` works as a bin inside a checkout (it needs the tsx dev
// dependency, so run `pnpm install` first): runs the TypeScript CLI through
// tsx. The caller's working directory is preserved so relative --out and
// --config paths resolve where the user is; tsx is pointed at this repo's
// tsconfig so the `@/` path alias still resolves from anywhere.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Map a spawn outcome to this process's exit code and an optional error text.
 * Pure, so it is tested without spawning anything: a spawn failure or a
 * signal death is exit 1 with error/help lines; otherwise the child's code.
 */
export function exitFor(result) {
  if (result.error) {
    return {
      code: 1,
      message: `error: could not start just-logo: ${result.error.message}\nhelp: run pnpm install in the just-logo checkout`,
    };
  }
  if (result.signal) {
    return {
      code: 1,
      message: `error: just-logo was killed by ${result.signal}\nhelp: run it again`,
    };
  }
  return { code: result.status ?? 1, message: null };
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  let result;
  try {
    const tsx = require.resolve('tsx/cli');
    result = spawnSync(
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
  } catch (error) {
    result = { status: null, signal: null, error };
  }
  const { code, message } = exitFor(result);
  if (message) process.stderr.write(message + '\n');
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
