/**
 * Loads Examples/Spans from Elasticsearch and runs embedding analysis for a Report row.
 */

import SearchQuery from '../common/SearchQuery.js';
import { searchExamples, searchSpans } from '../db/db_es.js';
import { getDataset, getReport, updateReport } from '../db/db_sql.js';
import type Report from '../common/types/Report.js';
import type Example from '../common/types/Example.js';
import type Span from '../common/types/Span.js';
import {
  deterministicEmbedding,
  EmbeddingPoint,
  monthBucketKey,
  normaliseReportParams,
  textForExample,
  textForSpan,
} from './report_analysis.js';
import { runEmbeddingAnalysis } from './report_worker_client.js';

function previewText(s: string, max = 120): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function spanTimeFilterQuery(params: ReturnType<typeof normaliseReportParams>): SearchQuery | null {
  const { timeRangeStart: a, timeRangeEnd: b } = params;
  if (a === undefined && b === undefined) return null;
  const parts: string[] = [];
  if (a !== undefined) parts.push(`start:>=${a}`);
  if (b !== undefined) parts.push(`start:<=${b}`);
  if (parts.length === 0) return null;
  return new SearchQuery(parts.join(' '));
}

function mergeSpanQuery(_organisationId: string, params: ReturnType<typeof normaliseReportParams>): SearchQuery | null {
  const tq = spanTimeFilterQuery(params);
  const extra = params.spanSearchQuery?.trim();
  if (!extra) return tq;
  const base = new SearchQuery(extra);
  if (!tq) return base;
  return SearchQuery.and(base, tq) ?? base;
}

/** Fetch spans with attributes for embedding (paged until sampleLimit). */
async function loadSpansForReport(
  organisationId: string,
  params: ReturnType<typeof normaliseReportParams>
): Promise<Span[]> {
  const q = mergeSpanQuery(organisationId, params);
  const out: Span[] = [];
  const pageSize = 100;
  let offset = 0;
  while (out.length < params.sampleLimit) {
    const { hits, total } = await searchSpans({
      searchQuery: q,
      organisation: organisationId,
      limit: pageSize,
      offset,
      _source_includes: [
        'id',
        'trace',
        'name',
        'organisation',
        'start',
        'attributes',
        'embedding_1',
        'embedding_2',
        'embeddingMeta_1',
        'embeddingMeta_2',
      ],
    });
    out.push(...hits);
    if (hits.length < pageSize || out.length >= total || out.length >= params.sampleLimit) break;
    offset += pageSize;
  }
  return out.slice(0, params.sampleLimit);
}

async function loadExamplesForDataset(
  organisationId: string,
  datasetId: string,
  limit: number
): Promise<Example[]> {
  const out: Example[] = [];
  const pageSize = 100;
  let offset = 0;
  while (out.length < limit) {
    const { hits, total } = await searchExamples(undefined, organisationId, datasetId, pageSize, offset, {
      _source_excludes: [],
    });
    out.push(...hits);
    if (hits.length < pageSize || out.length >= total || out.length >= limit) break;
    offset += pageSize;
  }
  return out.slice(0, limit);
}

function buildEmbeddingPointsForDrift(spans: Span[], params: ReturnType<typeof normaliseReportParams>): EmbeddingPoint[] {
  const dim = params.embeddingDimensions;
  const points: EmbeddingPoint[] = [];
  for (const sp of spans) {
    const t = textForSpan(sp, params.featureTargetSpans);
    const emb = deterministicEmbedding(t, dim);
    const start = typeof sp.start === 'number' ? sp.start : 0;
    const groupKey = monthBucketKey(start);
    const id = sp.id || '';
    points.push({
      embedding: emb,
      groupKey,
      ref: { kind: 'span', id, preview: previewText(t) },
    });
  }
  return points;
}

function buildEmbeddingPointsForCoverage(
  examples: Example[],
  spans: Span[],
  params: ReturnType<typeof normaliseReportParams>
): EmbeddingPoint[] {
  const dim = params.embeddingDimensions;
  const points: EmbeddingPoint[] = [];
  for (const ex of examples) {
    const t = textForExample(ex, params.featureTargetExamples);
    points.push({
      embedding: deterministicEmbedding(t, dim),
      groupKey: 'example',
      ref: { kind: 'example', id: ex.id, preview: previewText(t) },
    });
  }
  for (const sp of spans) {
    const t = textForSpan(sp, params.featureTargetSpans);
    points.push({
      embedding: deterministicEmbedding(t, dim),
      groupKey: 'trace',
      ref: { kind: 'span', id: sp.id || '', preview: previewText(t) },
    });
  }
  return points;
}

/**
 * Executes analysis for a report: sets status, writes summary/results or error.
 */
export async function executeReport(reportId: string): Promise<Report | null> {
  const report = await getReport(reportId);
  if (!report) return null;

  const params = normaliseReportParams(report.kind, report.parameters);
  await updateReport(reportId, { status: 'processing', summary: { startedAt: new Date().toISOString() } });

  try {
    if (report.kind === 'coverage') {
      if (!report.dataset) {
        throw new Error('Coverage report requires dataset id');
      }
      const ds = await getDataset(report.dataset);
      if (!ds || ds.organisation !== report.organisation) {
        throw new Error('Dataset not found or organisation mismatch');
      }
    }

    let points: EmbeddingPoint[] = [];
    if (report.kind === 'drift') {
      const spans = await loadSpansForReport(report.organisation, params);
      points = buildEmbeddingPointsForDrift(spans, params);
    } else {
      const examples = await loadExamplesForDataset(report.organisation, report.dataset!, params.sampleLimit);
      const spanBudget = Math.max(0, params.sampleLimit - examples.length);
      const spanParams = { ...params, sampleLimit: spanBudget };
      const spans = spanBudget > 0 ? await loadSpansForReport(report.organisation, spanParams) : [];
      points = buildEmbeddingPointsForCoverage(examples, spans, params);
    }

    const { summary, results } = await runEmbeddingAnalysis(report.kind, points, params);
    if (results.error === 'insufficient_data') {
      await updateReport(reportId, {
        status: 'error',
        summary: { ...summary, finishedAt: new Date().toISOString() },
        results,
      });
    } else {
      await updateReport(reportId, {
        status: 'active',
        summary: { ...summary, finishedAt: new Date().toISOString() },
        results,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateReport(reportId, {
      status: 'error',
      summary: { error: msg, finishedAt: new Date().toISOString() },
      results: { version: 1, error: 'run_failed', message: msg },
    });
  }

  return getReport(reportId);
}
