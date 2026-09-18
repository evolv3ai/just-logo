import fs from 'node:fs';
import Fuse from 'fuse.js';
import { locate } from '@iconify/json';

import type { IconItem } from '@/types';
import { getCleanIconBody } from '@/lib/utils';
import { AVAILABLE_ICON_SETS } from '@/lib/constants';

export type IconSet = (typeof AVAILABLE_ICON_SETS)[number];

const setCache = new Map<string, IconItem[]>();

/** One set's icons, bodies cleaned exactly as the editor does. Parsed once per process. */
export function loadSet(set: string): IconItem[] {
  const cached = setCache.get(set);
  if (cached) return cached;
  if (!(AVAILABLE_ICON_SETS as readonly string[]).includes(set)) return [];
  const data = JSON.parse(fs.readFileSync(locate(set), 'utf8')) as {
    icons: Record<string, { body: string }>;
  };
  const items = Object.keys(data.icons).map((name) => ({
    name,
    set,
    body: getCleanIconBody(data.icons[name].body),
  }));
  setCache.set(set, items);
  return items;
}

/** Every icon of every available set, in set order. */
export function loadIcons(): IconItem[] {
  return AVAILABLE_ICON_SETS.flatMap((set) => loadSet(set));
}

export function iconSets(): readonly string[] {
  return AVAILABLE_ICON_SETS;
}

export function parseIconId(id: string): { set: string; name: string } | null {
  const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id);
  return match ? { set: match[1], name: match[2] } : null;
}

/** Look one icon up by `<set>:<name>`, loading only that set. */
export function findIcon(id: string): IconItem | null {
  const parsed = parseIconId(id);
  if (!parsed) return null;
  return loadSet(parsed.set).find((i) => i.name === parsed.name) ?? null;
}

export type SearchHit = {
  id: string;
  set: string;
  name: string;
  score: number;
};

/**
 * Fuzzy search over icon names with the same library the editor uses. Fuse
 * scores every name that contains the query the same, so ties would fall back
 * to list order and bury `star` under `align-start`. Ties are broken the way a
 * person expects: the exact name first, then names starting with the query,
 * then shorter names.
 */
export function searchIcons(
  query: string,
  options: { set?: string; limit?: number } = {},
): SearchHit[] {
  const limit = options.limit ?? 20;
  const pool = options.set ? loadSet(options.set) : loadIcons();
  const fuse = new Fuse(pool, {
    keys: ['name'],
    threshold: 0.3,
    ignoreLocation: true,
    includeScore: true,
  });
  const wanted = query.trim().toLowerCase().replace(/\s+/g, '-');
  const rank = (name: string) =>
    name === wanted ? 0 : name.startsWith(wanted) ? 1 : 2;
  return fuse
    .search(query)
    .map(({ item, score }, index) => ({
      item,
      index,
      score: Number((score ?? 0).toFixed(4)),
    }))
    .sort(
      (a, b) =>
        Number(b.item.name === wanted) - Number(a.item.name === wanted) ||
        a.score - b.score ||
        rank(a.item.name) - rank(b.item.name) ||
        a.item.name.length - b.item.name.length ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map(({ item, score }) => ({
      id: `${item.set}:${item.name}`,
      set: item.set,
      name: item.name,
      score,
    }));
}

/**
 * A standalone SVG of the bare icon, useful for previewing a search hit. Same
 * attributes as the editor's picker thumbnail: the stroke is what makes icons
 * whose own fill was stripped (tabler's `-filled` ones) visible at all.
 */
export function bareIconSvg(icon: IconItem, size = 24): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `color="#000" stroke="currentColor" stroke-width="2" fill="none">${icon.body}</svg>`
  );
}
