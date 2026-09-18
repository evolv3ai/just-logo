import { expect, it, vi } from 'vitest';

// The rasteriser is a native module that may be missing on a platform. This
// mock makes loading it fail, so a static `import` of @resvg/resvg-js anywhere
// in the render module would make the import below reject.
vi.mock('@resvg/resvg-js', () => {
  throw new Error('native module missing');
});

it('loads the PNG rasteriser only when a PNG is asked for', async () => {
  const { renderPng, renderSvg } = await import('./render');
  const { findIcon } = await import('./icons');
  const { resolveSpec } = await import('./spec');
  const { svg } = renderSvg(
    resolveSpec({ icon: 'lucide:star' }),
    findIcon('lucide:star')!,
  );
  expect(svg).toContain('<svg x=');
  await expect(renderPng(svg, 64)).rejects.toThrow(
    /PNG output needs @resvg\/resvg-js/,
  );
});
