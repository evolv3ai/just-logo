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
  /** True when a shape, size or position prefix was present and ignored. */
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
  if (current.trim()) parts.push(current.trim());
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

/** A CSS angle in any unit, as degrees; null if it is not an angle. */
function parseAngle(token: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)(deg|grad|rad|turn)$/i.exec(token.trim());
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

/** Parse colour stops; null when any stop is not a colour, so nothing invalid is ever emitted as converted. */
function parseStops(parts: string[]): GradientStop[] | null {
  const stops: GradientStop[] = [];
  for (const [index, part] of parts.entries()) {
    const stopMatch = /^(.*?)\s+(-?\d+(?:\.\d+)?)%$/.exec(part);
    const color = stopMatch ? stopMatch[1].trim() : part.trim();
    if (!isPlainColor(color)) return null;
    const offset = stopMatch
      ? Number(stopMatch[2]) / 100
      : parts.length === 1
        ? 0
        : index / (parts.length - 1);
    stops.push({ color, offset: round(Math.min(1, Math.max(0, offset))) });
  }
  return stops;
}

/**
 * Parse a CSS `linear-gradient(...)` or `radial-gradient(...)` into SVG
 * gradient geometry in objectBoundingBox units. CSS angles run clockwise from
 * "to top". A radial gradient keeps its stops and is centred with the CSS
 * default "farthest-corner" radius; shape and position prefixes are accepted
 * and ignored. Returns null for anything else, so callers can pass it through.
 */
export function parseGradient(background: string): Gradient | null {
  const radial = /^\s*radial-gradient\((.*)\)\s*$/s.exec(background);
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
    return {
      kind: 'radial',
      cx: 0.5,
      cy: 0.5,
      r: round(Math.SQRT1_2),
      stops,
      approximated,
    };
  }

  const match = /^\s*linear-gradient\((.*)\)\s*$/s.exec(background);
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
    return {
      kind: 'linear',
      x1: round(0.5 - dx),
      y1: round(0.5 - dy),
      x2: round(0.5 + dx),
      y2: round(0.5 + dy),
      stops,
    };
  }
}

/** The CSS named colours, so a bare word is only treated as a colour when it is one. */
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
    'white whitesmoke yellow yellowgreen currentcolor'
  ).split(' '),
);

/** True for the background forms the editor's colour picker produces, or a CSS named colour. */
export function isPlainColor(value: string): boolean {
  const v = value.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
  if (/^(?:rgba?|hsla?)\(.*\)$/i.test(v)) return true;
  return NAMED_COLORS.has(v.toLowerCase());
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

export type RenderResult = {
  svg: string;
  /** True when the background was not a colour or a convertible gradient and was written as-is. */
  backgroundPassthrough: boolean;
  /** True when a radial gradient's shape/size/position was ignored and the default geometry used. */
  backgroundApproximated: boolean;
  gradient: Gradient | null;
};

/**
 * Compose the SVG the editor's export zone would contain: a 512x512 canvas,
 * the background square (margin, radius, border) and the icon centred on it.
 * Pure: same spec and icon in, same string out.
 */
export function renderSvg(spec: LogoSpec, icon: IconItem): RenderResult {
  const gradient = parseGradient(spec.background);
  const backgroundPassthrough = !gradient && !isPlainColor(spec.background);
  const backgroundApproximated =
    gradient?.kind === 'radial' && gradient.approximated;

  const bw = spec.borderWidth;
  const side = CANVAS - spec.margin - bw;
  const offset = spec.margin / 2 + bw / 2;
  const rx = Math.max(0, spec.radius - bw / 2);
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

  const border =
    bw > 0
      ? ` stroke="${escapeAttr(spec.borderColor)}" stroke-width="${bw}"`
      : '';
  const rect = `<rect x="${offset}" y="${offset}" width="${side}" height="${side}" rx="${rx}" fill="${fill}"${border}/>`;

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
  return { svg, backgroundPassthrough, backgroundApproximated, gradient };
}

/** Rasterise an SVG string to PNG bytes at the given edge length. Loads resvg lazily. */
export async function renderPng(
  svg: string,
  size: number,
): Promise<Uint8Array> {
  let mod: typeof import('@resvg/resvg-js');
  try {
    mod = await import('@resvg/resvg-js');
  } catch (error) {
    throw new Error(
      `PNG output needs @resvg/resvg-js, which failed to load on this platform: ${(error as Error).message}`,
    );
  }
  const resvg = new mod.Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}
