import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// These tiles are hand-written SVG that Vite inlines as data URIs. A malformed
// one does not fail the build or the stylesheet: the browser simply declines to
// decode it and the background renders as nothing, which is easy to ship and
// hard to notice. A double hyphen inside the explanatory comment did exactly
// that once. So: parse them.
const here = dirname(fileURLToPath(import.meta.url));
const tiles = ['honeycomb-dark.svg', 'honeycomb-light.svg'];

describe.each(tiles)('%s', (file) => {
  const svg = readFileSync(resolve(here, file), 'utf8');

  it('is well-formed XML', () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const error = doc.querySelector('parsererror');
    expect(error?.textContent ?? null).toBeNull();
    expect(doc.documentElement.tagName).toBe('svg');
  });

  it('has no double hyphen inside its comment', () => {
    for (const [, body] of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
      expect(body).not.toContain('--');
    }
  });

  it('tiles on the 144 x 84 grid the stylesheet expects', () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    expect([root.getAttribute('width'), root.getAttribute('height')]).toEqual(['144', '84']);
    expect(root.getAttribute('viewBox')).toBe('0 0 144 84');
  });

  const vertices = () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const shapes = [...doc.querySelectorAll('polyline, polygon')];
    expect(shapes.length).toBeGreaterThan(0); // querying the wrong tag would pass vacuously
    return shapes.map((s) =>
      (s.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((pt) => pt.split(',').map(Number) as [number, number]),
    );
  };

  it('puts horizontal edges on pixel centres so they render at full weight', () => {
    // Every vertex sits on a .5, which is what makes a 1px stroke cover exactly
    // one row instead of straddling two at half intensity.
    for (const pts of vertices()) for (const [, y] of pts) expect(Math.abs(y % 1)).toBeCloseTo(0.5, 6);
  });

  it('strokes every edge exactly once', () => {
    // Adjacent cells share edges. Drawing closed hexagons paints each shared edge
    // twice, and two 5% strokes stack to ~9.75%, so those edges rendered at double
    // the weight of the unshared ones -- visible as an uneven pattern.
    const seen = new Map<string, number>();
    for (const pts of vertices()) {
      for (let i = 1; i < pts.length; i++) {
        const key = [pts[i - 1], pts[i]]
          .map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`)
          .sort()
          .join('|');
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('leaves no shape closed, since a closed hexagon reintroduces the shared edge', () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelectorAll('polygon')).toHaveLength(0);
  });
});
