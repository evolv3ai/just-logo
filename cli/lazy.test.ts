import fs from 'node:fs';
import path from 'node:path';
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

// cli/index.ts runs the program on import, so it cannot be loaded under the
// mock above. Guard it, and every other CLI source, at the source level. The
// check is on the whole text, so a multi-line import or a re-export cannot
// slip past it: the package name appears nowhere outside render.ts, and in
// render.ts only in the lazy import, its type, and the error message.
it('names @resvg/resvg-js nowhere but the lazy import in render.ts', () => {
  const sources = fs
    .readdirSync(__dirname)
    .filter((f) => /\.(ts|mjs|mts)$/.test(f) && !f.endsWith('.test.ts'));
  expect(sources).toContain('index.ts');
  for (const file of sources) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const mentions = text
      .split('\n')
      .filter((l) => l.includes('resvg-js'))
      .map((l) => l.trim());
    if (file !== 'render.ts') {
      expect(mentions, file).toEqual([]);
      continue;
    }
    expect(mentions).toEqual([
      "let mod: typeof import('@resvg/resvg-js');",
      "mod = await import('@resvg/resvg-js');",
      '`PNG output needs @resvg/resvg-js, which failed to load on this platform: ${(error as Error).message}`,',
    ]);
  }
});
