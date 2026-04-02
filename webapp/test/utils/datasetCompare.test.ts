import { describe, it, expect } from 'vitest';
import {
  compareDatasetExamples,
  compareDatasetMetrics,
  metricContentKey,
  exampleContentKey,
  exampleInputKey,
  stableStringify,
} from '../../src/utils/datasetCompare';
import type Metric from '../../src/common/types/Metric';
import type Example from '../../src/common/types/Example';

const baseMetric = (over: Partial<Metric>): Metric => ({
  id: 'm1',
  type: 'number',
  ...over,
});

describe('datasetCompare', () => {
  it('stableStringify is order-independent for objects', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('identical metrics match by content ignoring id', () => {
    const a = [baseMetric({ id: 'a', name: 'Latency', unit: 'ms' })];
    const b = [baseMetric({ id: 'b', name: 'Latency', unit: 'ms' })];
    const r = compareDatasetMetrics(a, b);
    expect(r.identical).toHaveLength(1);
    expect(r.similar).toHaveLength(0);
    expect(r.onlyA).toHaveLength(0);
    expect(r.onlyB).toHaveLength(0);
  });

  it('similar metrics: same name, different definition', () => {
    const a = [baseMetric({ id: 'a', name: 'Score', unit: 'ms' })];
    const b = [baseMetric({ id: 'b', name: 'Score', unit: 's' })];
    const r = compareDatasetMetrics(a, b);
    expect(r.identical).toHaveLength(0);
    expect(r.similar).toHaveLength(1);
    expect(metricContentKey(a[0]!)).not.toBe(metricContentKey(b[0]!));
  });

  it('identical examples ignore id', () => {
    const exBase = {
      dataset: 'd1',
      organisation: 'o1',
      created: new Date('2020-01-01'),
      updated: new Date('2020-01-02'),
      input: 'hello',
    };
    const ea = { ...exBase, id: 'e1' } as Example;
    const eb = { ...exBase, id: 'e2', dataset: 'd2' } as Example;
    const r = compareDatasetExamples([ea], [eb]);
    expect(r.identical).toHaveLength(1);
    expect(exampleContentKey(ea)).toBe(exampleContentKey(eb));
  });

  it('same input different notes: not identical; similar[] is empty (semantic is client-side)', () => {
    const base = {
      organisation: 'o1',
      created: new Date('2020-01-01'),
      updated: new Date('2020-01-02'),
      input: 'same',
    };
    const ea = { ...base, id: 'e1', dataset: 'd1', notes: 'a' } as Example;
    const eb = { ...base, id: 'e2', dataset: 'd2', notes: 'b' } as Example;
    expect(exampleInputKey(ea)).toBe(exampleInputKey(eb));
    expect(exampleContentKey(ea)).not.toBe(exampleContentKey(eb));
    const r = compareDatasetExamples([ea], [eb]);
    expect(r.identical).toHaveLength(0);
    expect(r.similar).toHaveLength(0);
    expect(r.onlyA).toHaveLength(1);
    expect(r.onlyB).toHaveLength(1);
  });
});
