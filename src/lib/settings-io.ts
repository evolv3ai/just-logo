import { resolveSpec, validateSpec } from '@/lib/logo-spec';
import type { LogoSpec } from '@/lib/logo-spec';
import type { BackgroundSettings, IconItem, IconSettings } from '@/types';

/**
 * The bridge between the editor's saved state and the CLI's `--config` file.
 * A settings file is a render spec (see logo-spec.ts): export writes one the
 * CLI accepts unchanged, import reads one through the CLI's own validator.
 * Pure on purpose, so both directions are unit-tested without a DOM.
 */

/** A settings file is a few hundred bytes; nothing larger is read. */
export const MAX_SETTINGS_BYTES = 65536;

/** What export writes: a full spec without the two fields the editor lacks. */
export type SettingsSpec = Omit<LogoSpec, 'preset' | 'pngSize'>;

type Failure = { ok: false; message: string };
export type ExportResult = { ok: true; spec: SettingsSpec } | Failure;
export type ImportResult =
  | {
      ok: true;
      iconSettings: IconSettings;
      backgroundSettings: BackgroundSettings;
    }
  | Failure;

function invalid(candidate: unknown): string | null {
  const errors = validateSpec(candidate);
  if (errors.length === 0) return null;
  const detail = errors
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .join('; ');
  return `invalid settings: ${detail}`;
}

/** The editor's stored state as a spec, or why it cannot be exported. */
export function editorToSpec(
  iconSettings: IconSettings,
  backgroundSettings: BackgroundSettings,
): ExportResult {
  const { icon } = iconSettings;
  if (!icon) {
    return { ok: false, message: 'pick an icon before exporting settings' };
  }
  const spec: SettingsSpec = {
    icon: `${icon.set}:${icon.name}`,
    size: iconSettings.size,
    rotate: iconSettings.rotate,
    strokeColor: iconSettings.strokeColor,
    strokeWidth: iconSettings.strokeWidth,
    strokeOpacity: iconSettings.strokeOpacity,
    fillColor: iconSettings.fillColor,
    fillOpacity: iconSettings.fillOpacity,
    background: backgroundSettings.background,
    margin: backgroundSettings.margin,
    radius: backgroundSettings.borderRadius,
    borderWidth: backgroundSettings.borderWidth,
    borderColor: backgroundSettings.borderColor,
  };
  const message = invalid(spec);
  return message ? { ok: false, message } : { ok: true, spec };
}

/** A resolved spec as editor state; the icon must be in the editor's list. */
export function specToEditor(
  spec: LogoSpec,
  icons: ReadonlyArray<IconItem>,
): ImportResult {
  const icon = icons.find((i) => `${i.set}:${i.name}` === spec.icon);
  if (!icon) return { ok: false, message: `icon not found: ${spec.icon}` };
  return {
    ok: true,
    iconSettings: {
      icon,
      size: spec.size,
      rotate: spec.rotate,
      strokeColor: spec.strokeColor,
      strokeWidth: spec.strokeWidth,
      strokeOpacity: spec.strokeOpacity,
      fillColor: spec.fillColor,
      fillOpacity: spec.fillOpacity,
    },
    backgroundSettings: {
      background: spec.background,
      margin: spec.margin,
      borderRadius: spec.radius,
      borderWidth: spec.borderWidth,
      borderColor: spec.borderColor,
    },
  };
}

/**
 * Read a settings file. Validation and preset/default resolution are the
 * CLI's, so a file means the same design in both places.
 */
export function parseSettings(
  text: string,
  icons: ReadonlyArray<IconItem>,
): ImportResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return { ok: false, message: 'not a JSON file' };
  }
  const message = invalid(candidate);
  if (message) return { ok: false, message };
  return specToEditor(
    resolveSpec(candidate as Partial<LogoSpec> & { icon: string }),
    icons,
  );
}

export function serializeSettings(spec: SettingsSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}
