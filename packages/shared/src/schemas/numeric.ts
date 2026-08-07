import { z } from 'zod';

/** Blank/whitespace means "not provided" — never 0. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/**
 * Wraps a numeric schema so it also accepts a numeric string.
 *
 * Several MCP clients emit every scalar as a string, so a plain `z.number()`
 * rejects a perfectly good `"10"` with "Expected number, received string" —
 * which made `log_set` unusable from at least one client. Nullable numerics
 * are hit hardest: they project to an `anyOf`/union JSON Schema that clients
 * handle less reliably than a flat `{"type":"number"}`.
 *
 * Coercion alone would be unsafe: bare `z.coerce.number()` turns `""` into
 * `0`, `true` into `1` and `[]` into `0`, which would silently log a zero
 * weight rather than an absent one. Blanks are mapped to undefined first so
 * they fail loudly instead. `null`/`undefined` still pass through untouched,
 * and the emitted JSON Schema is byte-identical to the un-wrapped version.
 *
 * Use as `numeric(z.coerce.number().int().min(0)).nullish()` — build the
 * constraints on a coercing base, then wrap.
 */
export function numeric<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess(blankToUndefined, inner);
}

/** Coercing numeric base: `num().int().min(0)` etc. */
export const num = () => z.coerce.number();
