/**
 * Report feature extraction + deterministic embeddings (TS). Numerical analysis runs in Python (see report_worker_client).
 */

import { createHash } from 'crypto';
import type Example from '../common/types/Example.js';
import type Span from '../common/types/Span.js';
import { getSpanInput, getSpanOutput } from '../common/types/Span.js';
import type { ReportKind } from '../common/types/Report.js';

export type ExampleFeatureTarget = 'example_input' | 'example_spans';
export type SpanFeatureTarget = 'span_input' | 'span_output';

export interface NormalisedReportParams {
  embeddingDimensions: number;
  pcaDimensions: number;
  clusterCount: number;
  sampleLimit: number;
  timeRangeStart?: number;
  timeRangeEnd?: number;
  spanSearchQuery?: string;
  featureTargetExamples: ExampleFeatureTarget;
  featureTargetSpans: SpanFeatureTarget;
}

export const DEFAULT_REPORT_PARAMS: Omit<NormalisedReportParams, 'featureTargetExamples' | 'featureTargetSpans'> = {
  embeddingDimensions: 32,
  pcaDimensions: 8,
  clusterCount: 4,
  sampleLimit: 500,
};

/** Stable L2-normalised pseudo-embedding for tests and offline runs (no external API). */
export function deterministicEmbedding(text: string, dimensions: number): number[] {
  const h = createHash('sha256').update(text, 'utf8').digest();
  const vec: number[] = [];
  for (let j = 0; j < dimensions; j++) {
    const o = (j * 4) % h.length;
    const u =
      h[o] | (h[(o + 1) % h.length] << 8) | (h[(o + 2) % h.length] << 16) | (h[(o + 3) % h.length] << 24);
    vec.push((u >>> 0) / 0xffffffff - 0.5);
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

export function serialiseForEmbedding(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function textForExample(example: Example, target: ExampleFeatureTarget): string {
  if (target === 'example_spans') return serialiseForEmbedding(example.spans);
  return serialiseForEmbedding(example.input);
}

export function textForSpan(span: Span, target: SpanFeatureTarget): string {
  if (target === 'span_output') return serialiseForEmbedding(getSpanOutput(span));
  return serialiseForEmbedding(getSpanInput(span));
}

export function monthBucketKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function normaliseReportParams(
  kind: ReportKind,
  raw?: Record<string, unknown>
): NormalisedReportParams {
  const r = raw || {};
  const num = (k: string, def: number) => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : def;
  };
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined);

  const fe = str('featureTargetExamples');
  const fs = str('featureTargetSpans');
  const featureTargetExamples: ExampleFeatureTarget =
    fe === 'example_spans' ? 'example_spans' : 'example_input';
  const featureTargetSpans: SpanFeatureTarget = fs === 'span_output' ? 'span_output' : 'span_input';

  const trs = r.timeRangeStart;
  const tre = r.timeRangeEnd;
  return {
    ...DEFAULT_REPORT_PARAMS,
    embeddingDimensions: Math.max(4, Math.floor(num('embeddingDimensions', DEFAULT_REPORT_PARAMS.embeddingDimensions))),
    pcaDimensions: Math.max(2, Math.floor(num('pcaDimensions', DEFAULT_REPORT_PARAMS.pcaDimensions))),
    clusterCount: Math.max(2, Math.floor(num('clusterCount', DEFAULT_REPORT_PARAMS.clusterCount))),
    sampleLimit: Math.max(10, Math.floor(num('sampleLimit', DEFAULT_REPORT_PARAMS.sampleLimit))),
    timeRangeStart: typeof trs === 'number' && Number.isFinite(trs) ? trs : undefined,
    timeRangeEnd: typeof tre === 'number' && Number.isFinite(tre) ? tre : undefined,
    spanSearchQuery: str('spanSearchQuery'),
    featureTargetExamples: kind === 'drift' ? 'example_input' : featureTargetExamples,
    featureTargetSpans,
  };
}

export interface EmbeddingPoint {
  embedding: number[];
  /** Drift: month bucket `YYYY-MM`. Coverage: `example` or `trace`. */
  groupKey: string;
  /** For exemplar labelling */
  ref?: { kind: 'example' | 'span'; id: string; preview: string };
}

export interface ReportAnalysisOutput {
  summary: Record<string, unknown>;
  results: Record<string, unknown>;
}
