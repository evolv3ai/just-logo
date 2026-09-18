import { describe, expect, it } from 'vitest';

import { PRESETS } from '@/lib/constants';
import {
  DEFAULT_SPEC,
  NUMBER_RULES,
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

  it('rejects non-objects', () => {
    expect(validateSpec([])).toHaveLength(1);
    expect(validateSpec('x')).toHaveLength(1);
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
