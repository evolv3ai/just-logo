import type { IconItem } from '@/types';
import { CANVAS, type LogoSpec } from './spec';

export type GradientStop = { color: string; offset: number };
export type LinearGradient = {
  kind: 'linear';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
};
export type RadialGradient = {
  kind: 'radial';
  cx: number;
  cy: number;
  r: number;
  stops: GradientStop[];
  /**
   * True when the geometry is not what CSS would draw: a shape, size or
   * position prefix was present and ignored, or a negative stop position was
   * clamped to the centre.
   */
  approximated: boolean;
};
export type Gradient = LinearGradient | RadialGradient;

/** Split on commas that are not inside parentheses, so `rgba(1, 2, 3, .5)` stays whole. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  // An empty part (trailing or doubled comma) is kept: it is not a colour, so
  // the gradient is reported as not convertible instead of quietly repaired.
  parts.push(current.trim());
  return parts;
}

const SIDE_ANGLES: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
  'to top right': 45,
  'to right top': 45,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom left': 225,
  'to left bottom': 225,
  'to top left': 315,
  'to left top': 315,
};

function round(n: number): number {
  // + 0 folds -0 into 0 so serialised coordinates never read "-0".
  return Number(n.toFixed(4)) + 0;
}

/** The CSS <number> grammar: optional sign, optional leading digits, optional exponent. */
const CSS_NUMBER = '[+-]?(?:\\d*\\.)?\\d+(?:e[+-]?\\d+)?';
const ANGLE = new RegExp(`^(${CSS_NUMBER})(deg|grad|rad|turn)$`, 'i');
const PERCENTAGE = new RegExp(`^${CSS_NUMBER}%$`, 'i');
const PLAIN_NUMBER = new RegExp(`^${CSS_NUMBER}$`, 'i');

/** A CSS angle in any unit, as degrees; null if it is not an angle. */
function parseAngle(token: string): number | null {
  const t = token.trim();
  // CSS lets a zero angle drop its unit; browsers accept it in gradients.
  if (PLAIN_NUMBER.test(t) && Number(t) === 0) return 0;
  const m = ANGLE.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case 'deg':
      return n;
    case 'grad':
      return n * 0.9;
    case 'rad':
      return (n * 180) / Math.PI;
    default:
      return n * 360;
  }
}

/** Split "<colour> <position>%" without backtracking: the position is the last token. */
function splitStop(part: string): { color: string; position: number | null } {
  const t = part.trim().replace(/\s+/g, ' ');
  const i = t.lastIndexOf(' ');
  if (i === -1) return { color: t, position: null };
  const tail = t.slice(i + 1);
  if (!PERCENTAGE.test(tail)) return { color: t, position: null };
  return { color: t.slice(0, i), position: Number(tail.slice(0, -1)) / 100 };
}

/**
 * Parse colour stops. Positions follow the CSS rules: a missing first stop is
 * 0%, a missing last stop is 100%, and a run of unpositioned stops is spaced
 * evenly between its positioned neighbours. Positions are returned as given,
 * so they may lie outside 0..1; SVG clamps offsets, so callers rescale the
 * gradient geometry instead (see fitStops). Returns null when any stop is not
 * a colour, so nothing invalid is ever emitted as converted.
 */
function parseStops(parts: string[]): GradientStop[] | null {
  const raw = parts.map(splitStop);
  if (raw.some((r) => !isPlainColor(r.color))) return null;
  const offsets: (number | null)[] = raw.map((r) => r.position);
  if (offsets[0] === null) offsets[0] = 0;
  if (offsets[offsets.length - 1] === null) offsets[offsets.length - 1] = 1;
  // CSS: a positioned stop never precedes an earlier one; later stops are raised to match.
  let floor = offsets[0] as number;
  for (let i = 0; i < offsets.length; i += 1) {
    const o = offsets[i];
    if (o === null) continue;
    offsets[i] = Math.max(o, floor);
    floor = offsets[i] as number;
  }
  let i = 0;
  while (i < offsets.length) {
    if (offsets[i] !== null) {
      i += 1;
      continue;
    }
    let j = i;
    while (offsets[j] === null) j += 1; // the next positioned stop; the last is always positioned
    const from = offsets[i - 1] as number;
    const to = offsets[j] as number;
    const runs = j - i + 1;
    for (let k = i; k < j; k += 1)
      offsets[k] = from + ((to - from) * (k - i + 1)) / runs;
    i = j;
  }
  return raw.map((r, k) => ({
    color: r.color,
    offset: round(offsets[k] as number),
  }));
}

/**
 * SVG clamps stop offsets to 0..1, CSS does not: `blue 150%` puts blue beyond
 * the box, so the box ends part-way through the blend. Map the offsets onto
 * 0..1 over the range [lo, hi] they really span; the caller stretches the
 * gradient line (or radius) by the same range, which draws the same picture.
 */
function fitStops(
  stops: GradientStop[],
  lo: number,
  hi: number,
): GradientStop[] {
  return stops.map((s) => ({
    color: s.color,
    offset: round(Math.min(1, Math.max(0, (s.offset - lo) / (hi - lo)))),
  }));
}

/**
 * Parse a CSS `linear-gradient(...)` or `radial-gradient(...)` into SVG
 * gradient geometry in objectBoundingBox units. CSS angles run clockwise from
 * "to top". A radial gradient keeps its stops and is centred with the CSS
 * default "farthest-corner" radius; shape and position prefixes are accepted
 * and ignored. Returns null for anything else, so callers can pass it through.
 */
export function parseGradient(background: string): Gradient | null {
  const radial = /^\s*radial-gradient\((.*)\)\s*$/is.exec(background);
  if (radial) {
    const parts = splitTopLevel(radial[1]);
    // A leading shape/size/position prefix such as "circle", "ellipse at center" or
    // "closest-side at 30% 30%" never starts with a colour. It is dropped and the
    // result is marked approximated, so callers can tell the geometry is the default.
    let approximated = false;
    if (
      parts.length &&
      /^(circle|ellipse|closest-|farthest-|at\s|\d)/i.test(parts[0])
    ) {
      parts.shift();
      approximated = true;
    }
    if (parts.length < 2) return null;
    const stops = parseStops(parts);
    if (!stops) return null;
    // Stops past 100% are exact with a larger radius. A radius cannot start
    // below zero, so negative positions are clamped and reported.
    if (stops[0].offset < 0) approximated = true;
    const hi = Math.max(1, stops[stops.length - 1].offset);
    return {
      kind: 'radial',
      cx: 0.5,
      cy: 0.5,
      r: round(Math.SQRT1_2 * hi),
      stops: fitStops(stops, 0, hi),
      approximated,
    };
  }

  const match = /^\s*linear-gradient\((.*)\)\s*$/is.exec(background);
  if (!match) return null;
  const parts = splitTopLevel(match[1]);
  if (parts.length === 0) return null;

  let angle = 180; // CSS default: "to bottom"
  const first = parts[0].trim().toLowerCase().replace(/\s+/g, ' ');
  const asAngle = parseAngle(first);
  if (asAngle !== null) {
    angle = asAngle;
    parts.shift();
  } else if (Object.hasOwn(SIDE_ANGLES, first)) {
    angle = SIDE_ANGLES[first];
    parts.shift();
  }
  if (parts.length < 2 || !Number.isFinite(angle)) return null;

  const stops = parseStops(parts);
  if (!stops) return null;
  {
    // CSS sizes the gradient line so the 0% and 100% points touch the box's
    // corners: on a square box (objectBoundingBox units, 1x1) its length is
    // |sin a| + |cos a|. A unit-length line would compress every diagonal gradient.
    const rad = (angle * Math.PI) / 180;
    const half = (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad))) / 2;
    const dx = Math.sin(rad) * half;
    const dy = -Math.cos(rad) * half;
    // Stops outside 0..100% stretch the line rather than being clamped.
    const lo = Math.min(0, stops[0].offset);
    const hi = Math.max(1, stops[stops.length - 1].offset);
    return {
      kind: 'linear',
      x1: round(0.5 + dx * (2 * lo - 1)),
      y1: round(0.5 + dy * (2 * lo - 1)),
      x2: round(0.5 + dx * (2 * hi - 1)),
      y2: round(0.5 + dy * (2 * hi - 1)),
      stops: fitStops(stops, lo, hi),
    };
  }
}

/**
 * The CSS named colours, so a bare word is only treated as a colour when it is
 * one. `currentcolor` is left out on purpose: in the editor it means the page's
 * foreground colour, which a standalone SVG does not have, so it is passed
 * through and reported rather than silently drawn black.
 */
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
    'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
    'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
    'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat ' +
    'white whitesmoke yellow yellowgreen'
  ).split(' '),
);

/** True for the background forms the editor's colour picker produces, or a CSS named colour. */
export function isPlainColor(value: string): boolean {
  const v = value.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
  if (/^(?:rgba?|hsla?)\(/i.test(v)) return colorArguments(v) !== null;
  return NAMED_COLORS.has(v.toLowerCase());
}

/**
 * The arguments of an rgb()/rgba()/hsl()/hsla() colour, or null when the form
 * is not one CSS accepts. Two syntaxes, never mixed: the legacy one separates
 * everything with commas (alpha included) and has no `none`; the modern one
 * separates channels with spaces and puts the alpha after a `/`. A hue may
 * carry an angle unit; rgb channels are all numbers or all percentages in the
 * legacy form; `rgb(1)` and `rgb(1deg 2 3)` are not colours.
 */
function colorArguments(value: string): string[] | null {
  const fn = /^(rgb|hsl)a?\(([^()]*)\)$/i.exec(value.trim());
  if (!fn) return null;
  const hsl = fn[1].toLowerCase() === 'hsl';
  const body = fn[2].trim();
  const legacy = body.includes(',');
  let args: string[];
  if (legacy) {
    if (body.includes('/')) return null;
    args = body.split(',').map((t) => t.trim());
  } else {
    const [channels, alpha, ...extra] = body.split('/');
    if (extra.length > 0) return null;
    args = channels.split(/\s+/).filter((t) => t !== '');
    if (args.length !== 3) return null;
    if (alpha !== undefined) {
      const a = alpha.trim();
      if (a === '' || /\s/.test(a)) return null;
      args.push(a);
    }
  }
  if (args.length !== 3 && args.length !== 4) return null;
  const ok = args.every((t, i) => {
    if (t.toLowerCase() === 'none') return !legacy;
    if (i === 0 && hsl) return PLAIN_NUMBER.test(t) || ANGLE.test(t);
    if (hsl && legacy && (i === 1 || i === 2)) return PERCENTAGE.test(t);
    return PLAIN_NUMBER.test(t) || PERCENTAGE.test(t);
  });
  if (!ok) return null;
  if (legacy && !hsl) {
    const percentages = args.slice(0, 3).filter((t) => t.endsWith('%')).length;
    if (percentages !== 0 && percentages !== 3) return null;
  }
  return args;
}

/** True when a colour certainly paints with full alpha. Anything unrecognised counts as not opaque. */
export function isOpaqueColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]+)$/.exec(v);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 6) return true;
    if (h.length === 4) return h[3] === 'f';
    return h.length === 8 && h.slice(6) === 'ff';
  }
  const args = colorArguments(v);
  if (args) {
    if (args.length === 3) return true;
    const a = args[3];
    return a.endsWith('%') ? Number(a.slice(0, -1)) >= 100 : Number(a) >= 1;
  }
  return NAMED_COLORS.has(v) && v !== 'transparent';
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** A square with rounded corners as a closed path; the radius is capped at half the side, as SVG and CSS do. */
function roundedSquarePath(
  offset: number,
  side: number,
  radius: number,
): string {
  const r = round(Math.min(Math.max(0, radius), side / 2));
  if (r === 0) return `M${offset} ${offset}h${side}v${side}h${-side}z`;
  const s = round(side - 2 * r);
  return (
    `M${round(offset + r)} ${offset}h${s}a${r} ${r} 0 0 1 ${r} ${r}v${s}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-s}a${r} ${r} 0 0 1 ${-r} ${-r}v${-s}a${r} ${r} 0 0 1 ${r} ${-r}z`
  );
}

export type RenderResult = {
  svg: string;
  /** True when the background was not a colour or a convertible gradient and was written as-is. */
  backgroundPassthrough: boolean;
  /**
   * True when the background is converted but not exactly what CSS draws: a
   * radial gradient's shape/size/position was ignored, a negative radial stop
   * was clamped, or a gradient sits under a border that is not opaque (CSS
   * repeats the gradient tile under the border; here the border area shows
   * only the border colour).
   */
  backgroundApproximated: boolean;
  /** Why, one entry per cause; empty exactly when backgroundApproximated is false. */
  approximations: Approximation[];
  gradient: Gradient | null;
};

export type Approximation =
  | 'radial-geometry'
  | 'gradient-under-border'
  | 'translucent-stops';

/**
 * Compose the SVG the editor's export zone would contain: a 512x512 canvas,
 * the background square (margin, radius, border) and the icon centred on it.
 * Pure: same spec and icon in, same string out.
 */
export function renderSvg(spec: LogoSpec, icon: IconItem): RenderResult {
  const gradient = parseGradient(spec.background);
  const backgroundPassthrough = !gradient && !isPlainColor(spec.background);
  const approximations: Approximation[] = [];
  if (gradient?.kind === 'radial' && gradient.approximated)
    approximations.push('radial-geometry');
  if (gradient && spec.borderWidth > 0 && !isOpaqueColor(spec.borderColor))
    approximations.push('gradient-under-border');
  // CSS blends gradient stops in premultiplied alpha, SVG does not: between a
  // colour and a see-through stop the SVG passes through darker or greyer tones.
  if (gradient?.stops.some((s) => !isOpaqueColor(s.color)))
    approximations.push('translucent-stops');
  const backgroundApproximated = approximations.length > 0;

  const bw = spec.borderWidth;
  const outerSide = CANVAS - spec.margin;
  const outerOffset = spec.margin / 2;
  const fill = gradient ? 'url(#bg)' : escapeAttr(spec.background);

  const stopsMarkup = (stops: GradientStop[]) =>
    stops
      .map(
        (s) =>
          `<stop offset="${s.offset}" stop-color="${escapeAttr(s.color)}"/>`,
      )
      .join('');
  let defs = '';
  if (gradient?.kind === 'linear') {
    defs =
      `<defs><linearGradient id="bg" x1="${gradient.x1}" y1="${gradient.y1}" x2="${gradient.x2}" y2="${gradient.y2}">` +
      stopsMarkup(gradient.stops) +
      `</linearGradient></defs>`;
  } else if (gradient?.kind === 'radial') {
    defs =
      `<defs><radialGradient id="bg" cx="${gradient.cx}" cy="${gradient.cy}" r="${gradient.r}">` +
      stopsMarkup(gradient.stops) +
      `</radialGradient></defs>`;
  }

  // CSS box model: the border is drawn inside the element and keeps the outer
  // radius; the padding box inside it has radius - border. The border is a
  // ring (outer square minus padding box, even-odd), drawn over the
  // background: a plain colour paints the whole border box, so a translucent
  // border blends with it as in the editor, while a gradient is positioned in
  // the padding box. A stroked rect would square off corners once bw > 2 * radius.
  let rect: string;
  if (bw > 0) {
    const innerSide = Math.max(0, outerSide - 2 * bw);
    const innerOffset = outerOffset + bw;
    const innerRx = Math.max(0, spec.radius - bw);
    const ring =
      roundedSquarePath(outerOffset, outerSide, spec.radius) +
      (innerSide > 0 ? roundedSquarePath(innerOffset, innerSide, innerRx) : '');
    rect =
      (gradient
        ? `<rect x="${innerOffset}" y="${innerOffset}" width="${innerSide}" height="${innerSide}" rx="${innerRx}" fill="${fill}"/>`
        : `<rect x="${outerOffset}" y="${outerOffset}" width="${outerSide}" height="${outerSide}" rx="${spec.radius}" fill="${fill}"/>`) +
      `<path d="${ring}" fill="${escapeAttr(spec.borderColor)}" fill-rule="evenodd"/>`;
  } else {
    rect = `<rect x="${outerOffset}" y="${outerOffset}" width="${outerSide}" height="${outerSide}" rx="${spec.radius}" fill="${fill}"/>`;
  }

  const s = spec.size;
  const pos = (CANVAS - s) / 2;
  const rotate =
    spec.rotate !== 0
      ? ` transform="rotate(${spec.rotate} ${CANVAS / 2} ${CANVAS / 2})"`
      : '';
  const iconSvg =
    `<g${rotate}>` +
    `<svg x="${pos}" y="${pos}" width="${s}" height="${s}" viewBox="0 0 24 24" preserveAspectRatio="none" ` +
    `color="${escapeAttr(spec.strokeColor)}" stroke-width="${spec.strokeWidth}" stroke-opacity="${spec.strokeOpacity / 100}" ` +
    `fill="${escapeAttr(spec.fillColor)}" fill-opacity="${spec.fillOpacity / 100}">` +
    icon.body +
    `</svg></g>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">` +
    defs +
    rect +
    iconSvg +
    `</svg>`;
  return {
    svg,
    backgroundPassthrough,
    backgroundApproximated,
    approximations,
    gradient,
  };
}

/** Thrown when the native rasteriser cannot be loaded, as opposed to failing on an input. */
export class RasteriserLoadError extends Error {}

/** Rasterise an SVG string to PNG bytes at the given edge length. Loads resvg lazily. */
export async function renderPng(
  svg: string,
  size: number,
): Promise<Uint8Array> {
  let mod: typeof import('@resvg/resvg-js');
  try {
    // Test hook: simulate the native module failing to load on this platform.
    if (process.env.JUST_LOGO_DISABLE_RESVG === '1')
      throw new Error('simulated load failure');
    mod = await import('@resvg/resvg-js');
  } catch (error) {
    throw new RasteriserLoadError(
      `PNG output needs @resvg/resvg-js, which failed to load on this platform: ${(error as Error).message}`,
    );
  }
  // Test hook: simulate the rasteriser rejecting the document it was given.
  if (process.env.JUST_LOGO_FAIL_RASTER === '1')
    throw new Error('simulated raster failure');
  const resvg = new mod.Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}
