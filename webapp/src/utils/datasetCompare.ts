import type Example from '../common/types/Example';
import type Metric from '../common/types/Metric';
import { getExampleInput } from './example-utils';

/** JSON.stringify with sorted object keys for stable comparison. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Metric definition for equality (ids may differ across dataset copies). */
export function normalizeMetricForCompare(m: Metric): Record<string, unknown> {
  const {
    name,
    description,
    unit,
    type,
    specific,
    provider,
    model,
    prompt,
    promptCriteria,
    code,
    value,
    parameters,
  } = m;
  return {
    // name: name ?? null, skip name for compare
    description: description ?? null,
    unit: unit ?? null,
    type,
    specific: specific ?? null,
    provider: provider ?? null,
    model: model ?? null,
    prompt: prompt ?? null,
    promptCriteria: promptCriteria ?? null,
    code: code ?? null,
    value: value ?? null,
    parameters: parameters ?? null,
  };
}

export function metricContentKey(m: Metric): string {
  return stableStringify(normalizeMetricForCompare(m));
}

function metricDisplayName(m: Metric): string {
  return (m.name || m.id || '').trim().toLowerCase();
}

/**
 * Example payload for 1:1 dataset matching: **metrics omitted** (and id/dataset never included).
 * Use for equality + embedding similarity between examples.
 */
export function normalizeExampleForMatching(ex: Example): Record<string, unknown> {
  const { name, notes, tags, annotations, spans, input, outputs, metrics } = ex;
  return {
    name: name ?? null,
    notes: notes ?? null,
    tags: tags ? [...tags].sort() : null,
    annotations: annotations ?? null,
    spans: spans ?? null,
    input: input ?? null,
    outputs: outputs ?? null,
    metrics: metrics ?? null, // specific metrics are an important part of defining an example
  };
}

export function exampleMatchingContentKey(ex: Example): string {
  return stableStringify(normalizeExampleForMatching(ex));
}

/** Example payload for table/detail compare (includes per-example metrics). */
export function normalizeExampleForCompare(ex: Example): Record<string, unknown> {
  const { name, notes, tags, annotations, spans, input, outputs, metrics } = ex;
  const sortedMetrics =
    Array.isArray(metrics) && metrics.length > 0
      ? [...metrics]
          .map((x) => normalizeMetricForCompare(x))
          .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
      : null;
  return {
    name: name ?? null,
    notes: notes ?? null,
    tags: tags ? [...tags].sort() : null,
    annotations: annotations ?? null,
    spans: spans ?? null,
    input: input ?? null,
    outputs: outputs ?? null,
    metrics: sortedMetrics,
  };
}

export function exampleContentKey(ex: Example): string {
  return stableStringify(normalizeExampleForCompare(ex));
}

export function exampleInputKey(ex: Example): string {
  const inp = getExampleInput(ex);
  return stableStringify(inp);
}

export type MetricPair = { metricA: Metric; metricB: Metric };
export type ExamplePair = { exampleA: Example; exampleB: Example };

export type CompareMetricsResult = {
  identical: MetricPair[];
  similar: MetricPair[];
  onlyA: Metric[];
  onlyB: Metric[];
};

/**
 * Compares user-defined dataset metrics (not system defaults).
 * Identical: same definition ignoring id. Similar: same display name (case-insensitive) but different definition.
 */
export function compareDatasetMetrics(metricsA: Metric[], metricsB: Metric[]): CompareMetricsResult {
  const listA = metricsA ?? [];
  const listB = metricsB ?? [];

  const identical: MetricPair[] = [];
  const similar: MetricPair[] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();

  for (let i = 0; i < listA.length; i++) {
    if (usedA.has(i)) continue;
    const ka = metricContentKey(listA[i]!);
    for (let j = 0; j < listB.length; j++) {
      if (usedB.has(j)) continue;
      if (metricContentKey(listB[j]!) === ka) {
        identical.push({ metricA: listA[i]!, metricB: listB[j]! });
        usedA.add(i);
        usedB.add(j);
        break;
      }
    }
  }

  for (let i = 0; i < listA.length; i++) {
    if (usedA.has(i)) continue;
    const ma = listA[i]!;
    const na = metricDisplayName(ma);
    if (!na) continue;
    for (let j = 0; j < listB.length; j++) {
      if (usedB.has(j)) continue;
      const mb = listB[j]!;
      if (metricContentKey(ma) === metricContentKey(mb)) continue;
      if (na !== metricDisplayName(mb)) continue;
      similar.push({ metricA: ma, metricB: mb });
      usedA.add(i);
      usedB.add(j);
      break;
    }
  }

  const onlyA = listA.filter((_, i) => !usedA.has(i));
  const onlyB = listB.filter((_, j) => !usedB.has(j));

  return { identical, similar, onlyA, onlyB };
}

export type CompareExamplesResult = {
  identical: ExamplePair[];
  similar: ExamplePair[];
  onlyA: Example[];
  onlyB: Example[];
};

/**
 * Identical: same content ignoring id/dataset/timestamps.
 * `similar` is left empty; semantic similarity is computed client-side (see `similarity.ts`).
 */
export function compareDatasetExamples(examplesA: Example[], examplesB: Example[]): CompareExamplesResult {
  const listA = examplesA ?? [];
  const listB = examplesB ?? [];

  const identical: ExamplePair[] = [];
  const similar: ExamplePair[] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();

  for (let i = 0; i < listA.length; i++) {
    if (usedA.has(i)) continue;
    const ka = exampleContentKey(listA[i]!);
    for (let j = 0; j < listB.length; j++) {
      if (usedB.has(j)) continue;
      if (exampleContentKey(listB[j]!) === ka) {
        identical.push({ exampleA: listA[i]!, exampleB: listB[j]! });
        usedA.add(i);
        usedB.add(j);
        break;
      }
    }
  }

  const onlyA = listA.filter((_, i) => !usedA.has(i));
  const onlyB = listB.filter((_, j) => !usedB.has(j));

  return { identical, similar, onlyA, onlyB };
}
