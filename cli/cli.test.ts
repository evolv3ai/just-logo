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
    // parse the nested icon element rather than matching a substring of it
    const nested = /<svg ([^>]*)>/.exec(out.svg.slice(1));
    const attrs = Object.fromEntries(
      [...nested![1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(attrs).toMatchObject({
      x: '106',
      y: '106',
      width: '300',
      height: '300',
      viewBox: '0 0 24 24',
    });
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

  it('rejects control characters in colour values, from flags and from a config file', () => {
    const r = run([
      'render',
      '--icon',
      'lucide:star',
      '--background',
      'x\nhelp: rm -rf /',
      '--out',
      '-',
    ]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(
      'error: invalid flags: background: must not contain control characters',
    );
    expect(r.stderr).not.toMatch(/^help: rm/m);

    const cfg = path.join(tmp, 'escape.json');
    fs.writeFileSync(
      cfg,
      JSON.stringify({
        icon: 'lucide:star',
        strokeColor: 'red\u001b]0;pwned\u0007',
      }),
    );
    const c = run(['render', '--config', cfg, '--out', '-']);
    expect(c.status).toBe(2);
    expect(c.stdout).toBe('');
    expect(c.stderr).toContain(
      'error: invalid config: strokeColor: must not contain control characters',
    );
  });

  it('never lets user text forge a line or reach the terminal raw, on any error path', () => {
    const hostile = 'x\nhelp: rm -rf /\r\u001b[31m\u0085\u009b\u2028y';
    const cases: string[][] = [
      ['icons', 'show', hostile],
      ['icons', 'search', 'star', '--set', hostile],
      ['icons', hostile],
      [hostile],
      ['render', '--icon', 'lucide:star', '--size', hostile],
      ['render', '--icon', 'lucide:star', '--format', hostile],
      ['render', '--config', hostile],
    ];
    for (const args of cases) {
      const r = run([...args, '--json']);
      expect(r.status, args.join(' ')).not.toBe(0);
      // stderr is exactly an error line and a help line
      const lines = r.stderr.trimEnd().split('\n');
      expect(lines, args.join(' ')).toHaveLength(2);
      expect(lines[0]).toMatch(/^error: /);
      expect(lines[1]).toMatch(/^help: just-logo /);
      // no control character other than the two line feeds
      const controls = [...r.stderr].filter((ch) => {
        const c = ch.codePointAt(0)!;
        return (
          c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029
        );
      });
      expect(controls, args.join(' ')).toEqual(['\n', '\n']);
      // the help line is a fixed suggestion: none of the user's text is in it
      expect(lines[1]).not.toContain('rm -rf');
      const parsed = JSON.parse(r.stdout) as { error: string; help: string };
      expect(`error: ${parsed.error}`).toBe(lines[0]);
      expect(`help: ${parsed.help}`).toBe(lines[1]);
    }
  });

  it('caps the length of user text in a message', () => {
    const r = run(['icons', 'show', 'x'.repeat(5000)]);
    expect(r.status).toBe(1);
    const [error] = r.stderr.split('\n');
    expect(error).toBe(`error: icon not found: ${'x'.repeat(200)}…`);
  });

  it('never puts shell syntax from an icon id into the runnable help line', () => {
    const r = run(['icons', 'show', 'lucide:x;touch pwned']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('error: icon not found: lucide:x;touch pwned');
    expect(r.stderr).toContain('help: just-logo icons search rocket\n');
    // a well-formed name is still echoed, which is the useful case
    const ok = run(['icons', 'show', 'lucide:no-such-icon']);
    expect(ok.stderr).toContain('help: just-logo icons search no-such-icon\n');
    const render = run([
      'render',
      '--icon',
      'lucide:no-such-icon',
      '--out',
      '-',
    ]);
    expect(render.stderr).toContain(
      'help: just-logo icons search no-such-icon\n',
    );
  });
});

/** Run the command a help line suggests, the way a user pasting it would. */
function runHelpLine(stderr: string, cwd: string): Run {
  const help = /^help: just-logo (.*)$/m.exec(stderr);
  if (!help) throw new Error(`no help line in: ${stderr}`);
  const command = help[1].replace(/\s+#.*$/, ''); // drop the trailing shell comment
  return run(command.split(' '), cwd);
}

describe('render flags', () => {
  it('maps every flag onto its own setting, in the spec and in the drawing', () => {
    const r = run([
      'render',
      '--icon',
      'lucide:star',
      '--size',
      '200',
      '--rotate=-15',
      '--stroke-color',
      '#111111',
      '--stroke-width',
      '3',
      '--stroke-opacity',
      '40',
      '--fill-color',
      '#222222',
      '--fill-opacity',
      '60',
      '--background',
      '#333333',
      '--margin',
      '32',
      '--radius',
      '48',
      '--border-width',
      '8',
      '--border-color',
      '#444444',
      '--png-size',
      '256',
      '--out',
      '-',
      '--json',
    ]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as {
      spec: Record<string, unknown>;
      svg: string;
    };
    expect(out.spec).toEqual({
      icon: 'lucide:star',
      size: 200,
      rotate: -15,
      strokeColor: '#111111',
      strokeWidth: 3,
      strokeOpacity: 40,
      fillColor: '#222222',
      fillOpacity: 60,
      background: '#333333',
      margin: 32,
      radius: 48,
      borderWidth: 8,
      borderColor: '#444444',
      pngSize: 256,
    });
    // margin 32 -> a 480 box at 16; radius 48; border 8 -> padding box 464 at 24, radius 40
    expect(out.svg).toContain(
      '<rect x="16" y="16" width="480" height="480" rx="48" fill="#333333"/>',
    );
    expect(out.svg).toContain('M64 24h384a40 40 0 0 1 40 40');
    expect(out.svg).toContain('fill="#444444" fill-rule="evenodd"/>');
    expect(out.svg).toContain('<g transform="rotate(-15 256 256)">');
    expect(out.svg).toContain(
      '<svg x="156" y="156" width="200" height="200" viewBox="0 0 24 24" preserveAspectRatio="none" ' +
        'color="#111111" stroke-width="3" stroke-opacity="0.4" fill="#222222" fill-opacity="0.6">',
    );
  });

  it('labels a validation error with the input it came from', () => {
    const flag = run(['render', '--icon', 'lucide:star', '--size', '9999']);
    expect(flag.status).toBe(2);
    expect(flag.stderr).toContain(
      'error: invalid flags: size: must be between 0 and 512',
    );
    const cfg = path.join(tmp, 'label.json');
    fs.writeFileSync(cfg, JSON.stringify({ icon: 'lucide:star', margin: -1 }));
    // a valid flag next to an invalid config value: the config gets the blame
    const config = run(['render', '--config', cfg, '--size', '100']);
    expect(config.status).toBe(2);
    expect(config.stderr).toContain(
      'error: invalid config: margin: must be between 0 and 256',
    );
    const icon = run(['render', '--icon', 'Not An Id', '--out', '-']);
    expect(icon.status).toBe(2);
    expect(icon.stderr).toContain('error: invalid flags: icon: required');
    const cfgIcon = path.join(tmp, 'label-icon.json');
    fs.writeFileSync(cfgIcon, JSON.stringify({ icon: 'Not An Id' }));
    const fromCfg = run(['render', '--config', cfgIcon, '--out', '-']);
    expect(fromCfg.status).toBe(2);
    expect(fromCfg.stderr).toContain('error: invalid config: icon: required');
  });

  it('explains a bare negative number, and its help line runs', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'neg-'));
    const bare = run(
      ['render', '--icon', 'lucide:star', '--rotate', '-15', '--json'],
      dir,
    );
    expect(bare.status).toBe(2);
    const parsed = JSON.parse(bare.stdout) as { help: string; exit: number };
    expect(parsed.exit).toBe(2);
    expect(parsed.help).toContain('--rotate=-15');
    expect(parsed.help).toContain('negative values need the = form');
    expect(fs.readdirSync(dir)).toEqual([]);
    const fixed = runHelpLine(bare.stderr, dir);
    expect(fixed.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'logo.svg'), 'utf8')).toContain(
      'rotate(-15 256 256)',
    );
  });

  it('suggests a search, not a render, for a bare negative --limit', () => {
    const r = run(['icons', 'search', 'star', '--limit', '-5']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('help: just-logo icons search rocket --limit=5');
    expect(r.stderr).not.toContain('render');
    expect(runHelpLine(r.stderr, tmp).status).toBe(0);
  });

  it('gives a help line that runs for every bad numeric flag', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'helpline-'));
    for (const flag of [
      'size',
      'rotate',
      'stroke-width',
      'stroke-opacity',
      'fill-opacity',
      'margin',
      'radius',
      'border-width',
      'png-size',
    ]) {
      const bad = run(
        ['render', '--icon', 'lucide:star', `--${flag}=abc`],
        dir,
      );
      expect(bad.status, flag).toBe(2);
      expect(bad.stderr, flag).toContain(`error: --${flag} must be a number`);
      expect(bad.stderr, flag).toMatch(
        new RegExp(
          `^help: just-logo render --icon lucide:rocket --${flag}=-?\\d+$`,
          'm',
        ),
      );
      expect(runHelpLine(bad.stderr, dir).status, flag).toBe(0);
    }
  });

  it('rejects an empty --config or --out instead of ignoring it', () => {
    for (const flag of ['config', 'out']) {
      const dir = fs.mkdtempSync(path.join(tmp, 'empty-'));
      const r = run(['render', '--icon', 'lucide:star', `--${flag}=`], dir);
      expect(r.status, flag).toBe(2);
      expect(r.stderr, flag).toContain(
        `error: --${flag} needs a path, got an empty value`,
      );
      expect(fs.readdirSync(dir), flag).toEqual([]);
    }
  });

  it('exits 2 for a bad flag whatever else is wrong', () => {
    // a bad --format next to a missing icon, a missing config file, and both
    const missing = path.join(tmp, 'not-there.json');
    for (const rest of [
      ['--icon', 'lucide:no-such-icon'],
      ['--config', missing],
      ['--icon', 'lucide:no-such-icon', '--config', missing],
    ]) {
      const r = run(['render', ...rest, '--format', 'jpg', '--out', '-']);
      expect(r.status, rest.join(' ')).toBe(2);
      expect(r.stderr).toContain(
        'error: --format must be svg or png, got "jpg"',
      );
    }
    // every kind of bad flag value beats a missing config file
    for (const bad of [
      ['--size', 'abc'],
      ['--size', '9999'],
      ['--preset', 'No Such Preset'],
      ['--icon', 'Not An Id'],
      ['--background', 'a\u001bb'],
    ]) {
      const r = run(['render', '--config', missing, ...bad, '--out', '-']);
      expect(r.status, bad.join(' ')).toBe(2);
      expect(r.stderr, bad.join(' ')).not.toContain('config file not found');
    }
    // and with good flags the missing config is what gets reported, exit 1
    const onlyMissing = run(['render', '--config', missing, '--size', '100']);
    expect(onlyMissing.status).toBe(1);
    expect(onlyMissing.stderr).toContain('config file not found');
    const png = run([
      'render',
      '--icon',
      'lucide:no-such-icon',
      '--format',
      'png',
      '--out',
      '-',
    ]);
    expect(png.status).toBe(2);
    expect(png.stderr).toContain('PNG cannot be written to stdout');
  });

  it('reports a failed write with exit 1, the reason, and a help line that runs', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'write-'));
    fs.writeFileSync(path.join(dir, 'file'), '');
    const under = run(
      ['render', '--icon', 'lucide:star', '--out', 'file/logo.svg', '--json'],
      dir,
    );
    expect(under.status).toBe(1);
    const parsed = JSON.parse(under.stdout) as { error: string; exit: number };
    expect(parsed.exit).toBe(1);
    expect(parsed.error).toBe(
      'could not write file/logo.svg: part of the path is a file, not a directory',
    );
    const onto = run(['render', '--icon', 'lucide:star', '--out', '.'], dir);
    expect(onto.status).toBe(1);
    expect(onto.stderr).toContain(
      'error: could not write .: it is a directory',
    );
    expect(onto.stderr).toContain(
      'help: just-logo render --icon lucide:star --out=logo.svg',
    );
    expect(runHelpLine(onto.stderr, dir).status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'logo.svg'))).toBe(true);
  });
});

describe('icons errors', () => {
  it('exits 2 with a runnable help line for a bad icons command line', () => {
    const cases: [string[], string, string][] = [
      [
        ['icons'],
        'unknown icons subcommand: (none)',
        'just-logo icons search rocket',
      ],
      [
        ['icons', 'bogus'],
        'unknown icons subcommand: bogus',
        'just-logo icons search rocket',
      ],
      [
        ['icons', 'search'],
        'icons search needs a query',
        'just-logo icons search rocket',
      ],
      [
        ['icons', 'search', 'star', '--set', 'nope'],
        'unknown set: nope',
        'just-logo icons sets',
      ],
      [
        ['icons', 'search', 'star', '--set='],
        'unknown set: ',
        'just-logo icons sets',
      ],
      [
        ['icons', 'show'],
        'icons show needs a <set:name> id',
        'just-logo icons show lucide:rocket',
      ],
      [
        ['icons', 'sets', 'extra'],
        'Unexpected argument',
        'just-logo icons sets',
      ],
      [
        ['icons', 'show', 'lucide:star', 'lucide:rocket'],
        'icons show takes one id, got 2',
        'just-logo icons show lucide:rocket',
      ],
    ];
    for (const [args, error, help] of cases) {
      const r = run([...args, '--json']);
      expect(r.status, args.join(' ')).toBe(2);
      const parsed = JSON.parse(r.stdout) as {
        error: string;
        help: string;
        exit: number;
      };
      expect(parsed.error, args.join(' ')).toContain(error);
      expect(parsed.help, args.join(' ')).toBe(help);
      expect(parsed.exit).toBe(2);
      expect(r.stderr).toBe(`error: ${parsed.error}\nhelp: ${help}\n`);
      expect(runHelpLine(r.stderr, tmp).status, help).toBe(0);
    }
  });

  it('exits 1 for an icon that does not exist, in a known set or not', () => {
    for (const id of ['lucide:no-such-icon', 'nope:star', 'star']) {
      const r = run(['icons', 'show', id]);
      expect(r.status, id).toBe(1);
      expect(r.stderr, id).toContain(`error: icon not found: ${id}\n`);
      expect(r.stdout).toBe('');
    }
  });

  it('returns 20 results by default and says so when nothing matches', () => {
    const hits = JSON.parse(
      run(['icons', 'search', 'arrow', '--json']).stdout,
    ) as unknown[];
    expect(hits).toHaveLength(20);
    const more = JSON.parse(
      run(['icons', 'search', 'arrow', '--limit', '21', '--json']).stdout,
    ) as unknown[];
    expect(more).toHaveLength(21);
    const none = run(['icons', 'search', 'qqqqzzzzqqqq']);
    expect(none.status).toBe(0);
    expect(none.stdout).toBe('(no matches)\n');
  });
});

describe('format and default file name', () => {
  it('infers the format from the extension in any case, and lets --format override it', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'infer-'));
    const upper = run(
      ['render', '--icon', 'lucide:star', '--out', 'LOGO.PNG', '--json'],
      dir,
    );
    expect(upper.status).toBe(0);
    expect(JSON.parse(upper.stdout).format).toBe('png');
    expect(pngSize(path.join(dir, 'LOGO.PNG')).width).toBe(512);
    // an explicit --format wins over the extension, both ways
    const svg = run(
      [
        'render',
        '--icon',
        'lucide:star',
        '--format',
        'svg',
        '--out',
        'a.png',
        '--json',
      ],
      dir,
    );
    expect(JSON.parse(svg.stdout).format).toBe('svg');
    expect(fs.readFileSync(path.join(dir, 'a.png'), 'utf8')).toMatch(/^<svg /);
    const png = run(
      [
        'render',
        '--icon',
        'lucide:star',
        '--format',
        'png',
        '--out',
        'b.svg',
        '--json',
      ],
      dir,
    );
    expect(JSON.parse(png.stdout).format).toBe('png');
    expect(pngSize(path.join(dir, 'b.svg')).width).toBe(512);
    // anything else is svg, and the default name follows
    const other = run(
      ['render', '--icon', 'lucide:star', '--out', 'c.txt', '--json'],
      dir,
    );
    expect(JSON.parse(other.stdout).format).toBe('svg');
    const bare = run(['render', '--icon', 'lucide:star', '--json'], dir);
    expect(path.basename(JSON.parse(bare.stdout).out)).toBe('logo.svg');
    expect(
      run(['render', '--icon', 'lucide:star', '--format', 'PNG'], dir).status,
    ).toBe(2);
  });

  it('reports the size and byte count of what it actually wrote', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'summary-'));
    const svg = JSON.parse(
      run(['render', '--icon', 'lucide:star', '--out', 'a.svg', '--json'], dir)
        .stdout,
    ) as {
      bytes: number;
      width: number;
      height: number;
      svg: string;
      out: string;
    };
    const svgFile = fs.readFileSync(path.join(dir, 'a.svg'));
    expect(svg.bytes).toBe(svgFile.byteLength);
    expect(svgFile.toString('utf8')).toBe(svg.svg);
    expect([svg.width, svg.height]).toEqual([512, 512]);
    expect(svg.svg).toContain('width="512" height="512"');
    const png = JSON.parse(
      run(
        [
          'render',
          '--icon',
          'lucide:star',
          '--out',
          'a.png',
          '--png-size',
          '300',
          '--json',
        ],
        dir,
      ).stdout,
    ) as { bytes: number; width: number; height: number };
    expect(png.bytes).toBe(fs.statSync(path.join(dir, 'a.png')).size);
    expect({ width: png.width, height: png.height }).toEqual(
      pngSize(path.join(dir, 'a.png')),
    );
    expect(png.width).toBe(300);
    // --png-size does not change an SVG: it stays 512
    const ignored = JSON.parse(
      run([
        'render',
        '--icon',
        'lucide:star',
        '--out',
        '-',
        '--png-size',
        '300',
        '--json',
      ]).stdout,
    ) as { bytes: number; width: number; svg: string };
    expect(ignored.width).toBe(512);
    expect(ignored.bytes).toBe(Buffer.byteLength(ignored.svg));
    // the text summary says the same thing
    const text = run(
      ['render', '--icon', 'lucide:star', '--out', 'b.svg'],
      dir,
    );
    expect(text.stdout).toBe(
      `wrote ${fs.realpathSync(dir)}/b.svg (svg, 512x512, ${svg.bytes} bytes)\n`,
    );
  });

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

describe('approximation warnings', () => {
  const RADIAL = 'warning: radial gradient approximated';
  const BORDER =
    'warning: gradient approximated: the border colour is not opaque';
  const render = (background: string, border: string[]) => {
    const r = run([
      'render',
      '--icon',
      'lucide:star',
      '--background',
      background,
      ...border,
      '--out',
      '-',
      '--json',
    ]);
    expect(r.status).toBe(0);
    return {
      // the CLI's own lines only: Node may add a deprecation notice for tsx's loader
      warnings: r.stderr.split('\n').filter((l) => l.startsWith('warning: ')),
      out: JSON.parse(r.stdout) as {
        backgroundApproximated: boolean;
        backgroundApproximations: string[];
      },
    };
  };
  const seeThrough = [
    '--border-width',
    '8',
    '--border-color',
    'rgba(0,0,0,0.5)',
  ];

  it('warns about a gradient under a border that is not opaque', () => {
    const { warnings, out } = render('linear-gradient(#fff, #000)', seeThrough);
    expect(out.backgroundApproximated).toBe(true);
    expect(out.backgroundApproximations).toEqual(['gradient-under-border']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(BORDER);
  });

  it('prints both warnings when both approximations apply', () => {
    const { warnings, out } = render(
      'radial-gradient(circle, #fff, #000)',
      seeThrough,
    );
    expect(out.backgroundApproximations).toEqual([
      'radial-geometry',
      'gradient-under-border',
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(RADIAL);
    expect(warnings[1]).toContain(BORDER);
  });

  it('stays quiet for an opaque border, a plain colour, or an exact gradient', () => {
    for (const [background, border] of [
      [
        'linear-gradient(#fff, #000)',
        ['--border-width', '8', '--border-color', '#000'],
      ],
      ['#ff0000', seeThrough],
      ['radial-gradient(#fff, #000)', []],
    ] as [string, string[]][]) {
      const { warnings, out } = render(background, border);
      expect(out.backgroundApproximated, background).toBe(false);
      expect(out.backgroundApproximations, background).toEqual([]);
      expect(warnings, background).toEqual([]);
    }
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
    ['render', '--icon', 'lucide:star', '--bogus'], // Node's argument parser: unknown flag
    ['render', '--icon', 'lucide:star', '--size'], // ... missing value
    ['render', '--icon', 'lucide:star', '--rotate', '-15'], // ... ambiguous negative
    ['icons', 'search', 'star', '--limit'], // ... outside render
    ['presets', 'extra'], // ... unexpected positional
  ];
  const parserErrors = commands.slice(-5);
  it('exits 2 for every argument-parser error', () => {
    for (const cmd of parserErrors)
      expect(run(cmd).status, cmd.join(' ')).toBe(2);
  });
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

describe('the documented pnpm form', () => {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const hasPnpm =
    spawnSync(pnpm, ['--version'], { encoding: 'utf8' }).status === 0;

  it.skipIf(!hasPnpm)(
    'pnpm --silent logo --json prints exactly one JSON value',
    () => {
      const r = spawnSync(
        pnpm,
        ['--silent', 'logo', 'icons', 'sets', '--json'],
        {
          cwd: ROOT,
          encoding: 'utf8',
        },
      );
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toContain('lucide');
      const failed = spawnSync(
        pnpm,
        ['--silent', 'logo', 'icons', 'show', 'lucide:no-such-icon', '--json'],
        { cwd: ROOT, encoding: 'utf8' },
      );
      expect(failed.status).toBe(1);
      expect(JSON.parse(failed.stdout).exit).toBe(1);
    },
  );

  it('the README only shows --json through pnpm --silent or the just-logo bin', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const jsonLines = readme
      .split('\n')
      .filter((line) => /^\s*(pnpm|just-logo|npx)\b.*--json/.test(line));
    expect(jsonLines.length).toBeGreaterThan(0);
    for (const line of jsonLines)
      expect(line).toMatch(/^\s*(pnpm --silent logo|just-logo) /);
  });
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
    // no status, no signal: still a failure, and it says so
    const lost = exitFor({ status: null, signal: null });
    expect(lost).toEqual({
      code: 1,
      error: 'just-logo ended without an exit status',
      help: 'run it again',
    });
    expect(JSON.parse(failureOutput(lost, true).stdout).exit).toBe(1);
    expect(failureOutput(lost, false).stderr).toBe(
      'error: just-logo ended without an exit status\nhelp: run it again\n',
    );
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
