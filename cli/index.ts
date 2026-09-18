#!/usr/bin/env tsx
/**
 * just-logo CLI: the web editor's icon search, presets and export, without a
 * browser. Every command takes --json (exactly one JSON value on stdout).
 * Exit codes: 0 ok, 1 operational error (file I/O, missing icon, rasteriser),
 * 2 usage error (bad flags, malformed or invalid config content).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { PRESETS } from '@/lib/constants';
import {
  bareIconSvg,
  findIcon,
  iconSets,
  parseIconId,
  searchIcons,
} from './icons';
import { renderPng, renderSvg } from './render';
import {
  CONTROL_CHARACTERS,
  layerSpec,
  resolveSpec,
  specSchema,
  validateSpec,
  type LogoSpec,
} from './spec';

const USAGE = `just-logo <command> [options]

Commands:
  icons sets                         list the icon sets
  icons search <query> [--set s] [--limit n]
  icons show <set:name>              body and a bare SVG of one icon
  presets                            list presets and their colours
  schema                             JSON schema of a render spec
  render [flags] [--config file]     render a logo (--out path, default logo.<format>; --out - for stdout)

Render flags: --icon <set:name> --preset <name> --size --rotate --stroke-color --stroke-width
  --stroke-opacity --fill-color --fill-opacity --background --margin --radius --border-width
  --border-color --png-size --format svg|png

Negative values need the = form: --rotate=-15
Through pnpm, use "pnpm --silent logo ..." with --json: plain "pnpm logo" prints its script banner on stdout.
Every command accepts --json. Exit codes: 0 ok, 1 error (I/O, missing icon, rasteriser),
2 usage (unknown flag, bad value, malformed or invalid config content).`;

class CliError extends Error {
  constructor(
    message: string,
    public help: string,
    public code: 1 | 2,
  ) {
    super(message);
  }
}

function fail(message: string, help: string, code: 1 | 2 = 1): never {
  throw new CliError(message, help, code);
}

const CONTROL_RUN = new RegExp(`[${CONTROL_CHARACTERS}]+`, 'g');

/** User-supplied text destined for a message: one line, no control characters, bounded. */
function safe(value: unknown, max = 200): string {
  const s = String(value).replace(CONTROL_RUN, ' ');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function emit(json: boolean, data: unknown, text: () => string): void {
  process.stdout.write(json ? JSON.stringify(data) + '\n' : text() + '\n');
}

/** A runnable search suggestion. The name is only echoed when it is a plain icon name, never raw user text. */
function searchHelp(id: string): string {
  const name = parseIconId(id)?.name ?? id;
  return `just-logo icons search ${/^[a-z0-9-]+$/.test(name) ? name : 'rocket'}`;
}

/** Parse one numeric flag; empty, NaN and non-finite values are usage errors. */
function parseNumber(
  value: string | undefined,
  name: string,
  example: string,
  opts: { positiveInteger?: boolean } = {},
): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(n))
    fail(`--${name} must be a number, got "${safe(value)}"`, example, 2);
  if (opts.positiveInteger && (!Number.isInteger(n) || n < 1)) {
    fail(
      `--${name} must be a whole number of 1 or more, got "${safe(value)}"`,
      example,
      2,
    );
  }
  return n;
}

/** Strict flag parsing for commands that take no options: any flag is a usage error. */
function parseBare(
  args: string[],
  allowPositionals: boolean,
  example: string,
): string[] {
  try {
    const { positionals } = parseArgs({
      args,
      options: {},
      allowPositionals,
      strict: true,
    });
    return positionals;
  } catch (error) {
    fail(safe((error as Error).message), example, 2);
  }
}

const RENDER_OPTIONS = {
  icon: { type: 'string' },
  preset: { type: 'string' },
  size: { type: 'string' },
  rotate: { type: 'string' },
  'stroke-color': { type: 'string' },
  'stroke-width': { type: 'string' },
  'stroke-opacity': { type: 'string' },
  'fill-color': { type: 'string' },
  'fill-opacity': { type: 'string' },
  background: { type: 'string' },
  margin: { type: 'string' },
  radius: { type: 'string' },
  'border-width': { type: 'string' },
  'border-color': { type: 'string' },
  'png-size': { type: 'string' },
  config: { type: 'string' },
  out: { type: 'string' },
  format: { type: 'string' },
} as const;

function readConfig(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const what =
      code === 'ENOENT'
        ? 'config file not found'
        : code === 'EISDIR'
          ? 'config path is a directory, not a file'
          : code === 'EACCES' || code === 'EPERM'
            ? 'config file is not readable (permission denied)'
            : `config file could not be read (${code ?? 'unknown error'})`;
    fail(
      `${what}: ${safe(file)}`,
      'just-logo schema  # write a config against this schema and pass its path to --config',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(
      `invalid config: ${safe(file)} is not valid JSON`,
      'just-logo schema',
      2,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(
      `invalid config: ${safe(file)} must contain a JSON object`,
      'just-logo schema',
      2,
    );
  }
  return parsed as Record<string, unknown>;
}

async function runRender(argv: string[], json: boolean): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: RENDER_OPTIONS,
    allowPositionals: false,
    strict: true,
  });
  // The = form is runnable for every value, negative numbers included.
  const ex = (flag: string, sample: string) =>
    `just-logo render --icon lucide:rocket --${flag}=${sample}`;

  // Everything that depends on the command line alone is checked first, so a
  // bad flag is exit 2 whatever the config file or the icon lookup would do.
  for (const flag of ['config', 'out'] as const) {
    if (values[flag] === '')
      fail(
        `--${flag} needs a path, got an empty value`,
        ex(flag, flag === 'config' ? 'logo.json' : 'logo.svg'),
        2,
      );
  }
  // Format comes from --format, else from the --out extension, else svg; the
  // default file name follows the format so `--format png` never lands in logo.svg.
  const explicitFormat = values.format;
  if (
    explicitFormat !== undefined &&
    explicitFormat !== 'svg' &&
    explicitFormat !== 'png'
  ) {
    fail(
      `--format must be svg or png, got "${safe(explicitFormat)}"`,
      ex('format', 'png'),
      2,
    );
  }
  const outFlag = values.out;
  const format: 'svg' | 'png' =
    (explicitFormat as 'svg' | 'png' | undefined) ??
    (outFlag !== undefined &&
    outFlag !== '-' &&
    outFlag.toLowerCase().endsWith('.png')
      ? 'png'
      : 'svg');
  const out = outFlag ?? `logo.${format}`;
  if (format === 'png' && out === '-') {
    fail(
      'PNG cannot be written to stdout; give --out a path',
      ex('out', 'logo.png'),
      2,
    );
  }

  const fromFlags: Record<string, unknown> = {
    icon: values.icon,
    preset: values.preset,
    size: parseNumber(values.size, 'size', ex('size', '160')),
    rotate: parseNumber(values.rotate, 'rotate', ex('rotate', '-15')),
    strokeColor: values['stroke-color'],
    strokeWidth: parseNumber(
      values['stroke-width'],
      'stroke-width',
      ex('stroke-width', '2'),
    ),
    strokeOpacity: parseNumber(
      values['stroke-opacity'],
      'stroke-opacity',
      ex('stroke-opacity', '100'),
    ),
    fillColor: values['fill-color'],
    fillOpacity: parseNumber(
      values['fill-opacity'],
      'fill-opacity',
      ex('fill-opacity', '0'),
    ),
    background: values.background,
    margin: parseNumber(values.margin, 'margin', ex('margin', '32')),
    radius: parseNumber(values.radius, 'radius', ex('radius', '64')),
    borderWidth: parseNumber(
      values['border-width'],
      'border-width',
      ex('border-width', '4'),
    ),
    borderColor: values['border-color'],
    pngSize: parseNumber(
      values['png-size'],
      'png-size',
      ex('png-size', '1024'),
    ),
  };
  for (const key of Object.keys(fromFlags))
    if (fromFlags[key] === undefined) delete fromFlags[key];

  // Validate each source before layering, so an unknown preset in the config
  // file or an out-of-range flag is reported against the right input. The
  // flags go first, before the config file is even read: a bad flag is exit 2
  // whether or not the config exists. The placeholder icon only stands in when
  // a source names none; a malformed icon is reported against its own source.
  const checkSource = (label: string, source: Record<string, unknown>) => {
    const errors = validateSpec({ icon: 'x:x', ...source });
    if (errors.length > 0) {
      const detail = errors
        .map((e) => `${e.path || 'spec'}: ${e.message}`)
        .join('; ');
      fail(`invalid ${label}: ${detail}`, 'just-logo schema', 2);
    }
  };
  checkSource('flags', fromFlags);
  const fromConfig =
    values.config !== undefined ? readConfig(values.config) : {};
  checkSource('config', fromConfig);
  const candidate = layerSpec(
    fromConfig as Partial<LogoSpec>,
    fromFlags as Partial<LogoSpec>,
  );
  if (candidate.icon === undefined) {
    fail(
      '--icon is required (or an "icon" in --config)',
      'just-logo icons search rocket',
      2,
    );
  }
  const errors = validateSpec(candidate);
  if (errors.length > 0) {
    const detail = errors
      .map((e) => `${e.path || 'spec'}: ${e.message}`)
      .join('; ');
    fail(`invalid spec: ${detail}`, 'just-logo schema', 2);
  }

  const spec: LogoSpec = resolveSpec(
    candidate as Partial<LogoSpec> & { icon: string },
  );
  const icon = findIcon(spec.icon);
  if (!icon) {
    fail(`icon not found: ${safe(spec.icon)}`, searchHelp(spec.icon));
  }

  const result = renderSvg(spec, icon);
  if (result.backgroundPassthrough) {
    process.stderr.write(
      `warning: background "${safe(spec.background)}" is not a colour or a convertible gradient; it was written as-is and may not render\n`,
    );
  }
  // One warning per approximation: a radial gradient under a see-through border gets both.
  for (const reason of result.approximations) {
    process.stderr.write(
      reason === 'radial-geometry'
        ? 'warning: radial gradient approximated: shape, size and position are ignored and negative stop positions are clamped; rendered centred\n'
        : 'warning: gradient approximated: the border colour is not opaque, and the gradient is not repeated under the border as CSS would\n',
    );
  }

  let bytes: Uint8Array;
  if (format === 'png') {
    try {
      bytes = await renderPng(result.svg, spec.pngSize);
    } catch (error) {
      fail(
        `PNG rasteriser unavailable: ${safe((error as Error).message, 300)}`,
        'run pnpm install in the just-logo checkout, or use --format svg',
      );
    }
  } else {
    bytes = new TextEncoder().encode(result.svg);
  }

  const size = format === 'png' ? spec.pngSize : 512;
  const written = out !== '-';
  if (written) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, bytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const why =
        code === 'EISDIR'
          ? 'it is a directory'
          : code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
            ? 'permission denied'
            : code === 'ENOTDIR' || code === 'EEXIST'
              ? 'part of the path is a file, not a directory'
              : (code ?? 'unknown error');
      // spec.icon passed validation, so it is safe to echo into a runnable line.
      fail(
        `could not write ${safe(out)}: ${why}`,
        `just-logo render --icon ${spec.icon} --out=logo.${format}  # a writable path; --out=- prints SVG to stdout`,
      );
    }
  }
  // One shape for both destinations, so agents parse a single contract.
  const summary = {
    format,
    out: written ? path.resolve(out) : '-',
    bytes: bytes.byteLength,
    width: size,
    height: size,
    spec,
    backgroundPassthrough: result.backgroundPassthrough,
    backgroundApproximated: result.backgroundApproximated,
    backgroundApproximations: result.approximations,
    svg: result.svg,
  };
  if (!written) {
    if (json) emit(true, summary, () => '');
    else process.stdout.write(result.svg + '\n');
    return;
  }
  emit(
    json,
    summary,
    () =>
      `wrote ${summary.out} (${format}, ${size}x${size}, ${summary.bytes} bytes)`,
  );
}

/** The documented shape for `presets --json`, independent of the editor's internal type. */
function presetRows() {
  return PRESETS.map((p) => ({
    name: p.name,
    strokeColor: p.icon.strokeColor,
    strokeOpacity: p.icon.strokeOpacity,
    fillColor: p.icon.fillColor,
    background: p.background.background,
    borderColor: p.background.borderColor,
  }));
}

async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json');
  if (json) argv = argv.filter((a) => a !== '--json');

  const [command, ...rest] = argv;
  if (
    !command ||
    command === '--help' ||
    command === '-h' ||
    command === 'help'
  ) {
    if (json) emit(true, { usage: USAGE }, () => '');
    else process.stdout.write(USAGE + '\n');
    return;
  }

  switch (command) {
    case 'icons': {
      const [sub, ...args] = rest;
      if (sub === 'sets') {
        parseBare(args, false, 'just-logo icons sets');
        const sets = iconSets();
        emit(json, sets, () => sets.join('\n'));
        return;
      }
      if (sub === 'search') {
        const { values, positionals } = parseArgs({
          args,
          options: { set: { type: 'string' }, limit: { type: 'string' } },
          allowPositionals: true,
          strict: true,
        });
        const query = positionals.join(' ').trim();
        if (!query)
          fail(
            'icons search needs a query',
            'just-logo icons search rocket',
            2,
          );
        if (values.set !== undefined && !iconSets().includes(values.set)) {
          fail(`unknown set: ${safe(values.set)}`, 'just-logo icons sets', 2);
        }
        const limit =
          parseNumber(
            values.limit,
            'limit',
            'just-logo icons search rocket --limit 5',
            { positiveInteger: true },
          ) ?? 20;
        const hits = searchIcons(query, { set: values.set, limit });
        emit(json, hits, () =>
          hits.length ? hits.map((h) => h.id).join('\n') : '(no matches)',
        );
        return;
      }
      if (sub === 'show') {
        const [id, ...extra] = parseBare(
          args,
          true,
          'just-logo icons show lucide:rocket',
        );
        if (extra.length > 0)
          fail(
            `icons show takes one id, got ${extra.length + 1}`,
            'just-logo icons show lucide:rocket',
            2,
          );
        if (!id)
          fail(
            'icons show needs a <set:name> id',
            'just-logo icons show lucide:rocket',
            2,
          );
        const icon = findIcon(id);
        if (!icon) fail(`icon not found: ${safe(id)}`, searchHelp(id));
        const svg = bareIconSvg(icon);
        emit(
          json,
          { id, set: icon.set, name: icon.name, body: icon.body, svg },
          () => `${icon.set}:${icon.name}\nbody: ${icon.body}\nsvg: ${svg}`,
        );
        return;
      }
      fail(
        `unknown icons subcommand: ${safe(sub ?? '(none)')}`,
        'just-logo icons search rocket',
        2,
      );
    }
    // falls through only via fail()
    case 'presets': {
      parseBare(rest, false, 'just-logo presets');
      const rows = presetRows();
      emit(json, rows, () =>
        rows
          .map(
            (p) =>
              `${p.name}\n  stroke ${p.strokeColor}  fill ${p.fillColor}  background ${p.background}  border ${p.borderColor}`,
          )
          .join('\n'),
      );
      return;
    }
    case 'schema': {
      parseBare(rest, false, 'just-logo schema');
      const schema = specSchema();
      emit(json, schema, () => JSON.stringify(schema, null, 2));
      return;
    }
    case 'render':
      await runRender(rest, json);
      return;
    default:
      fail(`unknown command: ${safe(command)}`, 'just-logo --help', 2);
  }
}

const wantsJson = process.argv.includes('--json');
main(process.argv.slice(2)).catch((error: unknown) => {
  const isCli = error instanceof CliError;
  const message = safe(
    isCli ? error.message : ((error as Error).message ?? String(error)),
    400,
  );
  const ambiguous = !isCli && /argument is ambiguous/.test(message);
  const help = isCli
    ? error.help
    : ambiguous
      ? process.argv[2] === 'render'
        ? 'just-logo render --icon lucide:rocket --rotate=-15  # negative values need the = form'
        : 'just-logo icons search rocket --limit=5  # --limit must be a whole number of 1 or more'
      : 'just-logo --help';
  const code = isCli ? error.code : 1;
  // Node's parseArgs errors carry a stable code; the wording is secondary.
  const nodeCode = (error as NodeJS.ErrnoException).code ?? '';
  const usageError =
    !isCli &&
    (nodeCode.startsWith('ERR_PARSE_ARGS') ||
      /Unknown option|Option .* argument|Unexpected argument/.test(message));
  const exit = usageError ? 2 : code;
  if (wantsJson)
    process.stdout.write(JSON.stringify({ error: message, help, exit }) + '\n');
  process.stderr.write(`error: ${message}\nhelp: ${help}\n`);
  process.exit(exit);
});
