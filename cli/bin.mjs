#!/usr/bin/env node
// Shim so `just-logo` works as a bin inside a checkout (it needs the tsx dev
// dependency, so run `pnpm install` first): runs the TypeScript CLI through
// tsx. The caller's working directory is preserved so relative --out and
// --config paths resolve where the user is; tsx is pointed at this repo's
// tsconfig so the `@/` path alias still resolves from anywhere.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Map a spawn outcome to this process's exit code and, on a shim-level
 * failure, the error/help text. Pure, so it is tested without spawning
 * anything: a spawn failure, a signal death or a missing status is exit 1 with an error and a
 * help line; otherwise the child's code and no message (the child already
 * printed its own).
 */
export function exitFor(result) {
  if (result.error) {
    return {
      code: 1,
      error: `could not start just-logo: ${result.error.message}`,
      help: 'run pnpm install in the just-logo checkout',
    };
  }
  if (result.signal) {
    return {
      code: 1,
      error: `just-logo was killed by ${result.signal}`,
      help: 'run it again',
    };
  }
  if (result.status === null || result.status === undefined) {
    return {
      code: 1,
      error: 'just-logo ended without an exit status',
      help: 'run it again',
    };
  }
  return { code: result.status, error: null, help: null };
}

/** The lines to print for a shim-level failure: JSON on stdout when --json was asked for, error/help on stderr. */
export function failureOutput(outcome, json) {
  if (!outcome.error) return { stdout: '', stderr: '' };
  const stderr = `error: ${outcome.error}\nhelp: ${outcome.help}\n`;
  const stdout = json
    ? JSON.stringify({
        error: outcome.error,
        help: outcome.help,
        exit: outcome.code,
      }) + '\n'
    : '';
  return { stdout, stderr };
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  const args = process.argv.slice(2);
  let result;
  try {
    const tsx = require.resolve('tsx/cli');
    result = spawnSync(
      process.execPath,
      [tsx, path.join(here, 'index.ts'), ...args],
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
  const outcome = exitFor(result);
  const { stdout, stderr } = failureOutput(outcome, args.includes('--json'));
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exit(outcome.code);
}

/**
 * True when this file is the program Node was started with. Node realpaths
 * the ESM entry (import.meta.url) but leaves argv[1] as typed, so a symlinked
 * bin (pnpm/npm global link) must be realpathed before comparing.
 */
export function isMain(argv1, selfUrl) {
  if (!argv1) return false;
  let real;
  try {
    real = fs.realpathSync(argv1);
  } catch {
    return false;
  }
  return real === fileURLToPath(selfUrl);
}

if (isMain(process.argv[1], import.meta.url)) main();
