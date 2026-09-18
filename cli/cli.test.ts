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
      // like bin.mjs: keep the caller's cwd but resolve the `@/` alias from the repo tsconfig
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: path.join(ROOT, 'tsconfig.json'),
      },
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
    const hits = JSON.parse(r.stdout) as { set: string; name: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits.every((h) => h.set === 'tabler')).toBe(true);
    expect(hits[0].name).toBe('heart');
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
    // the icon that was drawn is the tabler heart, not just echoed in the spec
    const shown = JSON.parse(
      run(['icons', 'show', 'tabler:heart', '--json']).stdout,
    ) as { body: string };
    expect(shown.body.length).toBeGreaterThan(20);
    expect(out.svg).toContain(shown.body);
  });

  it('lets --preset on the command line override colours from the config file', () => {
    const cfg = path.join(tmp, 'coloured.json');
    fs.writeFileSync(
      cfg,
      JSON.stringify({
        icon: 'lucide:star',
        preset: 'Dark Mode',
        strokeColor: '#123456',
      }),
    );
    // config alone: its explicit colour beats its own preset
    const a = run(['render', '--config', cfg, '--out', '-', '--json']);
    expect(JSON.parse(a.stdout).spec.strokeColor).toBe('#123456');
    // a flag preset beats the config's colour
    const b = run([
      'render',
      '--config',
      cfg,
      '--preset',
      'Sunset',
      '--out',
      '-',
      '--json',
    ]);
    const specB = JSON.parse(b.stdout).spec as {
      strokeColor: string;
      background: string;
      preset: string;
    };
    expect(specB.preset).toBe('Sunset');
    expect(specB.strokeColor).toBe('#ffffff');
    expect(specB.background).toContain('#ff6b6b');
    // a colour flag beats the flag preset
    const c = run([
      'render',
      '--config',
      cfg,
      '--preset',
      'Sunset',
      '--stroke-color',
      '#abcdef',
      '--out',
      '-',
      '--json',
    ]);
    expect(JSON.parse(c.stdout).spec.strokeColor).toBe('#abcdef');
  });

  it('reports a config directory and a missing file differently, both exit 1', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'isdir-'));
    const r = run(['render', '--config', dir, '--out', '-']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is a directory');
    const r2 = run([
      'render',
      '--config',
      path.join(tmp, 'nope.json'),
      '--out',
      '-',
    ]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain('config file not found');
  });

  it('treats malformed JSON as a usage error, like other bad config content', () => {
    const cfg = path.join(tmp, 'broken.json');
    fs.writeFileSync(cfg, '{ not json');
    const r = run(['render', '--config', cfg, '--out', '-']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not valid JSON');
  });

  it('rejects a config that is not a JSON object with exit 2', () => {
    for (const body of ['null', '[]', '"x"']) {
      const cfg = path.join(tmp, 'notobj.json');
      fs.writeFileSync(cfg, body);
      const r = run(['render', '--config', cfg, '--out', '-']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('must contain a JSON object');
    }
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

describe('flag validation', () => {
  it('rejects unknown flags on every command with exit 2', () => {
    for (const cmd of [
      ['icons', 'sets'],
      ['icons', 'show', 'lucide:star'],
      ['presets'],
      ['schema'],
      ['icons', 'search', 'x'],
    ]) {
      const r = run([...cmd, '--bogus']);
      expect(r.status, cmd.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/^help: /m);
    }
  });

  it('rejects empty, fractional, zero and negative --limit and empty numeric flags', () => {
    for (const bad of ['0', '-1', '1.5', 'x', '']) {
      const r = run(['icons', 'search', 'star', `--limit=${bad}`]);
      expect(r.status, `--limit=${bad}`).toBe(2);
      expect(r.stderr).toContain(
        'help: just-logo icons search rocket --limit 5',
      );
    }
    const r = run(['render', '--icon', 'lucide:star', '--size=', '--out', '-']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--size must be a number');
  });

  it('never lets user text forge a help: line on stderr', () => {
    const r = run([
      'render',
      '--icon',
      'lucide:star',
      '--background',
      'x\nhelp: rm -rf /',
      '--out',
      '-',
    ]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/^help: rm/m);
  });
});

describe('format and default file name', () => {
  it('refuses --format png with --out - and explains', () => {
    const r = run([
      'render',
      '--icon',
      'lucide:star',
      '--format',
      'png',
      '--out',
      '-',
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('PNG cannot be written to stdout');
  });

  it('exits 1 with a useful help line when the PNG rasteriser cannot load', () => {
    const result = spawnSync(
      process.execPath,
      [
        TSX,
        path.join(ROOT, 'cli', 'index.ts'),
        'render',
        '--icon',
        'lucide:star',
        '--out',
        path.join(tmp, 'x.png'),
        '--json',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: path.join(ROOT, 'tsconfig.json'),
          JUST_LOGO_DISABLE_RESVG: '1',
        },
      },
    );
    expect(result.status).toBe(1);
    const out = JSON.parse(result.stdout) as { error: string; help: string };
    expect(out.error).toContain('PNG rasteriser unavailable');
    expect(out.help).toContain('--format svg');
  });

  it('uses one JSON shape for stdout and file output', () => {
    const a = JSON.parse(
      run(['render', '--icon', 'lucide:star', '--out', '-', '--json']).stdout,
    ) as Record<string, unknown>;
    const b = JSON.parse(
      run([
        'render',
        '--icon',
        'lucide:star',
        '--out',
        path.join(tmp, 'shape.svg'),
        '--json',
      ]).stdout,
    ) as Record<string, unknown>;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.out).toBe('-');
    expect(b.svg).toBe(a.svg);
  });

  it('writes logo.png, not logo.svg, when only --format png is given', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'fmt-'));
    const r = run(
      ['render', '--icon', 'lucide:star', '--format', 'png', '--json'],
      dir,
    );
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { out: string; format: string };
    expect(out.format).toBe('png');
    expect(path.basename(out.out)).toBe('logo.png');
    expect(fs.existsSync(path.join(dir, 'logo.svg'))).toBe(false);
    expect(pngSize(path.join(dir, 'logo.png')).width).toBe(512);
  });

  it('warns on stderr and flags passthrough for a background it cannot convert', () => {
    const r = run([
      'render',
      '--icon',
      'lucide:star',
      '--background',
      'conic-gradient(#fff, #000)',
      '--out',
      '-',
      '--json',
    ]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).backgroundPassthrough).toBe(true);
    expect(r.stderr).toContain('warning: background');
  });

  it('reports an approximated radial gradient in --json and on stderr', () => {
    const r = run([
      'render',
      '--icon',
      'lucide:star',
      '--background',
      'radial-gradient(circle at top, #fff, #000)',
      '--out',
      '-',
      '--json',
    ]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as {
      backgroundPassthrough: boolean;
      backgroundApproximated: boolean;
    };
    expect(out.backgroundPassthrough).toBe(false);
    expect(out.backgroundApproximated).toBe(true);
    expect(r.stderr).toContain('warning: radial gradient');
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
  it('returns real content for show, presets and schema', () => {
    const show = JSON.parse(
      run(['icons', 'show', 'lucide:star', '--json']).stdout,
    ) as { id: string; body: string; svg: string };
    expect(show.id).toBe('lucide:star');
    expect(show.body).toContain('<');
    expect(show.svg).toContain(show.body);
    const text = run(['icons', 'show', 'lucide:star']);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('body: ');
    expect(text.stdout).toContain('svg: <svg');
    const presets = JSON.parse(run(['presets', '--json']).stdout) as {
      name: string;
      background: string;
      strokeColor: string;
    }[];
    expect(presets.length).toBeGreaterThan(10);
    expect(
      presets.find((p) => p.name === 'Ocean Breeze')?.background,
    ).toContain('#667eea');
    expect(Object.keys(presets[0]).sort()).toEqual([
      'background',
      'borderColor',
      'fillColor',
      'name',
      'strokeColor',
      'strokeOpacity',
    ]);
    const schema = JSON.parse(run(['schema', '--json']).stdout) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toContain('background');
  });

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
  it('maps spawn failures and signals to exit 1 and passes child codes through', async () => {
    const { exitFor, failureOutput } = await import('./bin.mjs');
    expect(exitFor({ status: 0, signal: null })).toEqual({
      code: 0,
      error: null,
      help: null,
    });
    expect(exitFor({ status: 2, signal: null }).code).toBe(2);
    expect(exitFor({ status: null, signal: null }).code).toBe(1); // no status, no signal: still a failure
    const killed = exitFor({ status: null, signal: 'SIGKILL' });
    expect(killed.code).toBe(1);
    expect(killed.error).toContain('SIGKILL');
    const failed = exitFor({
      status: null,
      signal: null,
      error: new Error('ENOENT'),
    });
    expect(failed.code).toBe(1);
    expect(failed.error).toBe('could not start just-logo: ENOENT');
    // shim failures honour --json: one JSON object on stdout, error/help on stderr
    const plain = failureOutput(failed, false);
    expect(plain.stdout).toBe('');
    expect(plain.stderr).toMatch(
      /^error: could not start just-logo: ENOENT\nhelp: /,
    );
    const json = failureOutput(failed, true);
    expect(JSON.parse(json.stdout)).toEqual({
      error: failed.error,
      help: failed.help,
      exit: 1,
    });
    expect(failureOutput(exitFor({ status: 0, signal: null }), true)).toEqual({
      stdout: '',
      stderr: '',
    });
  });

  it('runs through cli/bin.mjs from another directory', () => {
    const r = spawnSync(process.execPath, [BIN, 'icons', 'sets', '--json'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toContain('lucide');
    expect(r.stderr).not.toMatch(/^(null|error:)/m); // a clean run writes no shim message
  });

  it('still runs when invoked through a symlink, as pnpm link --global does', () => {
    const linkDir = fs.mkdtempSync(path.join(tmp, 'link-'));
    const link = path.join(linkDir, 'just-logo');
    fs.symlinkSync(BIN, link);
    const r = spawnSync(process.execPath, [link, 'icons', 'sets', '--json'], {
      cwd: linkDir,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toContain('lucide');
  });

  it('isMain compares real paths and tolerates a missing argv[1]', async () => {
    const { isMain } = await import('./bin.mjs');
    const selfUrl = new URL('./bin.mjs', import.meta.url).href;
    expect(isMain(BIN, selfUrl)).toBe(true);
    const link = path.join(fs.mkdtempSync(path.join(tmp, 'ismain-')), 'jl');
    fs.symlinkSync(BIN, link);
    expect(isMain(link, selfUrl)).toBe(true);
    expect(isMain(path.join(ROOT, 'cli', 'index.ts'), selfUrl)).toBe(false);
    expect(isMain(undefined, selfUrl)).toBe(false);
    expect(isMain(path.join(tmp, 'does-not-exist'), selfUrl)).toBe(false);
  });

  it('prints usage when invoked with no arguments', () => {
    const r = spawnSync(process.execPath, [BIN], {
      cwd: tmp,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('just-logo <command>');
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
