import { AVAILABLE_ICON_SETS, PRESETS } from '@/lib/constants';

/**
 * A complete description of one logo, mirroring the editor's icon and
 * background settings one to one. This is what `render` consumes, what
 * `--config` files contain, and what `schema` describes.
 */
export type LogoSpec = {
  /** Icon id as `<set>:<name>`, e.g. `lucide:rocket`. */
  icon: string;
  /** Optional preset name; applied before explicit colours. */
  preset?: string;
  size: number;
  rotate: number;
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  fillColor: string;
  fillOpacity: number;
  /** CSS colour, `linear-gradient(...)` or `radial-gradient(...)`, exactly as the editor stores it. */
  background: string;
  margin: number;
  radius: number;
  borderWidth: number;
  borderColor: string;
  /** Output edge length in pixels for PNG output. */
  pngSize: number;
};

/**
 * The editor's initial state (see editor-provider.tsx). The editor's defaults
 * follow its theme and it opens in the dark theme, so a first-run user sees a
 * white icon on black; the CLI has no theme and uses those dark-theme values.
 */
export const DEFAULT_SPEC: Omit<LogoSpec, 'icon'> = {
  size: 128,
  rotate: 0,
  strokeColor: '#fff',
  strokeWidth: 2,
  strokeOpacity: 100,
  fillColor: '#000',
  fillOpacity: 0,
  background: '#000000',
  margin: 0,
  radius: 0,
  borderWidth: 0,
  borderColor: '#fff',
  pngSize: 512,
};

/** The editor's export zone is a fixed 512x512 square. */
export const CANVAS = 512;

type NumberRule = { min: number; max: number; integer?: boolean };

/** Slider ranges from the editor's settings panels. */
export const NUMBER_RULES: Record<
  | 'size'
  | 'rotate'
  | 'strokeWidth'
  | 'strokeOpacity'
  | 'fillOpacity'
  | 'margin'
  | 'radius'
  | 'borderWidth'
  | 'pngSize',
  NumberRule
> = {
  size: { min: 0, max: 512 },
  rotate: { min: -180, max: 180 },
  strokeWidth: { min: 0, max: 4 },
  strokeOpacity: { min: 0, max: 100 },
  fillOpacity: { min: 0, max: 100 },
  margin: { min: 0, max: 256 },
  radius: { min: 0, max: 256 },
  borderWidth: { min: 0, max: 128 },
  pngSize: { min: 16, max: 4096, integer: true },
};

/** Every string value is bounded, so a hostile config cannot feed unbounded text to the parsers. */
export const MAX_STRING = 512;

/**
 * C0 and C1 control characters plus the Unicode line separators. A colour
 * never needs them, a terminal acts on them (ESC starts an escape sequence),
 * and most of them make an XML document ill-formed, so specs may not contain them.
 */
export const CONTROL_CHARACTERS =
  '\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029';
const HAS_CONTROL = new RegExp(`[${CONTROL_CHARACTERS}]`);
const NO_CONTROL_PATTERN = `^[^${CONTROL_CHARACTERS}]*$`;

const STRING_KEYS = [
  'icon',
  'preset',
  'strokeColor',
  'fillColor',
  'background',
  'borderColor',
] as const;

/** JSON Schema (draft 2020-12) for a render spec; printed by `just-logo schema`. */
export function specSchema() {
  const numberProps = Object.fromEntries(
    Object.entries(NUMBER_RULES).map(([key, rule]) => [
      key,
      {
        type: rule.integer ? 'integer' : 'number',
        minimum: rule.min,
        maximum: rule.max,
        default: (DEFAULT_SPEC as Record<string, unknown>)[key],
      },
    ]),
  );
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/evolv3ai/just-logo/cli/spec.schema.json',
    title: 'just-logo render spec',
    description:
      'One logo: an icon from the bundled icon sets plus the same icon and background settings the web editor exposes.',
    type: 'object',
    additionalProperties: false,
    required: ['icon'],
    properties: {
      icon: {
        type: 'string',
        minLength: 3,
        maxLength: MAX_STRING,
        pattern: '^[a-z0-9-]+:[a-z0-9-]+$',
        description: `Icon id as <set>:<name>. Sets: ${AVAILABLE_ICON_SETS.join(', ')}. Find names with \`just-logo icons search\`.`,
      },
      preset: {
        type: 'string',
        enum: PRESETS.map((p) => p.name),
        description:
          'Preset name. Sets strokeColor, fillColor, strokeOpacity, background and borderColor; explicit values override it.',
      },
      strokeColor: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_STRING,
        pattern: NO_CONTROL_PATTERN,
        default: DEFAULT_SPEC.strokeColor,
      },
      fillColor: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_STRING,
        pattern: NO_CONTROL_PATTERN,
        default: DEFAULT_SPEC.fillColor,
      },
      background: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_STRING,
        pattern: NO_CONTROL_PATTERN,
        default: DEFAULT_SPEC.background,
        description:
          'A CSS colour, a linear-gradient(<angle>, <colour> <stop>%, ...) or a radial-gradient(...). Linear gradients become an SVG <linearGradient> with CSS geometry; radial ones become a centred <radialGradient> (shape and position are ignored and reported as backgroundApproximated). Anything else is written as-is and reported as backgroundPassthrough.',
      },
      borderColor: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_STRING,
        pattern: NO_CONTROL_PATTERN,
        default: DEFAULT_SPEC.borderColor,
      },
      ...numberProps,
    },
  };
}

export type ValidationError = { path: string; message: string };

/**
 * Validate a candidate spec against the same rules the schema states.
 * Returns the errors (empty when valid). Does not check that the icon exists;
 * that needs the icon database and is done by the render command.
 */
export function validateSpec(candidate: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return [{ path: '', message: 'spec must be a JSON object' }];
  }
  const obj = candidate as Record<string, unknown>;
  const known = new Set<string>([...STRING_KEYS, ...Object.keys(NUMBER_RULES)]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key))
      errors.push({ path: key, message: 'unknown property' });
  }
  if (
    typeof obj.icon !== 'string' ||
    obj.icon.length > MAX_STRING ||
    !/^[a-z0-9-]+:[a-z0-9-]+$/.test(obj.icon)
  ) {
    errors.push({ path: 'icon', message: 'required, format <set>:<name>' });
  }
  if (obj.preset !== undefined) {
    if (
      typeof obj.preset !== 'string' ||
      !PRESETS.some((p) => p.name === obj.preset)
    ) {
      errors.push({
        path: 'preset',
        message: `unknown preset; one of: ${PRESETS.map((p) => p.name).join(', ')}`,
      });
    }
  }
  for (const key of STRING_KEYS) {
    if (key === 'icon' || key === 'preset') continue;
    const v = obj[key];
    if (v !== undefined && (typeof v !== 'string' || v === '')) {
      errors.push({ path: key, message: 'must be a non-empty string' });
    } else if (typeof v === 'string' && [...v].length > MAX_STRING) {
      // code points, which is what JSON Schema's maxLength counts
      errors.push({
        path: key,
        message: `must be at most ${MAX_STRING} characters`,
      });
    } else if (typeof v === 'string' && HAS_CONTROL.test(v)) {
      errors.push({
        path: key,
        message: 'must not contain control characters',
      });
    }
  }
  for (const [key, rule] of Object.entries(NUMBER_RULES)) {
    const value = obj[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push({ path: key, message: 'must be a number' });
      continue;
    }
    if (rule.integer && !Number.isInteger(value)) {
      errors.push({ path: key, message: 'must be an integer' });
    }
    if (value < rule.min || value > rule.max) {
      errors.push({
        path: key,
        message: `must be between ${rule.min} and ${rule.max}`,
      });
    }
  }
  return errors;
}

/** The five values a preset sets, or an empty object for an unknown or absent name. */
export function presetValues(name: string | undefined): Partial<LogoSpec> {
  const preset = name ? PRESETS.find((p) => p.name === name) : undefined;
  if (!preset) return {};
  return {
    strokeColor: preset.icon.strokeColor,
    strokeOpacity: preset.icon.strokeOpacity,
    fillColor: preset.icon.fillColor,
    background: preset.background.background,
    borderColor: preset.background.borderColor,
  };
}

function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Merge defaults, a preset and explicit values into a full spec.
 * Precedence, lowest to highest: defaults, preset, explicit values.
 */
export function resolveSpec(
  partial: Partial<LogoSpec> & { icon: string },
): LogoSpec {
  return {
    ...DEFAULT_SPEC,
    ...presetValues(partial.preset),
    ...defined(partial),
    icon: partial.icon,
  };
}

/**
 * Layer a config file and command-line flags: defaults, the config's preset,
 * the config's own values, the flags' preset, then the flags' own values.
 * So `--preset` on the command line overrides colours from the config file,
 * and a colour flag overrides that preset, which is what "flags override
 * --config" promises.
 */
export function layerSpec(
  config: Partial<LogoSpec>,
  flags: Partial<LogoSpec>,
): Partial<LogoSpec> & { preset?: string } {
  const c = defined(config);
  const f = defined(flags);
  const { preset: configPreset, ...configRest } = c;
  const { preset: flagPreset, ...flagRest } = f;
  const preset = flagPreset ?? configPreset;
  return {
    ...presetValues(configPreset),
    ...configRest,
    ...presetValues(flagPreset),
    ...flagRest,
    ...(preset !== undefined ? { preset } : {}),
  };
}
