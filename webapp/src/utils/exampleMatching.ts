import type Example from '../common/types/Example';
import type { ExamplePair } from './datasetCompare';
import { stableStringify, normalizeExampleForMatching } from './datasetCompare';
import {
  jsonSimilarity,
  jsonObjectsEqual,
  MIN_PAIR_SIMILARITY,
  type SemanticExampleHit,
} from './similarity';

export type ExampleMatchProgress =
  | { phase: 'equality' }
  | { phase: 'similarity'; evaluated: number; total: number };

export type ExampleMatchResult = {
  identical: ExamplePair[];
  similar: SemanticExampleHit[];
  onlyA: Example[];
  onlyB: Example[];
};

function sortExamplesById(examples: Example[]): Example[] {
  return [...examples].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * 1:1 equality: group by normalized content (ignoring id & metrics), zip min(countA, countB) pairs per key.
 */
export function matchExamplesByEquality(poolA: Example[], poolB: Example[]): {
  identical: ExamplePair[];
  remainingA: Example[];
  remainingB: Example[];
} {
  const sortedA = sortExamplesById(poolA);
  const sortedB = sortExamplesById(poolB);

  const mapA = new Map<string, Example[]>();
  const mapB = new Map<string, Example[]>();
  for (const ex of sortedA) {
    const k = stableStringify(normalizeExampleForMatching(ex));
    if (!mapA.has(k)) mapA.set(k, []);
    mapA.get(k)!.push(ex);
  }
  for (const ex of sortedB) {
    const k = stableStringify(normalizeExampleForMatching(ex));
    if (!mapB.has(k)) mapB.set(k, []);
    mapB.get(k)!.push(ex);
  }

  const identical: ExamplePair[] = [];
  const remainingA: Example[] = [];
  const remainingB: Example[] = [];

  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  const sortedKeys = [...keys].sort();
  for (const k of sortedKeys) {
    const as = mapA.get(k) ?? [];
    const bs = mapB.get(k) ?? [];
    const n = Math.min(as.length, bs.length);
    for (let i = 0; i < n; i++) {
      identical.push({ exampleA: as[i]!, exampleB: bs[i]! });
    }
    for (let i = n; i < as.length; i++) remainingA.push(as[i]!);
    for (let i = n; i < bs.length; i++) remainingB.push(bs[i]!);
  }

  return { identical, remainingA, remainingB };
}

type ScoredPair = { exampleA: Example; exampleB: Example; score: number };

/**
 * Full 1:1 matching: equality first (disjoint pools), then greedy embedding similarity (highest scores first),
 * pairing only while similarity ≥ `MIN_PAIR_SIMILARITY` (75%). Remaining rows are onlyA / onlyB.
 */
export async function matchExamplesOneToOneAsync(
  examplesA: Example[],
  examplesB: Example[],
  options?: {
    onProgress?: (p: ExampleMatchProgress) => void;
    /** Fired after structural 1:1 equality, before embedding similarity. */
    onEqualityDone?: (p: { identical: ExamplePair[]; remainingA: Example[]; remainingB: Example[] }) => void;
    /** Each similar pair as it is committed (score ≥ min, greedy highest-first). */
    onSimilarPair?: (hit: SemanticExampleHit) => void;
    signal?: AbortSignal;
    /** Yield to the browser between embedding evaluations. */
    yieldMs?: number;
  },
): Promise<ExampleMatchResult> {
  const yieldMs = options?.yieldMs ?? 0;
  const poolA = sortExamplesById(examplesA ?? []);
  const poolB = sortExamplesById(examplesB ?? []);

  options?.onProgress?.({ phase: 'equality' });
  const { identical, remainingA, remainingB } = matchExamplesByEquality(poolA, poolB);
  options?.onEqualityDone?.({ identical, remainingA, remainingB });

  const ra = sortExamplesById(remainingA);
  const rb = sortExamplesById(remainingB);

  const scored: ScoredPair[] = [];
  const totalPairs = ra.length * rb.length;
  let evaluated = 0;

  for (const a of ra) {
    for (const b of rb) {
      if (options?.signal?.aborted) {
        return { identical, similar: [], onlyA: ra, onlyB: rb };
      }
      const pa = normalizeExampleForMatching(a);
      const pb = normalizeExampleForMatching(b);
      if (jsonObjectsEqual(pa, pb)) {
        evaluated += 1;
        options?.onProgress?.({ phase: 'similarity', evaluated, total: totalPairs });
        continue;
      }
      const r = await jsonSimilarity(pa, pb, {
        embeddingCacheIdA: a.id,
        embeddingCacheIdB: b.id,
      });
      scored.push({ exampleA: a, exampleB: b, score: r.score });
      evaluated += 1;
      options?.onProgress?.({ phase: 'similarity', evaluated, total: totalPairs });
      if (yieldMs >= 0) {
        await new Promise((res) => setTimeout(res, yieldMs));
      }
    }
  }

  scored.sort((x, y) => y.score - x.score);

  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const similar: SemanticExampleHit[] = [];

  for (const row of scored) {
    if (row.score < MIN_PAIR_SIMILARITY) break;
    const idA = String(row.exampleA.id);
    const idB = String(row.exampleB.id);
    if (usedA.has(idA) || usedB.has(idB)) continue;
    usedA.add(idA);
    usedB.add(idB);
    const hit: SemanticExampleHit = {
      exampleA: row.exampleA,
      exampleB: row.exampleB,
      score: row.score,
    };
    similar.push(hit);
    options?.onSimilarPair?.(hit);
  }

  const onlyA = ra.filter((ex) => !usedA.has(String(ex.id)));
  const onlyB = rb.filter((ex) => !usedB.has(String(ex.id)));

  return {
    identical,
    similar: similar.sort((a, b) => b.score - a.score),
    onlyA,
    onlyB,
  };
}
