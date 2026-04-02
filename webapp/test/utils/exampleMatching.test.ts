import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Example from '../../src/common/types/Example';
import { matchExamplesByEquality, matchExamplesOneToOneAsync } from '../../src/utils/exampleMatching';
import { resetSimilarityEmbedderForTests } from '../../src/utils/similarity';

vi.mock('../../src/utils/similarity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/similarity')>();
  return {
    ...actual,
    jsonSimilarity: vi.fn(async (_a: unknown, _b: unknown) => ({
      score: 0.8,
      method: 'embedding' as const,
    })),
  };
});

const ex = (id: string, over: Partial<Example> = {}): Example =>
  ({
    id,
    dataset: 'd',
    organisation: 'o',
    created: new Date(),
    updated: new Date(),
    input: 'x',
    ...over,
  }) as Example;

describe('exampleMatching', () => {
  beforeEach(() => {
    resetSimilarityEmbedderForTests();
    vi.clearAllMocks();
  });

  it('matchExamplesByEquality zips 1:1 per content key and leaves remainder', () => {
    const a1 = ex('a1', { input: 'same' });
    const a2 = ex('a2', { input: 'same' });
    const a3 = ex('a3', { input: 'other' });
    const b1 = ex('b1', { input: 'same' });
    const b2 = ex('b2', { input: 'lonely' });

    const { identical, remainingA, remainingB } = matchExamplesByEquality([a1, a2, a3], [b1, b2]);
    expect(identical).toHaveLength(1);
    expect(identical[0]!.exampleA.id).toBe('a1');
    expect(identical[0]!.exampleB.id).toBe('b1');
    expect(remainingA.map((e) => e.id).sort()).toEqual(['a2', 'a3']);
    expect(remainingB.map((e) => e.id).sort()).toEqual(['b2']);
  });

  it('matchExamplesOneToOneAsync pairs similar above threshold greedily', async () => {
    const { jsonSimilarity } = await import('../../src/utils/similarity');
    const ja = ex('ja', { input: 'hello' });
    const jb = ex('jb', { input: 'hello world' });

    vi.mocked(jsonSimilarity).mockResolvedValueOnce({ score: 0.9, method: 'embedding' });

    const r = await matchExamplesOneToOneAsync([ja], [jb]);
    expect(r.identical).toHaveLength(0);
    expect(r.similar).toHaveLength(1);
    expect(r.similar[0]!.score).toBeGreaterThanOrEqual(0.75);
    expect(r.onlyA).toHaveLength(0);
    expect(r.onlyB).toHaveLength(0);
  });
});
