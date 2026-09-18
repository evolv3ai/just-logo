import { describe, expect, it } from 'vitest';

import { findIcon } from './icons';
import { isPlainColor, parseGradient, renderSvg } from './render';
import { DEFAULT_SPEC, resolveSpec } from './spec';

describe('parseGradient (AC4)', () => {
  it('maps a 135deg two-stop gradient corner to corner, top-left to bottom-right, like CSS', () => {
    const g = parseGradient(
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    );
    expect(g).not.toBeNull();
    expect(g!.x1).toBeCloseTo(0, 3);
    expect(g!.y1).toBeCloseTo(0, 3);
    expect(g!.x2).toBeCloseTo(1, 3);
    expect(g!.y2).toBeCloseTo(1, 3);
    expect(g!.stops).toEqual([
      { color: '#667eea', offset: 0 },
      { color: '#764ba2', offset: 1 },
    ]);
  });

  it('keeps three stops with their offsets', () => {
    const g = parseGradient(
      'linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)',
    );
    expect(g!.stops).toEqual([
      { color: '#833ab4', offset: 0 },
      { color: '#fd1d1d', offset: 0.5 },
      { color: '#fcb045', offset: 1 },
    ]);
  });

  it('understands side keywords and rgba colours with commas', () => {
    const g = parseGradient(
      'linear-gradient(to right, rgba(0, 0, 0, 0.5) 0%, rgb(255,255,255) 100%)',
    );
    expect(g!.x1).toBe(0);
    expect(g!.y1).toBe(0.5);
    expect(g!.x2).toBe(1);
    expect(g!.y2).toBe(0.5);
    expect(g!.stops[0].color).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('keeps axis-aligned gradients at unit length and handles 45deg corner to corner', () => {
    const right = parseGradient('linear-gradient(90deg, #000 0%, #fff 100%)')!;
    expect([right.x1, right.y1, right.x2, right.y2]).toEqual([0, 0.5, 1, 0.5]);
    const down = parseGradient('linear-gradient(#000, #fff)')!; // CSS default: to bottom
    expect([down.x1, down.y1, down.x2, down.y2]).toEqual([0.5, 0, 0.5, 1]);
    const ne = parseGradient('linear-gradient(45deg, #000, #fff)')!; // bottom-left to top-right
    expect([ne.x1, ne.y1, ne.x2, ne.y2]).toEqual([0, 1, 1, 0]);
  });

  it('spaces stops evenly when no percentages are given', () => {
    const g = parseGradient('linear-gradient(90deg, red, white, blue)');
    expect(g!.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
  });

  it('does not treat Object.prototype keys as side keywords', () => {
    const g = parseGradient('linear-gradient(constructor, #000, #fff)');
    expect(g).not.toBeNull();
    expect(g!.stops).toHaveLength(3); // "constructor" is just an (invalid) colour stop
    for (const v of [g!.x1, g!.y1, g!.x2, g!.y2])
      expect(Number.isFinite(v)).toBe(true);
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
    for (const bg of [
      'radial-gradient(circle, #fff, #000)',
      'bogus',
      'url(x.png)',
    ]) {
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
