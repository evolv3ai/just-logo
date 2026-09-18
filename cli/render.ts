import type { IconItem } from '@/types';
import { CANVAS, type LogoSpec } from './spec';

export type GradientStop = { color: string; offset: number };
export type Gradient = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
};

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

/**
 * Parse a CSS `linear-gradient(...)` into SVG gradient geometry.
 * CSS angles run clockwise from "to top"; the SVG vector is expressed in
 * objectBoundingBox units through the centre of the box. Returns null for
 * anything that is not a linear-gradient, so callers can pass it through.
 */
export function parseGradient(background: string): Gradient | null {
  const match = /^\s*linear-gradient\((.*)\)\s*$/s.exec(background);
  if (!match) return null;
  const parts = splitTopLevel(match[1]);
  if (parts.length === 0) return null;

  let angle = 180; // CSS default: "to bottom"
  let first = parts[0];
  const angleMatch = /^(-?\d+(?:\.\d+)?)deg$/.exec(first);
  if (angleMatch) {
    angle = Number(angleMatch[1]);
    parts.shift();
  } else if (Object.hasOwn(SIDE_ANGLES, first)) {
    angle = SIDE_ANGLES[first];
    parts.shift();
  }
  if (parts.length < 2 || !Number.isFinite(angle)) return null;

  const stops = parts.map((part, index) => {
    const stopMatch = /^(.*?)\s+(-?\d+(?:\.\d+)?)%$/.exec(part);
    const color = stopMatch ? stopMatch[1].trim() : part.trim();
    const offset = stopMatch
      ? Number(stopMatch[2]) / 100
      : parts.length === 1
        ? 0
        : index / (parts.length - 1);
    return { color, offset: round(Math.min(1, Math.max(0, offset))) };
  });

  // CSS sizes the gradient line so the 0% and 100% points touch the box's
  // corners: on a square box (objectBoundingBox units, 1x1) its length is
  // |sin a| + |cos a|. A unit-length line would compress every diagonal gradient.
  const rad = (angle * Math.PI) / 180;
  const half = (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad))) / 2;
  const dx = Math.sin(rad) * half;
  const dy = -Math.cos(rad) * half;
  return {
    x1: round(0.5 - dx),
    y1: round(0.5 - dy),
    x2: round(0.5 + dx),
    y2: round(0.5 + dy),
    stops,
  };
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
  /** True when the background was not a colour or linear-gradient and was passed through as a fill. */
  backgroundPassthrough: boolean;
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

  const bw = spec.borderWidth;
  const side = CANVAS - spec.margin - bw;
  const offset = spec.margin / 2 + bw / 2;
  const rx = Math.max(0, spec.radius - bw / 2);
  const fill = gradient ? 'url(#bg)' : escapeAttr(spec.background);

  const defs = gradient
    ? `<defs><linearGradient id="bg" x1="${gradient.x1}" y1="${gradient.y1}" x2="${gradient.x2}" y2="${gradient.y2}">` +
      gradient.stops
        .map(
          (s) =>
            `<stop offset="${s.offset}" stop-color="${escapeAttr(s.color)}"/>`,
        )
        .join('') +
      `</linearGradient></defs>`
    : '';

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
  return { svg, backgroundPassthrough, gradient };
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
