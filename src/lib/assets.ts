// Loads repo-bundled assets (style guide, white logo) at runtime. The files are
// included in the function bundle via vercel.json `includeFiles: assets/brand/**`.
// We probe a few base dirs so it works both locally and in the Vercel runtime.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASES = [
  process.cwd(),
  join(process.cwd(), '..'),
  __dirname,
  join(__dirname, '..'),
  join(__dirname, '..', '..'),
  join(__dirname, '..', '..', '..'),
];

export function loadAsset(relPath: string): Buffer {
  for (const base of BASES) {
    const p = join(base, relPath);
    if (existsSync(p)) return readFileSync(p);
  }
  throw new Error(`Asset not found in any base dir: ${relPath}`);
}

export function loadAssetText(relPath: string): string {
  return loadAsset(relPath).toString('utf8');
}

/** Like loadAsset but returns null instead of throwing when absent. */
export function tryLoadAsset(relPath: string): Buffer | null {
  try {
    return loadAsset(relPath);
  } catch {
    return null;
  }
}

/** Like loadAssetText but returns null instead of throwing when absent. */
export function tryLoadAssetText(relPath: string): string | null {
  try {
    return loadAssetText(relPath);
  } catch {
    return null;
  }
}
