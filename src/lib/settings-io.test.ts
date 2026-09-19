import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { validateSpec as cliValidateSpec } from '../../cli/spec';
import { DEFAULT_SPEC, resolveSpec, validateSpec } from '@/lib/logo-spec';
import type { LogoSpec } from '@/lib/logo-spec';
import {
  MAX_SETTINGS_BYTES,
  editorToSpec,
  importSettingsFile,
  parseSettings,
  serializeSettings,
  specToEditor,
} from '@/lib/settings-io';
import type { BackgroundSettings, IconItem, IconSettings } from '@/types';

const rocket: IconItem = {
  name: 'rocket',
  set: 'lucide',
  body: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5"/>',
};
const heart: IconItem = {
  name: 'heart',
  set: 'tabler',
  body: '<path d="M19.5 12.572l-7.5 7.428"/>',
};
const icons = [rocket, heart];

const iconSettings: IconSettings = {
  icon: rocket,
  size: 200,
  rotate: -15,
  strokeColor: '#112233',
  strokeWidth: 1.5,
  strokeOpacity: 80,
  fillColor: '#445566',
  fillOpacity: 25,
};
const backgroundSettings: BackgroundSettings = {
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  margin: 12,
  borderRadius: 48,
  borderWidth: 6,
  borderColor: '#778899',
};
const expectedSpec = {
  icon: 'lucide:rocket',
  size: 200,
  rotate: -15,
  strokeColor: '#112233',
  strokeWidth: 1.5,
  strokeOpacity: 80,
  fillColor: '#445566',
  fillOpacity: 25,
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  margin: 12,
  radius: 48,
  borderWidth: 6,
  borderColor: '#778899',
};

function exported() {
  const result = editorToSpec(iconSettings, backgroundSettings);
  if (!result.ok) throw new Error(result.message);
  return result.spec;
}

function failure(result: { ok: boolean; message?: string }) {
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty('iconSettings');
  expect(result).not.toHaveProperty('backgroundSettings');
  return (result as { message: string }).message;
}

describe('editorToSpec', () => {
  it('maps the editor state onto the spec field for field', () => {
    expect(exported()).toEqual(expectedSpec);
  });

  it('writes the stored values in a file the validator accepts', () => {
    const text = serializeSettings(exported());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "icon": "lucide:rocket"');
    expect(JSON.parse(text)).toEqual(expectedSpec);
    expect(validateSpec(JSON.parse(text))).toEqual([]);
  });

  it('refuses when no icon is chosen', () => {
    const result = editorToSpec(
      { ...iconSettings, icon: null },
      backgroundSettings,
    );
    expect(result).toEqual({
      ok: false,
      message: 'pick an icon before exporting settings',
    });
  });

  it('refuses a state the validator rejects, with its message', () => {
    const result = editorToSpec(
      { ...iconSettings, size: 9999 },
      backgroundSettings,
    );
    expect(result).toEqual({
      ok: false,
      message: 'invalid settings: size: must be between 0 and 512',
    });
  });
});

describe('editorToSpec with a stored state that lacks fields', () => {
  it('refuses rather than let the CLI fill the gap with its defaults', () => {
    const { fillOpacity: _n, strokeColor: _s, ...partialIcon } = iconSettings;
    const { borderRadius: _r, ...partialBackground } = backgroundSettings;
    const result = editorToSpec(
      partialIcon as IconSettings,
      partialBackground as BackgroundSettings,
    );
    expect(result).toEqual({
      ok: false,
      message:
        'invalid settings: strokeColor: missing; fillOpacity: missing; radius: missing',
    });
  });
});

describe('specToEditor', () => {
  it('maps a full spec onto the editor state', () => {
    const spec: LogoSpec = { ...expectedSpec, pngSize: 1024 };
    expect(specToEditor(spec, icons)).toEqual({
      ok: true,
      iconSettings,
      backgroundSettings,
    });
  });

  it('refuses an icon that is not in the list, naming it', () => {
    const spec: LogoSpec = {
      ...expectedSpec,
      icon: 'lucide:no-such-icon',
      pngSize: 512,
    };
    expect(failure(specToEditor(spec, icons))).toBe(
      'icon not found: lucide:no-such-icon',
    );
  });

  it('matches set and name together, not either alone', () => {
    const spec: LogoSpec = {
      ...expectedSpec,
      icon: 'tabler:rocket',
      pngSize: 512,
    };
    expect(failure(specToEditor(spec, icons))).toBe(
      'icon not found: tabler:rocket',
    );
  });
});

describe('parseSettings', () => {
  it('imports a full spec file, dropping pngSize', () => {
    const text = JSON.stringify({
      ...expectedSpec,
      icon: 'tabler:heart',
      pngSize: 2048,
    });
    const result = parseSettings(text, icons);
    expect(result).toEqual({
      ok: true,
      iconSettings: { ...iconSettings, icon: heart },
      backgroundSettings,
    });
    if (!result.ok) return;
    const keys = [
      ...Object.keys(result.iconSettings),
      ...Object.keys(result.backgroundSettings),
    ];
    expect(keys).not.toContain('pngSize');
    expect(keys).not.toContain('preset');
    expect(keys).not.toContain('radius');
  });

  it('round-trips the editor state through a file', () => {
    expect(parseSettings(serializeSettings(exported()), icons)).toEqual({
      ok: true,
      iconSettings,
      backgroundSettings,
    });
  });

  it('round-trips a spec through the editor state', () => {
    const result = parseSettings(
      JSON.stringify({ ...expectedSpec, pngSize: 256 }),
      icons,
    );
    if (!result.ok) throw new Error(result.message);
    expect(
      editorToSpec(result.iconSettings, result.backgroundSettings),
    ).toEqual({ ok: true, spec: expectedSpec });
  });

  it('applies a preset and the defaults the way the CLI does', () => {
    const file = { icon: 'lucide:rocket', preset: 'Ocean Breeze' };
    const resolved = resolveSpec(file);
    expect(resolved.background).not.toBe(DEFAULT_SPEC.background);
    expect(parseSettings(JSON.stringify(file), icons)).toEqual({
      ok: true,
      iconSettings: {
        icon: rocket,
        size: resolved.size,
        rotate: resolved.rotate,
        strokeColor: resolved.strokeColor,
        strokeWidth: resolved.strokeWidth,
        strokeOpacity: resolved.strokeOpacity,
        fillColor: resolved.fillColor,
        fillOpacity: resolved.fillOpacity,
      },
      backgroundSettings: {
        background: resolved.background,
        margin: resolved.margin,
        borderRadius: resolved.radius,
        borderWidth: resolved.borderWidth,
        borderColor: resolved.borderColor,
      },
    });
  });

  it('lets an explicit colour beat the preset', () => {
    const result = parseSettings(
      JSON.stringify({
        icon: 'lucide:rocket',
        preset: 'Ocean Breeze',
        strokeColor: '#abcdef',
      }),
      icons,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.iconSettings.strokeColor).toBe('#abcdef');
    expect(result.backgroundSettings.background).toBe(
      resolveSpec({ icon: 'lucide:rocket', preset: 'Ocean Breeze' }).background,
    );
  });

  it('fills a file with only an icon from the CLI defaults', () => {
    const result = parseSettings('{"icon":"lucide:rocket"}', icons);
    if (!result.ok) throw new Error(result.message);
    expect(result.iconSettings.strokeColor).toBe(DEFAULT_SPEC.strokeColor);
    expect(result.iconSettings.size).toBe(DEFAULT_SPEC.size);
    expect(result.backgroundSettings.background).toBe(DEFAULT_SPEC.background);
    expect(result.backgroundSettings.borderRadius).toBe(DEFAULT_SPEC.radius);
  });

  it('refuses text that is not JSON', () => {
    expect(failure(parseSettings('<svg></svg>', icons))).toBe(
      'not a JSON file',
    );
    expect(failure(parseSettings('', icons))).toBe('not a JSON file');
  });

  it.each([
    ['an array', '[]', 'invalid settings: spec must be a JSON object'],
    ['null', 'null', 'invalid settings: spec must be a JSON object'],
    [
      'an unknown property',
      '{"icon":"lucide:rocket","borderRadius":4}',
      'invalid settings: borderRadius: unknown property',
    ],
    [
      'an out-of-range number',
      '{"icon":"lucide:rocket","rotate":500}',
      'invalid settings: rotate: must be between -180 and 180',
    ],
    [
      'a bad icon format',
      '{"icon":"rocket"}',
      'invalid settings: icon: required, format <set>:<name>',
    ],
    [
      'a missing icon',
      '{"size":100}',
      'invalid settings: icon: required, format <set>:<name>',
    ],
  ])('refuses %s with the validator message', (_, text, message) => {
    expect(failure(parseSettings(text, icons))).toBe(message);
  });

  it('reports every validator error, in the validator order', () => {
    const candidate = { icon: 'lucide:rocket', size: -1, margin: 'wide' };
    const expected = validateSpec(candidate)
      .map((e) => `${e.path}: ${e.message}`)
      .join('; ');
    expect(expected).toContain('; ');
    expect(failure(parseSettings(JSON.stringify(candidate), icons))).toBe(
      `invalid settings: ${expected}`,
    );
  });

  it('refuses an unknown preset', () => {
    expect(
      failure(parseSettings('{"icon":"lucide:rocket","preset":"Nope"}', icons)),
    ).toMatch(/^invalid settings: preset: unknown preset; one of: /);
  });

  it('refuses a well-formed icon id that is not in the list', () => {
    expect(
      failure(parseSettings('{"icon":"lucide:no-such-icon"}', icons)),
    ).toBe('icon not found: lucide:no-such-icon');
  });
});

describe('importSettingsFile', () => {
  const ready = { status: 'ready', icons } as const;
  const text = serializeSettings(exported());
  function fileOf(content: string, size = content.length) {
    let reads = 0;
    return {
      file: {
        size,
        text: () => {
          reads += 1;
          return Promise.resolve(content);
        },
      },
      reads: () => reads,
    };
  }

  it('imports a readable file of an allowed size', async () => {
    const { file, reads } = fileOf(text);
    expect(await importSettingsFile(file, ready)).toEqual({
      ok: true,
      iconSettings,
      backgroundSettings,
    });
    expect(reads()).toBe(1);
  });

  it('accepts a file of exactly the limit and refuses one byte more, unread', async () => {
    expect(MAX_SETTINGS_BYTES).toBe(65536);
    const atLimit = fileOf(text, MAX_SETTINGS_BYTES);
    expect((await importSettingsFile(atLimit.file, ready)).ok).toBe(true);

    const over = fileOf(text, MAX_SETTINGS_BYTES + 1);
    expect(failure(await importSettingsFile(over.file, ready))).toBe(
      'the file is too large',
    );
    expect(over.reads()).toBe(0);
  });

  it('refuses while the icon list is loading, without reading the file', async () => {
    const { file, reads } = fileOf(text);
    expect(failure(await importSettingsFile(file, { status: 'pending' }))).toBe(
      'the icon list is still loading, try again in a moment',
    );
    expect(reads()).toBe(0);
  });

  it('says so when the icon list failed to load, which waiting will not fix', async () => {
    const { file, reads } = fileOf(text);
    expect(failure(await importSettingsFile(file, { status: 'error' }))).toBe(
      'the icon list failed to load, reload the page',
    );
    expect(reads()).toBe(0);
  });

  it('refuses a file that cannot be read', async () => {
    const file = {
      size: 10,
      text: () => Promise.reject(new Error('NotReadableError')),
    };
    expect(failure(await importSettingsFile(file, ready))).toBe(
      'the file could not be read',
    );
  });

  it('passes a parse refusal through with no settings', async () => {
    const { file } = fileOf('{"icon":"lucide:rocket","rotate":500}');
    expect(failure(await importSettingsFile(file, ready))).toBe(
      'invalid settings: rotate: must be between -180 and 180',
    );
  });
});

describe('shared contract', () => {
  it('has one validator, whichever path imports it', () => {
    expect(cliValidateSpec).toBe(validateSpec);
  });
});

describe('exported file through the CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'just-logo-settings-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is accepted unchanged by render --config', () => {
    // a real icon, so the CLI's own icon lookup succeeds
    const result = editorToSpec(iconSettings, backgroundSettings);
    if (!result.ok) throw new Error(result.message);
    const file = join(dir, 'logo.json');
    writeFileSync(file, serializeSettings(result.spec));

    const root = resolve(__dirname, '../..');
    const run = spawnSync(
      process.execPath,
      [
        join(root, 'cli/bin.mjs'),
        'render',
        '--config',
        file,
        '--out',
        '-',
        '--json',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(run.status).toBe(0);
    const report = JSON.parse(run.stdout);
    expect(report.spec).toEqual({ ...expectedSpec, pngSize: 512 });
  });
});
