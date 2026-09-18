import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
// Resolve tsx's entry and run it with the current node binary, so the tests
// do not depend on a POSIX-only node_modules/.bin launcher.
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const BIN = path.join(ROOT, 'cli', 'bin.mjs');

type Run = { status: number | null; stdout: string; stderr: string };

function run(args: string[], cwd = ROOT): Run {
  const result = spawnSync(
    process.execPath,
    [TSX, path.join(ROOT, 'cli', 'index.ts'), ...args],
    {
      cwd,
      encoding: 'utf8',
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'just-logo-cli-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('icons search (AC1)', () => {
  it('finds the lucide rocket first for "rocket"', () => {
    const r = run(['icons', 'search', 'rocket', '--json']);
    expect(r.status).toBe(0);
    const hits = JSON.parse(r.stdout) as {
      set: string;
      name: string;
      id: string;
    }[];
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.slice(0, 3)).toContainEqual(
      expect.objectContaining({
        set: 'lucide',
        name: 'rocket',
        id: 'lucide:rocket',
      }),
    );
  });

  it('filters by set and honours the limit', () => {
    const r = run([
      'icons',
      'search',
      'heart',
      '--set',
      'tabler',
      '--limit',
      '3',
      '--json',
    ]);
    expect(r.status).toBe(0);
    const hits = JSON.parse(r.stdout) as { set: string }[];
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits.every((h) => h.set === 'tabler')).toBe(true);
  });

  it('lists the five sets', () => {
    const r = run(['icons', 'sets', '--json']);
    expect(JSON.parse(r.stdout)).toEqual([
      'lucide',
      'lucide-lab',
      'hugeicons',
      'tabler',
      'meteor-icons',
    ]);
  });
});

describe('render errors (AC2)', () => {
  it('exits 1 with error and help lines for an unknown icon', () => {
    const r = run(['render', '--icon', 'lucide:no-such-icon', '--out', '-']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('error: icon not found');
    expect(r.stderr).toMatch(/^help: .+/m);
    expect(r.stdout).toBe('');
  });

  it('exits 2 for an unknown flag and for a missing icon', () => {
    expect(run(['render', '--icon', 'lucide:rocket', '--bogus']).status).toBe(
      2,
    );
    expect(run(['render', '--out', '-']).status).toBe(2);
  });
});

describe('render svg (AC3)', () => {
  it('prints one 512x512 svg with the Ocean Breeze gradient and the icon', () => {
    const r = run([
      'render',
      '--icon',
      'lucide:rocket',
      '--preset',
      'Ocean Breeze',
      '--out',
      '-',
    ]);
    expect(r.status).toBe(0);
    const svg = r.stdout.trim();
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<\/svg>/g)).toHaveLength(2); // outer + nested icon
    expect(svg).toContain('width="512" height="512"');
    expect(svg).toContain('stop-color="#667eea"');
    expect(svg).toContain('stop-color="#764ba2"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('color="#ffffff"');
  });
});

describe('config file and override (AC5)', () => {
  it('renders the tabler heart at the overridden size', () => {
    const cfg = path.join(tmp, 'spec.json');
    fs.writeFileSync(cfg, JSON.stringify({ icon: 'tabler:heart', size: 200 }));
    const r = run([
      'render',
      '--config',
      cfg,
      '--size',
      '300',
      '--out',
      '-',
      '--json',
    ]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as {
      spec: { icon: string; size: number };
      svg: string;
    };
    expect(out.spec.icon).toBe('tabler:heart');
    expect(out.spec.size).toBe(300);
    expect(out.svg).toContain('<svg x="106" y="106" width="300" height="300"');
  });

  it('rejects an invalid config with exit 2 and a schema hint', () => {
    const cfg = path.join(tmp, 'bad.json');
    fs.writeFileSync(cfg, JSON.stringify({ icon: 'tabler:heart', size: 9999 }));
    const r = run(['render', '--config', cfg, '--out', '-']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('size: must be between');
    expect(r.stderr).toContain('help: just-logo schema');
  });
});

describe('png (AC6)', () => {
  it('writes a 512x512 png by default and 1024 with --png-size', () => {
    const a = path.join(tmp, 'logo.png');
    const r1 = run(['render', '--icon', 'lucide:rocket', '--out', a, '--json']);
    expect(r1.status).toBe(0);
    expect(JSON.parse(r1.stdout).format).toBe('png');
    expect(pngSize(a)).toEqual({ width: 512, height: 512 });

    const b = path.join(tmp, 'big.png');
    const r2 = run([
      'render',
      '--icon',
      'lucide:rocket',
      '--out',
      b,
      '--png-size',
      '1024',
    ]);
    expect(r2.status).toBe(0);
    expect(pngSize(b)).toEqual({ width: 1024, height: 1024 });
  });
});

describe('json contract (AC7)', () => {
  const commands: string[][] = [
    ['icons', 'sets'],
    ['icons', 'search', 'star', '--limit', '2'],
    ['icons', 'show', 'lucide:star'],
    ['presets'],
    ['schema'],
    ['render', '--icon', 'lucide:star', '--out', '-'],
    ['render', '--icon', 'lucide:nope', '--out', '-'], // error path
    ['nonsense'], // usage path
  ];
  for (const cmd of commands) {
    it(`emits exactly one JSON value for: ${cmd.join(' ')}`, () => {
      const r = run([...cmd, '--json']);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
      expect(r.stdout.trim().split('\n')).toHaveLength(1);
      if (r.status !== 0) {
        const parsed = JSON.parse(r.stdout) as {
          error: string;
          help: string;
          exit: number;
        };
        expect(parsed.error).toBeTruthy();
        expect(parsed.help).toBeTruthy();
        expect(parsed.exit).toBe(r.status);
      }
    });
  }
});

describe('bin shim', () => {
  it('runs through cli/bin.mjs from another directory', () => {
    const r = spawnSync(process.execPath, [BIN, 'icons', 'sets', '--json'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toContain('lucide');
  });

  it("resolves relative --config and --out against the caller's directory, not the repo", () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'cwd-'));
    fs.writeFileSync(
      path.join(dir, 'spec.json'),
      JSON.stringify({ icon: 'lucide:star', preset: 'Sunset' }),
    );
    const r = spawnSync(
      process.execPath,
      [BIN, 'render', '--config', 'spec.json', '--out', 'out.svg', '--json'],
      {
        cwd: dir,
        encoding: 'utf8',
      },
    );
    expect(r.status).toBe(0);
    // realpath on both sides: macOS mounts the temp dir through a /private symlink
    expect(fs.realpathSync(JSON.parse(r.stdout).out)).toBe(
      fs.realpathSync(path.join(dir, 'out.svg')),
    );
    expect(fs.existsSync(path.join(dir, 'out.svg'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'out.svg'))).toBe(false);
  });

  it('passes the CLI exit code through', () => {
    const r = spawnSync(process.execPath, [BIN, 'render', '--out', '-'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    const r1 = spawnSync(
      process.execPath,
      [BIN, 'render', '--icon', 'lucide:nope', '--out', '-'],
      {
        cwd: tmp,
        encoding: 'utf8',
      },
    );
    expect(r1.status).toBe(1);
  });
});
