import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The app version, read from apps/server/package.json at startup.
 *
 * Two candidate paths because tsup flattens the bundle: in dev this file runs
 * from src/lib/ (two levels under apps/server), in the build it is inlined
 * into dist/index.js (one level). Read once — it cannot change while the
 * process lives.
 */
function readVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (!existsSync(p)) continue;
    const pkg = JSON.parse(readFileSync(p, 'utf8'));
    if (pkg.name === '@overload/server') return pkg.version;
  }
  return '0.0.0';
}

export const APP_VERSION: string = readVersion();
