#!/usr/bin/env tsx
/**
 * just-logo CLI: the web editor's icon search, presets and export, without a
 * browser. Every command takes --json (exactly one JSON value on stdout).
 * Exit codes: 0 ok, 1 operational error, 2 usage error.
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
  render [flags] [--config file]     render a logo (--out path, default logo.svg; --out - for stdout)

Render flags: --icon <set:name> --preset <name> --size --rotate --stroke-color --stroke-width
  --stroke-opacity --fill-color --fill-opacity --background --margin --radius --border-width
  --border-color --png-size --format svg|png

Negative values need the = form: --rotate=-15
Every command accepts --json. Exit codes: 0 ok, 1 error, 2 usage.`;

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

function emit(json: boolean, data: unknown, text: () => string): void {
  process.stdout.write(json ? JSON.stringify(data) + '\n' : text() + '\n');
}

function optionalNumber(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n))
    fail(
      `--${name} must be a number, got "${value}"`,
      `just-logo render --${name} 1`,
      2,
    );
  return n;
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

async function runRender(argv: string[], json: boolean): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: RENDER_OPTIONS,
    allowPositionals: false,
    strict: true,
  });

  let fromConfig: Record<string, unknown> = {};
  if (values.config) {
    let raw: string;
    try {
      raw = fs.readFileSync(values.config, 'utf8');
    } catch {
      fail(
        `config file not found: ${values.config}`,
        `just-logo schema > spec.schema.json  # then write ${values.config} against it`,
      );
    }
    try {
      fromConfig = JSON.parse(raw);
    } catch {
      fail(
        `config file is not valid JSON: ${values.config}`,
        `just-logo schema`,
      );
    }
    if (
      typeof fromConfig !== 'object' ||
      fromConfig === null ||
      Array.isArray(fromConfig)
    ) {
      fail(
        `invalid config: ${values.config} must contain a JSON object`,
        'just-logo schema',
        2,
      );
    }
  }

  const fromFlags: Record<string, unknown> = {
    icon: values.icon,
    preset: values.preset,
    size: optionalNumber(values.size, 'size'),
    rotate: optionalNumber(values.rotate, 'rotate'),
    strokeColor: values['stroke-color'],
    strokeWidth: optionalNumber(values['stroke-width'], 'stroke-width'),
    strokeOpacity: optionalNumber(values['stroke-opacity'], 'stroke-opacity'),
    fillColor: values['fill-color'],
    fillOpacity: optionalNumber(values['fill-opacity'], 'fill-opacity'),
    background: values.background,
    margin: optionalNumber(values.margin, 'margin'),
    radius: optionalNumber(values.radius, 'radius'),
    borderWidth: optionalNumber(values['border-width'], 'border-width'),
    borderColor: values['border-color'],
    pngSize: optionalNumber(values['png-size'], 'png-size'),
  };
  for (const key of Object.keys(fromFlags))
    if (fromFlags[key] === undefined) delete fromFlags[key];

  // Validate each source before layering, so an unknown preset in the config
  // file or an out-of-range flag is reported against the right input.
  for (const [label, source] of [
    ['config', fromConfig],
    ['flags', fromFlags],
  ] as const) {
    const errors = validateSpec({ icon: 'x:x', ...source }).filter(
      (e) => e.path !== 'icon',
    );
    if (errors.length > 0) {
      const detail = errors
        .map((e) => `${e.path || 'spec'}: ${e.message}`)
        .join('; ');
      fail(`invalid ${label}: ${detail}`, 'just-logo schema', 2);
    }
  }
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
    const parsed = parseIconId(spec.icon);
    fail(
      `icon not found: ${spec.icon}`,
      `just-logo icons search ${parsed?.name ?? spec.icon}`,
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
      `--format must be svg or png, got "${explicitFormat}"`,
      'just-logo render --icon lucide:rocket --format png',
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

  const result = renderSvg(spec, icon);
  if (result.backgroundPassthrough) {
    process.stderr.write(
      `warning: background "${spec.background}" is not a colour or a convertible gradient; it was written as-is and may not render\n`,
    );
  } else if (result.backgroundApproximated) {
    process.stderr.write(
      `warning: radial gradient shape/position was ignored; rendered centred with the default radius\n`,
    );
  }
  let bytes: Uint8Array;
  if (format === 'png') {
    if (out === '-')
      fail(
        'PNG cannot be written to stdout; give --out a path',
        'just-logo render --icon lucide:rocket --out logo.png',
        2,
      );
    bytes = await renderPng(result.svg, spec.pngSize);
  } else {
    bytes = new TextEncoder().encode(result.svg);
  }

  if (out === '-') {
    if (json) {
      emit(
        true,
        {
          format,
          out: '-',
          spec,
          backgroundPassthrough: result.backgroundPassthrough,
          backgroundApproximated: result.backgroundApproximated,
          svg: result.svg,
        },
        () => '',
      );
    } else {
      process.stdout.write(result.svg + '\n');
    }
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, bytes);
  const summary = {
    format,
    out: path.resolve(out),
    bytes: bytes.byteLength,
    width: format === 'png' ? spec.pngSize : 512,
    height: format === 'png' ? spec.pngSize : 512,
    spec,
    backgroundPassthrough: result.backgroundPassthrough,
    backgroundApproximated: result.backgroundApproximated,
  };
  emit(
    json,
    summary,
    () =>
      `wrote ${summary.out} (${format}, ${summary.width}x${summary.height}, ${summary.bytes} bytes)`,
  );
}

async function main(argv: string[]): Promise<void> {
  const jsonIndex = argv.indexOf('--json');
  const json = jsonIndex !== -1;
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
        if (values.set && !iconSets().includes(values.set)) {
          fail(`unknown set: ${values.set}`, 'just-logo icons sets', 2);
        }
        const limit = optionalNumber(values.limit, 'limit') ?? 20;
        const hits = searchIcons(query, { set: values.set, limit });
        emit(json, hits, () =>
          hits.length ? hits.map((h) => h.id).join('\n') : '(no matches)',
        );
        return;
      }
      if (sub === 'show') {
        const id = args[0];
        if (!id)
          fail(
            'icons show needs a <set:name> id',
            'just-logo icons show lucide:rocket',
            2,
          );
        const icon = findIcon(id);
        if (!icon)
          fail(
            `icon not found: ${id}`,
            `just-logo icons search ${parseIconId(id)?.name ?? id}`,
          );
        const svg = bareIconSvg(icon);
        emit(
          json,
          { id, set: icon.set, name: icon.name, body: icon.body, svg },
          () => svg,
        );
        return;
      }
      fail(
        `unknown icons subcommand: ${sub ?? '(none)'}`,
        'just-logo icons search rocket',
        2,
      );
    }
    // falls through only via fail()
    case 'presets': {
      emit(json, PRESETS, () =>
        PRESETS.map(
          (p) =>
            `${p.name}\n  stroke ${p.icon.strokeColor}  fill ${p.icon.fillColor}  background ${p.background.background}  border ${p.background.borderColor}`,
        ).join('\n'),
      );
      return;
    }
    case 'schema': {
      const schema = specSchema();
      emit(json, schema, () => JSON.stringify(schema, null, 2));
      return;
    }
    case 'render':
      await runRender(rest, json);
      return;
    default:
      fail(`unknown command: ${command}`, 'just-logo --help', 2);
  }
}

const wantsJson = process.argv.includes('--json');
main(process.argv.slice(2)).catch((error: unknown) => {
  const isCli = error instanceof CliError;
  const message = isCli
    ? error.message
    : ((error as Error).message ?? String(error));
  const ambiguous = !isCli && /argument is ambiguous/.test(message);
  const help = isCli
    ? error.help
    : ambiguous
      ? 'negative values need the = form, e.g. just-logo render --icon lucide:rocket --rotate=-15'
      : 'just-logo --help';
  const code = isCli ? error.code : 1;
  const usageError =
    !isCli &&
    /Unknown option|Option .* argument|Unexpected argument/.test(message);
  const exit = usageError ? 2 : code;
  if (wantsJson)
    process.stdout.write(JSON.stringify({ error: message, help, exit }) + '\n');
  process.stderr.write(`error: ${message}\nhelp: ${help}\n`);
  process.exit(exit);
});
