import { describe, expect, it } from 'vitest';

import { PRESETS } from '@/lib/constants';
import {
  DEFAULT_SPEC,
  NUMBER_RULES,
  layerSpec,
  resolveSpec,
  specSchema,
  validateSpec,
} from './spec';

describe('spec schema (AC8)', () => {
  it('is a JSON schema whose properties cover every spec field', () => {
    const schema = specSchema();
    expect(schema.$schema).toContain('json-schema.org');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['icon']);
    const props = Object.keys(schema.properties);
    for (const key of Object.keys(DEFAULT_SPEC)) expect(props).toContain(key);
    expect(props).toContain('icon');
    expect(props).toContain('preset');
    expect(schema.properties.preset.enum).toEqual(PRESETS.map((p) => p.name));
  });

  it('validates the defaults against the schema itself, and the schema agrees with the validator', () => {
    // a small JSON-schema checker covering the keywords this schema uses
    type Prop = {
      type: string;
      minimum?: number;
      maximum?: number;
      enum?: string[];
      pattern?: string;
      minLength?: number;
      maxLength?: number;
    };
    const schema = specSchema() as unknown as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, Prop>;
    };
    const check = (value: Record<string, unknown>): string[] => {
      const errs: string[] = [];
      for (const r of schema.required)
        if (!(r in value)) errs.push(`${r}: required`);
      for (const [k, v] of Object.entries(value)) {
        const p = schema.properties[k];
        if (!p) {
          if (!schema.additionalProperties) errs.push(`${k}: additional`);
          continue;
        }
        if (p.type === 'string') {
          if (typeof v !== 'string') errs.push(`${k}: type`);
          else {
            if (p.minLength !== undefined && v.length < p.minLength)
              errs.push(`${k}: minLength`);
            if (p.maxLength !== undefined && v.length > p.maxLength)
              errs.push(`${k}: maxLength`);
            if (p.pattern && !new RegExp(p.pattern).test(v))
              errs.push(`${k}: pattern`);
            if (p.enum && !p.enum.includes(v)) errs.push(`${k}: enum`);
          }
        } else {
          if (typeof v !== 'number') errs.push(`${k}: type`);
          else {
            if (p.type === 'integer' && !Number.isInteger(v))
              errs.push(`${k}: integer`);
            if (p.minimum !== undefined && v < p.minimum)
              errs.push(`${k}: minimum`);
            if (p.maximum !== undefined && v > p.maximum)
              errs.push(`${k}: maximum`);
          }
        }
      }
      return errs;
    };
    expect(check({ icon: 'lucide:rocket', ...DEFAULT_SPEC })).toEqual([]);
    const samples: Record<string, unknown>[] = [
      { icon: 'lucide:rocket' },
      { icon: 'lucide:rocket', preset: 'Sunset', size: 12.5 },
      { icon: 'rocket' },
      { icon: 'lucide:rocket', strokeColor: '' },
      { icon: 'lucide:rocket', background: 'x'.repeat(600) },
      { icon: 'lucide:rocket', pngSize: 100.5 },
      { icon: 'lucide:rocket', size: 9999 },
      { icon: 'lucide:rocket', preset: 'Nope' },
      { icon: 'lucide:rocket', bogus: 1 },
      { icon: 'lucide:rocket', rotate: -180 },
      { icon: 'lucide:rocket', background: 'red\u001b]0;x\u0007' },
      { icon: 'lucide:rocket', strokeColor: 'a\nb' },
      { icon: 'lucide:rocket', fillColor: 'a\u0085b' },
      { icon: 'lucide:rocket', borderColor: 'a\u2028b' },
      { icon: 'lucide:rocket', borderColor: 'caf\u00e9 \u00a0' },
    ];
    for (const sample of samples) {
      expect(check(sample).length === 0, JSON.stringify(sample)).toBe(
        validateSpec(sample).length === 0,
      );
    }
  });

  it('accepts the defaults plus an icon', () => {
    expect(validateSpec({ icon: 'lucide:rocket', ...DEFAULT_SPEC })).toEqual(
      [],
    );
  });

  it('accepts every preset by name', () => {
    for (const preset of PRESETS) {
      expect(
        validateSpec({ icon: 'lucide:rocket', preset: preset.name }),
      ).toEqual([]);
    }
  });

  it('rejects out-of-range numbers, unknown keys, bad icon ids and unknown presets', () => {
    const errors = validateSpec({
      icon: 'rocket',
      size: NUMBER_RULES.size.max + 1,
      pngSize: 100.5,
      preset: 'Nope',
      bogus: 1,
    });
    const paths = errors.map((e) => e.path).sort();
    expect(paths).toEqual(['bogus', 'icon', 'pngSize', 'preset', 'size']);
  });

  it('rejects control characters in every free-text field, and nothing else', () => {
    for (const key of [
      'strokeColor',
      'fillColor',
      'background',
      'borderColor',
    ] as const) {
      for (const bad of [
        '\u0000',
        '\u001b[31m',
        '\n',
        '\u007f',
        '\u0085',
        '\u009f',
        '\u2028',
        '\u2029',
      ]) {
        expect(
          validateSpec({ icon: 'lucide:rocket', [key]: `#fff${bad}` }),
          `${key} ${JSON.stringify(bad)}`,
        ).toEqual([
          { path: key, message: 'must not contain control characters' },
        ]);
      }
      // printable text either side of the ranges is fine: space, ~, NBSP, accents
      expect(
        validateSpec({ icon: 'lucide:rocket', [key]: ' ~\u00a0\u00e9' }),
      ).toEqual([]);
    }
  });

  it('rejects non-objects', () => {
    expect(validateSpec([])).toHaveLength(1);
    expect(validateSpec('x')).toHaveLength(1);
  });
});

describe('layerSpec', () => {
  it('orders defaults < config preset < config values < flag preset < flag values', () => {
    const layered = layerSpec(
      {
        icon: 'lucide:star',
        preset: 'Dark Mode',
        strokeColor: '#111',
        size: 50,
      },
      { preset: 'Sunset', fillColor: '#222' },
    );
    expect(layered.preset).toBe('Sunset');
    expect(layered.strokeColor).toBe('#ffffff'); // Sunset beats the config colour
    expect(layered.fillColor).toBe('#222'); // flag value beats Sunset
    expect(layered.background).toContain('#ff6b6b'); // from Sunset
    expect(layered.size).toBe(50); // config value survives
    const full = resolveSpec(layered as Parameters<typeof resolveSpec>[0]);
    expect(full.rotate).toBe(DEFAULT_SPEC.rotate);
  });

  it('keeps the config preset when the flags name none', () => {
    const layered = layerSpec(
      { icon: 'lucide:star', preset: 'Dark Mode' },
      { size: 10 },
    );
    expect(layered.preset).toBe('Dark Mode');
    expect(layered.background).toBe('#000000');
  });
});

describe('resolveSpec', () => {
  it('layers defaults, then preset, then explicit values', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      preset: 'Dark Mode',
      fillColor: '#123',
    });
    expect(spec.strokeColor).toBe('#ffffff'); // from preset
    expect(spec.background).toBe('#000000'); // from preset
    expect(spec.fillColor).toBe('#123'); // explicit wins
    expect(spec.size).toBe(DEFAULT_SPEC.size); // default
  });

  it('ignores undefined explicit values', () => {
    const spec = resolveSpec({ icon: 'lucide:rocket', size: undefined });
    expect(spec.size).toBe(DEFAULT_SPEC.size);
  });
});
