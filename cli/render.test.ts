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
    expect(g.x1).toBeCloseTo(0, 3);
    expect(g.y1).toBeCloseTo(0, 3);
    expect(g.x2).toBeCloseTo(1, 3);
    expect(g.y2).toBeCloseTo(1, 3);
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

  it('spaces stops evenly when no percentages are given', () => {
    const g = linear('linear-gradient(90deg, red, white, blue)');
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
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

  it('applies margin, radius and an inside border like the editor box model', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      background: '#123456',
      margin: 32,
      radius: 64,
      borderWidth: 8,
      borderColor: '#abcdef',
    });
    const { svg } = renderSvg(spec, rocket);
    // side = 512 - 32 - 8, offset = 16 + 4, rx = 64 - 4
    expect(svg).toContain(
      '<rect x="20" y="20" width="472" height="472" rx="60" fill="#123456" stroke="#abcdef" stroke-width="8"/>',
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
  });

  it('is deterministic', () => {
    const spec = resolveSpec({ icon: 'lucide:rocket', preset: 'Sunset' });
    expect(renderSvg(spec, rocket).svg).toBe(renderSvg(spec, rocket).svg);
  });
});
