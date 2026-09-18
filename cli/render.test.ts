import { describe, expect, it } from 'vitest';

import { findIcon } from './icons';
import { parseGradient, renderSvg } from './render';
import { DEFAULT_SPEC, resolveSpec } from './spec';

describe('parseGradient (AC4)', () => {
  it('maps a 135deg two-stop gradient to a top-left to bottom-right vector', () => {
    const g = parseGradient(
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    );
    expect(g).not.toBeNull();
    expect(g!.x1).toBeCloseTo(0.1464, 3);
    expect(g!.y1).toBeCloseTo(0.1464, 3);
    expect(g!.x2).toBeCloseTo(0.8536, 3);
    expect(g!.y2).toBeCloseTo(0.8536, 3);
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

  it('spaces stops evenly when no percentages are given', () => {
    const g = parseGradient('linear-gradient(90deg, red, white, blue)');
    expect(g!.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
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

  it('flags an unrecognised background as passthrough', () => {
    const spec = resolveSpec({
      icon: 'lucide:rocket',
      background: 'radial-gradient(circle, #fff, #000)',
    });
    const { backgroundPassthrough, gradient } = renderSvg(spec, rocket);
    expect(gradient).toBeNull();
    expect(backgroundPassthrough).toBe(true);
  });

  it('is deterministic', () => {
    const spec = resolveSpec({ icon: 'lucide:rocket', preset: 'Sunset' });
    expect(renderSvg(spec, rocket).svg).toBe(renderSvg(spec, rocket).svg);
  });
});
