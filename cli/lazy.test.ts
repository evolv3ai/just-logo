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
// mock above. Guard it, and every other CLI source, at the source level: the
// rasteriser is named in render.ts only, and only as a dynamic or type import.
it('names @resvg/resvg-js in code nowhere but the lazy import in render.ts', () => {
  const sources = fs
    .readdirSync(__dirname)
    .filter((f) => /\.(ts|mjs|mts)$/.test(f) && !f.endsWith('.test.ts'));
  expect(sources).toContain('index.ts');
  for (const file of sources) {
    const code = fs
      .readFileSync(path.join(__dirname, file), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      // the error message in render.ts names the package inside a template string
      .filter((l) =>
        /import\b.*@resvg\/resvg-js|require\(.*@resvg\/resvg-js/.test(l),
      );
    expect(code, file).toEqual(
      file === 'render.ts'
        ? [
            "let mod: typeof import('@resvg/resvg-js');",
            "mod = await import('@resvg/resvg-js');",
          ]
        : [],
    );
  }
});
