/**
 * Client-side JSON similarity: structural equality first, then lightweight sentence embeddings
 * (Transformers.js + Xenova/all-MiniLM-L6-v2 — small sentence-transformer, BERT-family).
 */
import { stableStringify } from './datasetCompare';
import type { ExamplePair } from './datasetCompare';

/**
 * Minimum unit score [0,1] (post cosine mapping) to form a similar pair when embedding.
 * 75% — pairs below this stay in A-only / B-only.
 */
export const MIN_PAIR_SIMILARITY = 0.75;

/** @deprecated use MIN_PAIR_SIMILARITY */
export const DEFAULT_SEMANTIC_MIN_SCORE = MIN_PAIR_SIMILARITY;

/** Subtracted from raw [0,1] embedding scores (middle of long strings is not embedded). */
export const EMBEDDING_SIMILARITY_SNIPE_ALLOWANCE = 0.05;

const EMBEDDING_TEXT_HEAD = 1000;
const EMBEDDING_TEXT_TAIL = 1000;
/** Above this length, embed head + `...snipped...` + tail only. */
const EMBEDDING_TEXT_MAX_BEFORE_SNIP = EMBEDDING_TEXT_HEAD + EMBEDDING_TEXT_TAIL;
export const EMBEDDING_TEXT_SNIP_MARKER = '...snipped...';

/**
 * Caps text sent to the LLM embedder: at most `EMBEDDING_TEXT_MAX_BEFORE_SNIP` characters as-is;
 * longer strings use 1000 chars from the start, `...snipped...`, then 1000 from the end.
 */
export function clipTextForEmbedding(s: string): string {
  if (s.length <= EMBEDDING_TEXT_MAX_BEFORE_SNIP) return s;
  return (
    s.slice(0, EMBEDDING_TEXT_HEAD) +
    EMBEDDING_TEXT_SNIP_MARKER +
    s.slice(-EMBEDDING_TEXT_TAIL)
  );
}

export type SimilarityMethod = 'equal' | 'embedding';

export type JsonSimilarityResult = {
  /** In [0, 1]; 1 = same normalized JSON. */
  score: number;
  method: SimilarityMethod;
};

export type JsonSimilarityOptions = {
  /**
   * When set, successful embedding vectors are cached under these keys (e.g. example id).
   * Omitted or empty string → no cache for that side.
   */
  embeddingCacheIdA?: string;
  embeddingCacheIdB?: string;
};

/** L2-normalized embedding vectors keyed by example id (when ids are passed). */
const embeddingVectorCache = new Map<string, Float32Array>();

/** Lazy singleton embedder (MiniLM ~23MB, loads once). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedderPromise: Promise<any> | null = null;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/** Counts ONNX forward passes through the embedder (for tests / debugging). */
let embeddingForwardPassCount = 0;

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      return pipeline('feature-extraction', MODEL_ID);
    })();
  }
  return embedderPromise;
}

/** Test hook: clear cached model promise and embedding vectors. */
export function resetSimilarityEmbedderForTests(): void {
  embedderPromise = null;
  embeddingVectorCache.clear();
  embeddingForwardPassCount = 0;
}

export function clearEmbeddingVectorCache(): void {
  embeddingVectorCache.clear();
}

/** @internal tests */
export function getEmbeddingVectorCacheSizeForTests(): number {
  return embeddingVectorCache.size;
}

/** @internal tests */
export function getEmbeddingForwardPassCountForTests(): number {
  return embeddingForwardPassCount;
}

function cacheKey(id: string | undefined): string | undefined {
  if (id === undefined || id === null) return undefined;
  const t = String(id).trim();
  return t.length > 0 ? t : undefined;
}

function copyRowAsFloat32(data: Float32Array, row: number, dim: number): Float32Array {
  const start = row * dim;
  return Float32Array.from(data.subarray(start, start + dim));
}

/**
 * Dot product of two equal-length vectors (cosine if both L2-normalized).
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

/**
 * Resolve two L2-normalized embedding vectors, using cache when `embeddingCacheId*` are set.
 * Prefers a single batched forward pass when both are missing from cache.
 */
async function getTwoL2NormalizedVectors(
  textA: string,
  textB: string,
  cacheIdA: string | undefined,
  cacheIdB: string | undefined,
): Promise<{ vecA: Float32Array; vecB: Float32Array }> {
  const keyA = cacheKey(cacheIdA);
  const keyB = cacheKey(cacheIdB);

  let vecA = keyA ? embeddingVectorCache.get(keyA) : undefined;
  let vecB = keyB ? embeddingVectorCache.get(keyB) : undefined;

  if (vecA && vecB) {
    return { vecA, vecB };
  }

  const embedA = clipTextForEmbedding(textA);
  const embedB = clipTextForEmbedding(textB);

  const extractor = await getEmbedder();

  if (!vecA && !vecB) {
    embeddingForwardPassCount += 1;
    const tensor = await extractor([embedA, embedB], { pooling: 'mean', normalize: true });
    const { data, dims } = tensor;
    if (!dims || dims[0] !== 2 || dims.length < 2) {
      throw new Error('Unexpected embedding shape');
    }
    const dim = dims[1]!;
    const d = data as Float32Array;
    vecA = copyRowAsFloat32(d, 0, dim);
    vecB = copyRowAsFloat32(d, 1, dim);
    if (keyA) embeddingVectorCache.set(keyA, vecA);
    if (keyB) embeddingVectorCache.set(keyB, vecB);
    return { vecA, vecB };
  }

  if (vecA && !vecB) {
    embeddingForwardPassCount += 1;
    const tensor = await extractor(embedB, { pooling: 'mean', normalize: true });
    const { data, dims } = tensor;
    if (!dims || dims[0] !== 1 || dims.length < 2) {
      throw new Error('Unexpected embedding shape');
    }
    const dim = dims[1]!;
    vecB = copyRowAsFloat32(data as Float32Array, 0, dim);
    if (keyB) embeddingVectorCache.set(keyB, vecB);
    return { vecA, vecB };
  }

  // vecB && !vecA
  embeddingForwardPassCount += 1;
  const tensor = await extractor(embedA, { pooling: 'mean', normalize: true });
  const { data, dims } = tensor;
  if (!dims || dims[0] !== 1 || dims.length < 2) {
    throw new Error('Unexpected embedding shape');
  }
  const dim = dims[1]!;
  vecA = copyRowAsFloat32(data as Float32Array, 0, dim);
  if (keyA) embeddingVectorCache.set(keyA, vecA);
  return { vecA: vecA!, vecB: vecB! };
}

export function jsonToSimilarityText(value: unknown): string {
  return stableStringify(value);
}

/**
 * Structural equality on JSON-serializable values (key-sorted, stable arrays).
 */
export function jsonObjectsEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Cosine similarity for two equal-length vectors packed as one row-major batch [2, dim] (legacy helper).
 */
export function cosineSimilarityFromRows(data: Float32Array | number[], dim: number): number {
  let dot = 0;
  for (let i = 0; i < dim; i++) {
    dot += data[i]! * data[dim + i]!;
  }
  if (!Number.isFinite(dot)) return 0;
  return Math.min(1, Math.max(-1, dot));
}

/** Map cosine [-1, 1] to [0, 1] for display / thresholds. */
export function cosineToUnitScore(cosine: number): number {
  return (Math.min(1, Math.max(-1, cosine)) + 1) / 2;
}

/** Final embedding similarity in [0, 1] after allowance for unseen middle text. */
export function applyEmbeddingSnipeAllowance(rawUnitScore: number): number {
  return Math.max(0, rawUnitScore - EMBEDDING_SIMILARITY_SNIPE_ALLOWANCE);
}

/**
 * Compare two JSON-compatible values: equality short-circuit, else embedding similarity on stable text.
 * Pass `embeddingCacheIdA` / `embeddingCacheIdB` (e.g. example ids) to reuse vectors across pairs.
 */
export async function jsonSimilarity(
  a: unknown,
  b: unknown,
  options?: JsonSimilarityOptions,
): Promise<JsonSimilarityResult> {
  if (jsonObjectsEqual(a, b)) {
    return { score: 1, method: 'equal' };
  }
  const textA = jsonToSimilarityText(a);
  const textB = jsonToSimilarityText(b);
  if (textA === textB) {
    return { score: 1, method: 'equal' };
  }

  const { vecA, vecB } = await getTwoL2NormalizedVectors(textA, textB, options?.embeddingCacheIdA, options?.embeddingCacheIdB);
  const cosine = dotProduct(vecA, vecB);
  const clamped = Math.min(1, Math.max(-1, cosine));
  const rawUnit = cosineToUnitScore(clamped);
  return { score: applyEmbeddingSnipeAllowance(rawUnit), method: 'embedding' };
}

export type SemanticExampleHit = ExamplePair & { score: number };
