/**
 * Report entity (PostgreSQL). Heavy fields use JSON objects; see ReportParameters / result shapes in report_analysis.ts.
 */
export type ReportKind = 'drift' | 'coverage';

export type ReportStatus = 'draft' | 'processing' | 'active' | 'error';

export default interface Report {
  id: string;
  organisation: string;
  kind: ReportKind;
  name?: string;
  status?: ReportStatus;
  /** Dataset id — required to run coverage reports. */
  dataset?: string;
  parameters?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  results?: Record<string, unknown>;
  created: Date;
  updated: Date;
}
