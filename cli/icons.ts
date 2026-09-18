import fs from 'node:fs';
import Fuse from 'fuse.js';
import { locate } from '@iconify/json';

import type { IconItem } from '@/types';
import { getCleanIconBody } from '@/lib/utils';
import { AVAILABLE_ICON_SETS } from '@/lib/constants';

export type IconSet = (typeof AVAILABLE_ICON_SETS)[number];

let cache: IconItem[] | null = null;

/** Every icon of every available set, in set order, bodies cleaned exactly as the editor does. */
export function loadIcons(): IconItem[] {
  if (cache) return cache;
  const all: IconItem[] = [];
  for (const set of AVAILABLE_ICON_SETS) {
    const data = JSON.parse(fs.readFileSync(locate(set), 'utf8')) as {
      icons: Record<string, { body: string }>;
    };
    for (const name of Object.keys(data.icons)) {
      all.push({ name, set, body: getCleanIconBody(data.icons[name].body) });
    }
  }
  cache = all;
  return all;
}

export function iconSets(): readonly string[] {
  return AVAILABLE_ICON_SETS;
}

export function parseIconId(id: string): { set: string; name: string } | null {
  const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id);
  return match ? { set: match[1], name: match[2] } : null;
}

export function findIcon(id: string): IconItem | null {
  const parsed = parseIconId(id);
  if (!parsed) return null;
  return (
    loadIcons().find((i) => i.set === parsed.set && i.name === parsed.name) ??
    null
  );
}

export type SearchHit = {
  id: string;
  set: string;
  name: string;
  score: number;
};

/** Fuzzy search over icon names with the same library the editor uses. */
export function searchIcons(
  query: string,
  options: { set?: string; limit?: number } = {},
): SearchHit[] {
  const limit = options.limit ?? 20;
  const pool = options.set
    ? loadIcons().filter((i) => i.set === options.set)
    : loadIcons();
  const fuse = new Fuse(pool, {
    keys: ['name'],
    threshold: 0.3,
    ignoreLocation: true,
    includeScore: true,
  });
  return fuse.search(query, { limit }).map(({ item, score }) => ({
    id: `${item.set}:${item.name}`,
    set: item.set,
    name: item.name,
    score: Number((score ?? 0).toFixed(4)),
  }));
}

/** A standalone SVG of the bare icon, useful for previewing a search hit. */
export function bareIconSvg(icon: IconItem, size = 24): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `color="#000" stroke-width="2" fill="none">${icon.body}</svg>`
  );
}
