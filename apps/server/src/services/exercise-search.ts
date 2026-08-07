// Token-based fuzzy exercise search. Punctuation-insensitive, synonym-aware,
// designed for LLM callers that type "one arm dumbbell row" and expect
// "One-Arm Dumbbell Row" to match.

const SYNONYMS: Record<string, string[]> = {
  db: ['dumbbell'],
  dumbbells: ['dumbbell'],
  bb: ['barbell'],
  kb: ['kettlebell'],
  kettlebells: ['kettlebell'],
  ohp: ['overhead', 'press'],
  rdl: ['romanian', 'deadlift'],
  chinup: ['chin'],
  chinups: ['chin'],
  pullup: ['pullups'],
  'pull-up': ['pullups'],
  pullups: ['pullups'],
  lat: ['lat'],
  bw: ['body'],
  bodyweight: ['body'],
  abs: ['ab'],
  bicep: ['biceps'],
  tricep: ['triceps'],
  glute: ['glute'],
  ham: ['hamstring'],
  hams: ['hamstring'],
  quad: ['quad'],
  situp: ['sit'],
  pushup: ['push'],
  'push-up': ['push'],
  press: ['press'],
  row: ['row'],
  curl: ['curl'],
  squat: ['squat'],
};

export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function expandToken(token: string): string[] {
  return [token, ...(SYNONYMS[token] ?? [])];
}

export interface SearchableExercise {
  id: string;
  name: string;
}

export interface ScoredMatch {
  id: string;
  name: string;
  score: number;
}

/**
 * Rank exercises for a query. Every query token (or one of its synonyms)
 * must appear as a substring of the normalized name; ranked by how much of
 * the name is covered (shorter names that cover all tokens score higher).
 */
export function searchExercises(query: string, catalog: SearchableExercise[], limit = 10): ScoredMatch[] {
  const tokens = normalizeTokens(query);
  if (!tokens.length) return [];
  const results: ScoredMatch[] = [];
  for (const ex of catalog) {
    const nameTokens = normalizeTokens(ex.name);
    const nameJoined = nameTokens.join(' ');
    let matched = 0;
    let exact = 0;
    for (const token of tokens) {
      const variants = expandToken(token);
      if (variants.some((v) => nameTokens.includes(v))) {
        matched++;
        exact++;
      } else if (variants.some((v) => nameJoined.includes(v))) {
        matched++;
      }
    }
    if (matched < tokens.length) continue;
    // Coverage: fraction of name tokens that were hit; exact word hits and
    // shorter names rank first.
    const score = exact * 2 + matched + Math.max(0, 4 - Math.abs(nameTokens.length - tokens.length)) / 4;
    results.push({ id: ex.id, name: ex.name, score });
  }
  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
