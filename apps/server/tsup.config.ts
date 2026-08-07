import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', seed: 'prisma/seed.ts' },
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Bundle the workspace-local shared package; everything else stays external.
  noExternal: ['@overload/shared'],
});
