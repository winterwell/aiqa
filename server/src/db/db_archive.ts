/**
 * Archive operations for Dataset and Example.
 *
 * Time-bucketed archive: after ARCHIVE_INTERVAL_MINUTES of inactivity a snapshot is taken.
 * Postgres tables: datasets_archive (data), archive_version (metadata/marker).
 * Elasticsearch index: aiqa_dataset_examples_archive.
 */

import Dataset from '../common/types/Dataset.js';
import Example from '../common/types/Example.js';
import { doQuery } from './db_sql.js';
import { getClient } from './db_es.js';

export const DATASET_EXAMPLES_ARCHIVE_INDEX =
  process.env.DATASET_EXAMPLES_ARCHIVE_INDEX || 'aiqa_dataset_examples_archive';

// ---------------------------------------------------------------------------
// PostgreSQL helpers
// ---------------------------------------------------------------------------

/** Transform a raw Postgres row (datasets_archive) into a Dataset object. */
function transformDatasetArchive(row: any): DatasetArchiveRow {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    organisation: row.organisation,
    archivedAt: row.archived_at,
    deleted: row.deleted,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
  };
}

export interface DatasetArchiveRow {
  id: string;
  datasetId: string;
  organisation: string;
  archivedAt: Date;
  deleted: boolean;
  data: Dataset;
}

export interface ArchiveVersionRow {
  id: string;
  datasetId: string;
  organisation: string;
  archivedAt: Date;
}

// ---------------------------------------------------------------------------
// datasets_archive operations
// ---------------------------------------------------------------------------

/**
 * Insert a snapshot of a dataset into datasets_archive.
 * Idempotent: if a row with the same (dataset_id, archived_at) already exists it is ignored.
 */
export async function createDatasetArchive(
  datasetId: string,
  organisation: string,
  data: Dataset,
  archivedAt: Date = new Date(),
  deleted: boolean = false,
): Promise<DatasetArchiveRow> {
  const result = await doQuery<any>(
    `INSERT INTO datasets_archive (dataset_id, organisation, data, archived_at, deleted)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (dataset_id, archived_at) DO NOTHING
     RETURNING *`,
    [datasetId, organisation, JSON.stringify(data), archivedAt, deleted],
  );
  if (result.rows.length === 0) {
    // Already existed – fetch the existing row
    const existing = await doQuery<any>(
      `SELECT * FROM datasets_archive WHERE dataset_id = $1 AND archived_at = $2`,
      [datasetId, archivedAt],
    );
    return transformDatasetArchive(existing.rows[0]);
  }
  return transformDatasetArchive(result.rows[0]);
}

/**
 * Get the best archived dataset version at or before atTime.
 * Returns the latest snapshot whose archived_at <= atTime, or null if none.
 */
export async function getDatasetAtTime(
  datasetId: string,
  atTime: Date,
): Promise<Dataset | null> {
  const result = await doQuery<any>(
    `SELECT * FROM datasets_archive
     WHERE dataset_id = $1 AND archived_at <= $2
     ORDER BY archived_at DESC
     LIMIT 1`,
    [datasetId, atTime],
  );
  if (!result.rows[0]) return null;
  const row = transformDatasetArchive(result.rows[0]);
  if (row.deleted) return null;
  return row.data;
}

// ---------------------------------------------------------------------------
// archive_version operations
// ---------------------------------------------------------------------------

/**
 * Record that an archive run completed for a dataset.
 * Each successful archive operation for a dataset inserts one row.
 */
export async function createArchiveVersion(
  datasetId: string,
  organisation: string,
  archivedAt: Date = new Date(),
): Promise<ArchiveVersionRow> {
  const result = await doQuery<any>(
    `INSERT INTO archive_version (dataset_id, organisation, archived_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [datasetId, organisation, archivedAt],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    datasetId: row.dataset_id,
    organisation: row.organisation,
    archivedAt: row.archived_at,
  };
}

/**
 * Get the most recent archive_version row for a dataset.
 * Returns null if the dataset has never been archived.
 */
export async function getLastArchiveVersion(
  datasetId: string,
): Promise<ArchiveVersionRow | null> {
  const result = await doQuery<any>(
    `SELECT * FROM archive_version WHERE dataset_id = $1 ORDER BY archived_at DESC LIMIT 1`,
    [datasetId],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    datasetId: row.dataset_id,
    organisation: row.organisation,
    archivedAt: row.archived_at,
  };
}

// ---------------------------------------------------------------------------
// Find datasets that need archiving
// ---------------------------------------------------------------------------

export interface DatasetToArchive {
  id: string;
  organisation: string;
  name: string;
  updated: Date;
  lastArchive: Date | null;
}

/**
 * Return datasets whose live data has changed since the last archive and which
 * have been inactive for at least intervalMinutes.
 *
 * A dataset is inactive if it was last updated more than intervalMinutes ago.
 * A dataset needs archiving if it has never been archived OR its last archive is
 * older than its last update.
 */
export async function findDatasetsToArchive(
  intervalMinutes: number,
): Promise<DatasetToArchive[]> {
  const result = await doQuery<any>(
    `SELECT d.id, d.organisation, d.name, d.updated,
            av.last_archive
     FROM datasets d
     LEFT JOIN (
       SELECT dataset_id, MAX(archived_at) AS last_archive
       FROM archive_version
       GROUP BY dataset_id
     ) av ON av.dataset_id = d.id
     WHERE
       -- Inactive: not edited within the interval
       d.updated < NOW() - ($1 || ' minutes')::INTERVAL
       AND (
         -- Never been archived
         av.last_archive IS NULL
         OR
         -- Has edits since last archive
         d.updated > av.last_archive
       )`,
    [intervalMinutes.toString()],
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    organisation: row.organisation,
    name: row.name,
    updated: row.updated,
    lastArchive: row.last_archive ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Elasticsearch archive operations
// ---------------------------------------------------------------------------

/**
 * Archive examples into the ES archive index.
 * Each example is stored with document _id = "{exampleId}_{updated_epoch}" so that
 * archiving the same version twice is idempotent (upsert via index action).
 */
export async function bulkInsertArchivedExamples(
  examples: (Example & { deleted?: boolean })[],
  archivedAt: Date,
): Promise<void> {
  const esClient = getClient();
  if (examples.length === 0) return;

  const body = examples.flatMap((example) => {
    const updated =
      example.updated instanceof Date
        ? example.updated
        : new Date(example.updated as any);
    const docId = `${example.id}_${updated.getTime()}`;
    const doc = {
      ...example,
      archived_at: archivedAt.toISOString(),
      deleted: example.deleted ?? false,
    };
    return [
      { index: { _index: DATASET_EXAMPLES_ARCHIVE_INDEX, _id: docId } },
      doc,
    ];
  });

  const refresh =
    process.env.REFRESH_AFTER_INDEX === 'true' ? true : ('wait_for' as const);
  const response = await esClient.bulk({ body, refresh });

  if (response.errors) {
    const errors = response.items
      .map((item: any) => item.index?.error)
      .filter(Boolean);
    if (errors.length > 0) {
      throw new Error(
        `Archive bulk insert errors: ${JSON.stringify(errors).slice(0, 500)}`,
      );
    }
  }
}

/**
 * Get archived examples for a dataset at or before atTime.
 * For each example ID, returns the latest archived version with archived_at <= atTime.
 * Excludes examples whose latest archived version is marked deleted.
 */
export async function getArchivedExamples(
  datasetId: string,
  organisationId: string,
  atTime: Date,
  limit: number = 100,
  offset: number = 0,
): Promise<{ hits: Example[]; total: number }> {
  const esClient = getClient();

  // Use a composite aggregation to get the latest archived version of each example.
  // For each example id, we want the latest doc with archived_at <= atTime.
  const response = await esClient.search({
    index: DATASET_EXAMPLES_ARCHIVE_INDEX,
    body: {
      size: 0,
      query: {
        bool: {
          must: [
            { term: { dataset: datasetId } },
            { term: { organisation: organisationId } },
            { range: { archived_at: { lte: atTime.toISOString() } } },
          ],
        },
      },
      aggs: {
        by_example: {
          terms: {
            field: 'id',
            // Fetch exactly as many buckets as needed for the requested page
            size: Math.min(offset + limit, 10000),
          },
          aggs: {
            latest: {
              top_hits: {
                size: 1,
                sort: [{ archived_at: { order: 'desc' } }],
                _source: true,
              },
            },
          },
        },
        total_buckets: {
          cardinality: { field: 'id' },
        },
      },
    },
  });

  const buckets: any[] =
    (response.aggregations?.by_example as any)?.buckets ?? [];
  const total: number =
    (response.aggregations?.total_buckets as any)?.value ?? 0;

  const hits: Example[] = buckets
    .slice(offset, offset + limit)
    .map((bucket: any) => {
      const src = bucket.latest.hits.hits[0]?._source;
      return src as Example;
    })
    .filter((ex: any) => ex && !ex.deleted);

  return { hits, total };
}

/**
 * Get a single archived example at or before atTime.
 * Returns null if not found or if the latest version was deleted.
 */
export async function getArchivedExample(
  exampleId: string,
  organisationId: string,
  atTime: Date,
): Promise<Example | null> {
  const esClient = getClient();

  const response = await esClient.search({
    index: DATASET_EXAMPLES_ARCHIVE_INDEX,
    body: {
      size: 1,
      query: {
        bool: {
          must: [
            { term: { id: exampleId } },
            { term: { organisation: organisationId } },
            { range: { archived_at: { lte: atTime.toISOString() } } },
          ],
        },
      },
      sort: [{ archived_at: { order: 'desc' } }],
    },
  });

  const hit = (response.hits?.hits ?? [])[0];
  if (!hit) return null;
  const src = hit._source as any;
  if (src?.deleted) return null;
  return src as Example;
}
