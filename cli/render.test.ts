import { describe, expect, it } from 'vitest';

import { findIcon } from './icons';
import {
  isPlainColor,
  parseGradient,
  renderSvg,
  type LinearGradient,
} from './render';
import { DEFAULT_SPEC, resolveSpec } from './spec';

const linear = (css: string): LinearGradient => {
  const g = parseGradient(css);
  if (!g || g.kind !== 'linear')
    throw new Error(`expected a linear gradient for ${css}`);
  return g;
};

describe('parseGradient (AC4)', () => {
  it('maps a 135deg two-stop gradient corner to corner, top-left to bottom-right, like CSS', () => {
    const g = linear('linear-gradient(135deg, #667eea 0%, #764ba2 100%)');
    expect([g.x1, g.y1, g.x2, g.y2]).toEqual([0, 0, 1, 1]);
    expect(g.stops).toEqual([
      { color: '#667eea', offset: 0 },
      { color: '#764ba2', offset: 1 },
    ]);
  });

  it('keeps three stops with their offsets', () => {
    const g = linear(
      'linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)',
    );
    expect(g.stops).toEqual([
      { color: '#833ab4', offset: 0 },
      { color: '#fd1d1d', offset: 0.5 },
      { color: '#fcb045', offset: 1 },
    ]);
  });

  it('understands side keywords and rgba colours with commas', () => {
    const g = linear(
      'linear-gradient(to right, rgba(0, 0, 0, 0.5) 0%, rgb(255,255,255) 100%)',
    );
    expect(g.x1).toBe(0);
    expect(g.y1).toBe(0.5);
    expect(g.x2).toBe(1);
    expect(g.y2).toBe(0.5);
    expect(g.stops[0].color).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('keeps axis-aligned gradients at unit length and handles 45deg corner to corner', () => {
    const right = linear('linear-gradient(90deg, #000 0%, #fff 100%)');
    expect([right.x1, right.y1, right.x2, right.y2]).toEqual([0, 0.5, 1, 0.5]);
    const down = linear('linear-gradient(#000, #fff)'); // CSS default: to bottom
    expect([down.x1, down.y1, down.x2, down.y2]).toEqual([0.5, 0, 0.5, 1]);
    const ne = linear('linear-gradient(45deg, #000, #fff)'); // bottom-left to top-right
    expect([ne.x1, ne.y1, ne.x2, ne.y2]).toEqual([0, 1, 1, 0]);
  });

  it('positions stops by the CSS rules: ends default to 0/100, runs are spaced between neighbours', () => {
    expect(
      linear('linear-gradient(90deg, red, white, blue)').stops.map(
        (s) => s.offset,
      ),
    ).toEqual([0, 0.5, 1]);
    expect(
      linear('linear-gradient(90deg, red, white 20%, blue)').stops.map(
        (s) => s.offset,
      ),
    ).toEqual([0, 0.2, 1]);
    expect(
      linear(
        'linear-gradient(90deg, red, white 30%, blue, black, yellow 90%, green)',
      ).stops.map((s) => s.offset),
    ).toEqual([0, 0.3, 0.5, 0.7, 0.9, 1]);
    // a later stop positioned before an earlier one is raised to it
    expect(
      linear('linear-gradient(90deg, red 60%, white 20%, blue)').stops.map(
        (s) => s.offset,
      ),
    ).toEqual([0.6, 0.6, 1]);
  });

  it('stretches the gradient line for stops outside 0..100% instead of clamping them', () => {
    // blue sits at 150%: the line runs to x = 1.5 and the box ends part-way through the blend
    const past = linear(
      'linear-gradient(90deg, red 60%, white 20%, blue 150%)',
    );
    expect([past.x1, past.y1, past.x2, past.y2]).toEqual([0, 0.5, 1.5, 0.5]);
    expect(past.stops.map((s) => s.offset)).toEqual([0.4, 0.4, 1]);
    // red sits at -50%: the line starts at x = -0.5
    const before = linear('linear-gradient(90deg, red -50%, blue 100%)');
    expect([before.x1, before.y1, before.x2, before.y2]).toEqual([
      -0.5, 0.5, 1, 0.5,
    ]);
    expect(before.stops.map((s) => s.offset)).toEqual([0, 1]);
    // both ends at once, on a vertical line (to bottom)
    const both = linear('linear-gradient(red -100%, white 50%, blue 200%)');
    expect([both.x1, both.y1, both.x2, both.y2]).toEqual([0.5, -1, 0.5, 2]);
    expect(both.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    // in-range stops leave the geometry alone
    const inside = linear('linear-gradient(90deg, red 10%, blue 90%)');
    expect([inside.x1, inside.x2]).toEqual([0, 1]);
    expect(inside.stops.map((s) => s.offset)).toEqual([0.1, 0.9]);
  });

  it('grows a radial gradient for stops past 100% and reports clamped negative stops', () => {
    const past = parseGradient('radial-gradient(#fff 0%, #000 200%)')!;
    if (past.kind !== 'radial') throw new Error('expected radial');
    expect(past.r).toBe(1.4142);
    expect(past.stops.map((s) => s.offset)).toEqual([0, 1]);
    expect(past.approximated).toBe(false);
    const negative = parseGradient('radial-gradient(#fff -50%, #000 100%)')!;
    if (negative.kind !== 'radial') throw new Error('expected radial');
    expect(negative.r).toBe(0.7071);
    expect(negative.stops.map((s) => s.offset)).toEqual([0, 1]);
    expect(negative.approximated).toBe(true);
  });

  it('accepts the whole CSS number grammar in angles and stop positions', () => {
    const east = [0, 0.5, 1, 0.5];
    for (const angle of [
      '.25turn',
      '+90deg',
      '9e1deg',
      '+.25e0turn',
      '90.0DEG',
    ]) {
      const g = linear(`linear-gradient(${angle}, #000, #fff)`);
      expect([g.x1, g.y1, g.x2, g.y2], angle).toEqual(east);
      expect(g.stops, angle).toHaveLength(2);
    }
    const west = linear('linear-gradient(-90deg, #000, #fff)');
    expect([west.x1, west.y1, west.x2, west.y2]).toEqual([1, 0.5, 0, 0.5]);
    expect(
      linear('linear-gradient(90deg, #000 +.5e1%, #fff 1e2%)').stops.map(
        (s) => s.offset,
      ),
    ).toEqual([0.05, 1]);
    // "1." and a bare unit are not CSS numbers, so these are not gradients we convert
    expect(parseGradient('linear-gradient(1.deg, #000, #fff)')).toBeNull();
    expect(parseGradient('linear-gradient(deg, #000, #fff)')).toBeNull();
  });

  it('does not backtrack on long runs of spaces inside a stop', () => {
    // 200k spaces: linear work takes milliseconds, a quadratic scan would take minutes
    const spaces = ' '.repeat(200_000);
    const t0 = Date.now();
    expect(
      parseGradient(`linear-gradient(90deg, red${spaces}x, blue)`),
    ).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('accepts turn, rad and grad angles and case or spacing variants of side keywords', () => {
    const quarter = linear('linear-gradient(0.25turn, #000, #fff)');
    expect([quarter.x1, quarter.y1, quarter.x2, quarter.y2]).toEqual([
      0, 0.5, 1, 0.5,
    ]);
    const half = linear('linear-gradient(3.14159265rad, #000, #fff)');
    expect([half.x1, half.y1, half.x2, half.y2]).toEqual([0.5, 0, 0.5, 1]);
    const grad = linear('linear-gradient(100grad, #000, #fff)');
    expect([grad.x1, grad.y1, grad.x2, grad.y2]).toEqual([0, 0.5, 1, 0.5]);
    const kw = linear('linear-gradient(TO  Right, #000, #fff)');
    expect([kw.x1, kw.y1, kw.x2, kw.y2]).toEqual([0, 0.5, 1, 0.5]);
    expect(kw.stops).toHaveLength(2); // the keyword was consumed, not kept as a stop
  });

  it('converts radial gradients, ignoring shape and position prefixes', () => {
    const g = parseGradient(
      'radial-gradient(circle at center, rgba(255, 0, 0, 1) 0%, #000 100%)',
    )!;
    expect(g.kind).toBe('radial');
    if (g.kind === 'radial') {
      expect(g.approximated).toBe(true);
      expect([g.cx, g.cy, g.r]).toEqual([0.5, 0.5, 0.7071]);
      expect(g.stops).toEqual([
        { color: 'rgba(255, 0, 0, 1)', offset: 0 },
        { color: '#000', offset: 1 },
      ]);
    }
    const plain = parseGradient('radial-gradient(#fff, #000)')!;
    expect(plain.kind).toBe('radial');
    expect(plain.stops).toHaveLength(2);
    if (plain.kind === 'radial') expect(plain.approximated).toBe(false);
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      background: 'radial-gradient(circle, #fff, #000)',
    });
    const { svg, backgroundPassthrough, backgroundApproximated } = renderSvg(
      spec,
      findIcon('lucide:rocket')!,
    );
    expect(backgroundPassthrough).toBe(false);
    expect(backgroundApproximated).toBe(true);
    const exact = renderSvg(
      resolveSpec({
        icon: 'lucide:rocket',
        background: 'radial-gradient(#fff, #000)',
      }),
      findIcon('lucide:rocket')!,
    );
    expect(exact.backgroundApproximated).toBe(false);
    expect(svg).toContain(
      '<radialGradient id="bg" cx="0.5" cy="0.5" r="0.7071">',
    );
    expect(svg).toContain('fill="url(#bg)"');
  });

  it('does not treat Object.prototype keys as side keywords, and rejects non-colour stops', () => {
    // "constructor" is neither a keyword nor a colour, so this is not a convertible gradient
    expect(
      parseGradient('linear-gradient(constructor, #000, #fff)'),
    ).toBeNull();
    expect(
      parseGradient('linear-gradient(90deg, #000, bogus 50%, #fff)'),
    ).toBeNull();
    expect(parseGradient('radial-gradient(#000, notacolour)')).toBeNull();
  });

  it('accepts a unitless zero angle and any letter case in the function name', () => {
    const up = linear('linear-gradient(0, #000, #fff)');
    expect([up.x1, up.y1, up.x2, up.y2]).toEqual([0.5, 1, 0.5, 0]);
    expect(up.stops).toHaveLength(2); // the 0 was the angle, not a stop
    // a unitless non-zero number is not an angle, and not a colour either
    expect(parseGradient('linear-gradient(90, #000, #fff)')).toBeNull();
    const mixed = linear('Linear-Gradient(90DEG, #000, #fff)');
    expect([mixed.x1, mixed.y1, mixed.x2, mixed.y2]).toEqual([0, 0.5, 1, 0.5]);
    expect(parseGradient('RADIAL-GRADIENT(#000, #fff)')?.kind).toBe('radial');
  });

  it('does not repair a gradient with a trailing, leading or doubled comma', () => {
    for (const bad of [
      'linear-gradient(90deg, red, blue,)',
      'linear-gradient(90deg, red,, blue)',
      'linear-gradient(, red, blue)',
      'radial-gradient(red, blue,)',
      'linear-gradient()',
    ])
      expect(parseGradient(bad), bad).toBeNull();
  });

  it('returns null for a plain colour so it passes through untouched', () => {
    expect(parseGradient('#ffffff')).toBeNull();
    expect(parseGradient('rgba(1,2,3,0.4)')).toBeNull();
  });
});

describe('renderSvg (AC3)', () => {
  const rocket = findIcon('lucide:rocket')!;

  it('renders the Ocean Breeze preset as a 512 canvas with gradient, rect and nested icon svg', () => {
    const spec = resolveSpec({ icon: 'lucide:rocket', preset: 'Ocean Breeze' });
    const { svg, gradient, backgroundPassthrough } = renderSvg(spec, rocket);

    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"',
      ),
    ).toBe(true);
    expect(svg.match(/<linearGradient/g)).toHaveLength(1);
    expect(svg).toContain('stop-color="#667eea"');
    expect(svg).toContain('stop-color="#764ba2"');
    expect(svg).toContain(
      `<rect x="0" y="0" width="512" height="512" rx="${DEFAULT_SPEC.radius}" fill="url(#bg)"/>`,
    );
    expect(svg.match(/<svg x=/g)).toHaveLength(1);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('color="#ffffff"');
    expect(gradient).not.toBeNull();
    expect(backgroundPassthrough).toBe(false);
    expect(svg).toMatchSnapshot();
  });

  it('applies margin, radius and an inside border like the CSS box model', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      background: '#123456',
      margin: 32,
      radius: 64,
      borderWidth: 8,
      borderColor: '#abcdef',
    });
    const { svg } = renderSvg(spec, rocket);
    // The colour fills the whole border box (side 480 at offset 16, radius 64), as CSS paints it.
    // The border is a ring over it: that outer square minus the padding box (side 464 at 24, radius 64 - 8).
    expect(svg).toContain(
      '<rect x="16" y="16" width="480" height="480" rx="64" fill="#123456"/>' +
        '<path d="' +
        'M80 16h352a64 64 0 0 1 64 64v352a64 64 0 0 1 -64 64h-352a64 64 0 0 1 -64 -64v-352a64 64 0 0 1 64 -64z' +
        'M80 24h352a56 56 0 0 1 56 56v352a56 56 0 0 1 -56 56h-352a56 56 0 0 1 -56 -56v-352a56 56 0 0 1 56 -56z' +
        '" fill="#abcdef" fill-rule="evenodd"/>',
    );
  });

  it('lets a translucent border blend with a plain background, as the editor does', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      background: '#ff0000',
      borderWidth: 16,
      borderColor: 'rgba(0, 0, 0, 0.5)',
    });
    const { svg, backgroundApproximated } = renderSvg(spec, rocket);
    // the red reaches the outer edge, under the half-transparent ring
    expect(svg).toContain(
      '<rect x="0" y="0" width="512" height="512" rx="0" fill="#ff0000"/>',
    );
    expect(svg).toContain(
      '<path d="M0 0h512v512h-512zM16 16h480v480h-480z" fill="rgba(0, 0, 0, 0.5)" fill-rule="evenodd"/>',
    );
    expect(backgroundApproximated).toBe(false);
  });

  it('reports a gradient with a see-through stop as approximated, since SVG blends it differently', () => {
    const render = (background: string) =>
      renderSvg(resolveSpec({ icon: 'lucide:rocket', background }), rocket);
    for (const bg of [
      'linear-gradient(red, transparent)',
      'linear-gradient(90deg, #ff0000, #ff000000)',
      'radial-gradient(rgba(0, 0, 0, 0.5), #fff)',
    ]) {
      const r = render(bg);
      expect(r.approximations, bg).toEqual(['translucent-stops']);
      expect(r.backgroundApproximated, bg).toBe(true);
      expect(r.backgroundPassthrough, bg).toBe(false);
    }
    const opaque = render('linear-gradient(red, #0000ffff)');
    expect(opaque.approximations).toEqual([]);
    expect(opaque.backgroundApproximated).toBe(false);
  });

  it('reports a gradient under a border that is not opaque as approximated', () => {
    const render = (borderColor: string, borderWidth = 10) =>
      renderSvg(
        resolveSpec({
          icon: 'lucide:rocket',
          preset: 'Sunset',
          borderWidth,
          borderColor,
        }),
        rocket,
      ).backgroundApproximated;
    for (const opaque of [
      '#000',
      '#000f',
      '#112233',
      '#112233ff',
      'rgb(1, 2, 3)',
      'rgba(1, 2, 3, 1)',
      'hsl(10 50% 50% / 100%)',
      'Black',
    ])
      expect(render(opaque), opaque).toBe(false);
    for (const seeThrough of [
      '#0008',
      '#11223380',
      'rgba(1, 2, 3, 0.5)',
      'hsl(10 50% 50% / 99%)',
      'transparent',
      'bogus',
    ])
      expect(render(seeThrough), seeThrough).toBe(true);
    // no border, nothing to see through
    expect(render('rgba(1, 2, 3, 0.5)', 0)).toBe(false);
  });

  it('keeps the outer radius when the border is wider than twice the radius', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      background: '#fff',
      radius: 16,
      borderWidth: 64,
      borderColor: '#000',
    });
    const { svg } = renderSvg(spec, rocket);
    // the ring keeps its rounded outer edge; the padding box inside it is square
    expect(svg).toContain(
      '<path d="' +
        'M16 0h480a16 16 0 0 1 16 16v480a16 16 0 0 1 -16 16h-480a16 16 0 0 1 -16 -16v-480a16 16 0 0 1 16 -16z' +
        'M64 64h384v384h-384z' +
        '" fill="#000" fill-rule="evenodd"/>',
    );
  });

  it('draws a solid border square when the border leaves no padding box', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      background: '#fff',
      margin: 256,
      borderWidth: 128,
      borderColor: '#000',
    });
    const { svg } = renderSvg(spec, rocket);
    expect(svg).toContain(
      '<path d="M128 128h256v256h-256z" fill="#000" fill-rule="evenodd"/>',
    );
  });

  it('caps the corner radius at half the side, as SVG and CSS do', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      background: '#fff',
      margin: 256,
      radius: 256,
      borderWidth: 8,
      borderColor: '#000',
    });
    const { svg } = renderSvg(spec, rocket);
    // side 256, so the radius is 128 and the straight runs have length 0
    expect(svg).toContain(
      'M256 128h0a128 128 0 0 1 128 128v0a128 128 0 0 1 -128 128h0a128 128 0 0 1 -128 -128v0a128 128 0 0 1 128 -128z',
    );
  });

  it('escapes quotes, ampersands and angle brackets in every user string it writes', () => {
    const hostile = 'a"b&c<d';
    const { svg } = renderSvg(
      resolveSpec({
        icon: 'lucide:rocket',
        background: hostile,
        strokeColor: hostile,
        fillColor: hostile,
        borderColor: hostile,
        borderWidth: 4,
      }),
      rocket,
    );
    const escaped = 'a&quot;b&amp;c&lt;d';
    expect(svg).toContain(`rx="0" fill="${escaped}"/>`); // background
    expect(svg).toContain(`fill="${escaped}" fill-rule="evenodd"/>`); // border
    expect(svg).toContain(`color="${escaped}"`); // stroke
    expect(svg).toContain(`fill="${escaped}" fill-opacity=`); // fill
    expect(svg).not.toContain(hostile);
  });

  it('positions a gradient inside the border, like CSS background-origin: padding-box', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      preset: 'Sunset',
      borderWidth: 10,
    });
    const { svg } = renderSvg(spec, rocket);
    expect(svg).toContain(
      '<rect x="10" y="10" width="492" height="492" rx="0" fill="url(#bg)"/>',
    );
  });

  it('rotates the icon around the canvas centre and honours size and opacities', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      size: 200,
      rotate: 45,
      strokeOpacity: 50,
      fillOpacity: 25,
    });
    const { svg } = renderSvg(spec, rocket);
    expect(svg).toContain('<g transform="rotate(45 256 256)">');
    expect(svg).toContain('<svg x="156" y="156" width="200" height="200"');
    expect(svg).toContain('stroke-opacity="0.5"');
    expect(svg).toContain('fill-opacity="0.25"');
  });

  it('flags an unrecognised background as passthrough, but not real colours', () => {
    for (const bg of ['conic-gradient(#fff, #000)', 'bogus', 'url(x.png)']) {
      const { backgroundPassthrough, gradient } = renderSvg(
        resolveSpec({ icon: 'lucide:rocket', background: bg }),
        rocket,
      );
      expect(gradient).toBeNull();
      expect(backgroundPassthrough).toBe(true);
    }
    for (const bg of [
      '#fff',
      '#12345678',
      'rgba(1, 2, 3, 0.5)',
      'hsl(10 50% 50%)',
      'RebeccaPurple',
      'transparent',
    ]) {
      expect(
        renderSvg(
          resolveSpec({ icon: 'lucide:rocket', background: bg }),
          rocket,
        ).backgroundPassthrough,
      ).toBe(false);
    }
    expect(isPlainColor('#ggg')).toBe(false);
    expect(isPlainColor('rgb(nonsense)')).toBe(false);
    expect(isPlainColor('rgb(255 0 0 / 50%)')).toBe(true);
    expect(isPlainColor('hsl(120deg 50% 50%)')).toBe(true);
    expect(isPlainColor('rgb(1,2,3)) onerror=x')).toBe(false);
    // the two CSS syntaxes are not mixed, and units go only where CSS allows them
    for (const bad of [
      'rgb(1, 2, 3 / 0.5)', // comma form with a slash
      'rgb(1 2 3 0.5)', // space form needs the slash for alpha
      'rgb(none, 1, 2)', // none is modern-only
      'rgb(1,,2,3)',
      'rgb(1deg 2 3)', // angles are for hues
      'rgb(10%, 2, 3)', // legacy rgb: all numbers or all percentages
      'hsl(10, 50, 50)', // legacy hsl needs percentages
      'hsl(10 50% 50% / 1 2)',
    ])
      expect(isPlainColor(bad), bad).toBe(false);
    for (const good of [
      'rgb(10%, 20%, 30%)',
      'rgba(1, 2, 3, 50%)',
      'hsl(10, 50%, 50%)',
      'hsla(10deg, 50%, 50%, 0.5)',
      'hsl(10 50 50)',
      'rgb(none 1 2 / none)',
    ])
      expect(isPlainColor(good), good).toBe(true);
    // currentcolor has no meaning in a standalone file: passed through and reported
    expect(isPlainColor('currentColor')).toBe(false);
    // functional colours need three channels and at most one alpha
    for (const bad of [
      'rgb(1)',
      'rgb(1, 2)',
      'rgb(1 2 3 4 5)',
      'rgb(1 2 3 / 4 / 5)',
      'rgb(1 2 / 3)',
      'rgb(1 2 3 /)',
      'rgb(1 2 3 / 0.5 0.5)',
      'rgb(1, 2, x)',
      'rgb()',
    ])
      expect(isPlainColor(bad), bad).toBe(false);
    for (const good of [
      'rgb(1 2 3)',
      'rgba(1,2,3,.5)',
      'hsl(.5turn 50% 50%)',
      'hsl(none 50% 50% / 1e-1)',
    ])
      expect(isPlainColor(good), good).toBe(true);
  });

  it('is deterministic', () => {
    const spec = resolveSpec({ icon: 'lucide:rocket', preset: 'Sunset' });
    expect(renderSvg(spec, rocket).svg).toBe(renderSvg(spec, rocket).svg);
  });
});
