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
  // validateSpec reads an undefined value as "absent", and JSON.stringify
  // would drop the key, so the CLI would fill it from its own defaults and
  // draw something other than the preview. A stored state can lack a field
  // (hand-edited localStorage), so that is refused here.
  const missing = Object.entries(spec)
    .filter(([, value]) => value === undefined)
    .map(([key]) => `${key}: missing`);
  if (missing.length > 0) {
    return { ok: false, message: `invalid settings: ${missing.join('; ')}` };
  }
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

/** The part of a browser `File` that import needs; a plain object in tests. */
export type SettingsFile = { size: number; text: () => Promise<string> };

/** Where the editor's icon list stands (see use-icons.ts). */
export type IconList =
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'ready'; icons: ReadonlyArray<IconItem> };

/**
 * Every decision import makes, so the component only shows the message or
 * applies the settings. The file is not read when it is too large or when
 * there is no icon list to look its icon up in.
 */
export async function importSettingsFile(
  file: SettingsFile,
  iconList: IconList,
): Promise<ImportResult> {
  if (iconList.status === 'pending') {
    return {
      ok: false,
      message: 'the icon list is still loading, try again in a moment',
    };
  }
  if (iconList.status === 'error') {
    return {
      ok: false,
      message: 'the icon list failed to load, reload the page',
    };
  }
  if (file.size > MAX_SETTINGS_BYTES) {
    return { ok: false, message: 'the file is too large' };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, message: 'the file could not be read' };
  }
  return parseSettings(text, iconList.icons);
}
