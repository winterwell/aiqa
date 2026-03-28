/**
 * Calls the Python report worker (FastAPI) for PCA + k-means + metrics.
 * Set REPORT_WORKER_URL (default http://127.0.0.1:8765).
 */

import type { ReportKind } from '../common/types/Report.js';
import type { EmbeddingPoint, NormalisedReportParams, ReportAnalysisOutput } from './report_analysis.js';

export function getReportWorkerBaseUrl(): string {
  return (process.env.REPORT_WORKER_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
}

export async function runEmbeddingAnalysis(
  kind: ReportKind,
  points: EmbeddingPoint[],
  params: NormalisedReportParams
): Promise<ReportAnalysisOutput> {
  const url = `${getReportWorkerBaseUrl()}/analyze`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      points,
      params: {
        pcaDimensions: params.pcaDimensions,
        clusterCount: params.clusterCount,
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Report worker HTTP ${res.status}: ${text}`);
  }
  const data = JSON.parse(text) as { summary: Record<string, unknown>; results: Record<string, unknown> };
  return { summary: data.summary, results: data.results };
}
