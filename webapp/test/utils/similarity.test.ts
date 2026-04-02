import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyEmbeddingSnipeAllowance,
  clipTextForEmbedding,
  cosineSimilarityFromRows,
  cosineToUnitScore,
  EMBEDDING_SIMILARITY_SNIPE_ALLOWANCE,
  EMBEDDING_TEXT_SNIP_MARKER,
  getEmbeddingForwardPassCountForTests,
  getEmbeddingVectorCacheSizeForTests,
  jsonObjectsEqual,
  jsonSimilarity,
  jsonToSimilarityText,
  resetSimilarityEmbedderForTests,
} from '../../src/utils/similarity';

vi.mock('@xenova/transformers', () => ({
  env: { allowLocalModels: false, useBrowserCache: true },
  pipeline: vi.fn(async () => {
    return async (texts: string | string[], _opts?: unknown) => {
      const arr = Array.isArray(texts) ? texts : [texts];
      const dim = 4;
      const data = new Float32Array(arr.length * dim);
      for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < dim; j++) {
          data[i * dim + j] = ((arr[i]?.charCodeAt(0) ?? 0) + j) * 0.01;
        }
      }
      return { data, dims: [arr.length, dim] };
    };
  }),
}));

describe('similarity', () => {
  beforeEach(() => {
    resetSimilarityEmbedderForTests();
  });

  it('jsonObjectsEqual uses stable structure', () => {
    expect(jsonObjectsEqual({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true);
    expect(jsonObjectsEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('jsonToSimilarityText matches stableStringify shape', () => {
    expect(jsonToSimilarityText({ b: 1, a: 2 })).toBe(jsonToSimilarityText({ a: 2, b: 1 }));
  });

  it('clipTextForEmbedding leaves short strings unchanged', () => {
    expect(clipTextForEmbedding('x'.repeat(2000))).toBe('x'.repeat(2000));
  });

  it('clipTextForEmbedding uses head, snip marker, and tail when over 2000 chars', () => {
    const s = 'a'.repeat(1000) + 'MID' + 'b'.repeat(1000);
    expect(s.length).toBe(2003);
    const out = clipTextForEmbedding(s);
    expect(out.startsWith('a'.repeat(1000))).toBe(true);
    expect(out.includes(EMBEDDING_TEXT_SNIP_MARKER)).toBe(true);
    expect(out.endsWith('b'.repeat(1000))).toBe(true);
    expect(out.length).toBe(1000 + EMBEDDING_TEXT_SNIP_MARKER.length + 1000);
  });

  it('cosineSimilarityFromRows for orthogonal rows', () => {
    const dim = 3;
    const data = new Float32Array([1, 0, 0, 0, 1, 0]);
    expect(cosineSimilarityFromRows(data, dim)).toBeCloseTo(0, 5);
  });

  it('cosineToUnitScore maps [-1,1] to [0,1]', () => {
    expect(cosineToUnitScore(-1)).toBe(0);
    expect(cosineToUnitScore(1)).toBe(1);
    expect(cosineToUnitScore(0)).toBe(0.5);
  });

  it('applyEmbeddingSnipeAllowance subtracts allowance and floors at 0', () => {
    expect(applyEmbeddingSnipeAllowance(1)).toBeCloseTo(1 - EMBEDDING_SIMILARITY_SNIPE_ALLOWANCE);
    expect(applyEmbeddingSnipeAllowance(0.03)).toBe(0);
  });

  it('jsonSimilarity short-circuits on equal JSON without embeddings', async () => {
    const r = await jsonSimilarity({ x: 1 }, { x: 1 });
    expect(r.method).toBe('equal');
    expect(r.score).toBe(1);
  });

  it('jsonSimilarity uses embedding path when JSON differs', async () => {
    const r = await jsonSimilarity({ a: 'hello' }, { a: 'world' });
    expect(r.method).toBe('embedding');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('caches embeddings by id and avoids extra forward passes when ids repeat', async () => {
    await jsonSimilarity({ x: 'aa' }, { x: 'bb' }, { embeddingCacheIdA: 'ea', embeddingCacheIdB: 'eb' });
    expect(getEmbeddingVectorCacheSizeForTests()).toBe(2);
    expect(getEmbeddingForwardPassCountForTests()).toBe(1);

    await jsonSimilarity({ x: 'cc' }, { x: 'dd' }, { embeddingCacheIdA: 'ea', embeddingCacheIdB: 'ec' });
    expect(getEmbeddingVectorCacheSizeForTests()).toBe(3);
    expect(getEmbeddingForwardPassCountForTests()).toBe(2);

    await jsonSimilarity({ x: 'aa' }, { x: 'bb' }, { embeddingCacheIdA: 'ea', embeddingCacheIdB: 'eb' });
    expect(getEmbeddingForwardPassCountForTests()).toBe(2);
  });

  it('does not cache when embedding cache ids are omitted', async () => {
    await jsonSimilarity({ a: '1' }, { a: '2' });
    await jsonSimilarity({ a: '3' }, { a: '4' });
    expect(getEmbeddingVectorCacheSizeForTests()).toBe(0);
    expect(getEmbeddingForwardPassCountForTests()).toBe(2);
  });
});
