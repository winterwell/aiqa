/**
 * Archive script: snapshot Datasets and Examples that have been inactive for
 * at least ARCHIVE_INTERVAL_MINUTES.
 *
 * Usage:
 *   node dist/scripts/archive-datasets.js
 *
 * Environment variables:
 *   DATABASE_URL or PGHOST/PGDATABASE/etc  – PostgreSQL connection
 *   ELASTICSEARCH_URL (default: http://localhost:9200)
 *   ARCHIVE_INTERVAL_MINUTES (default: 15)
 *
 * The script:
 *   1. Finds datasets that need archiving (changed since last archive and inactive
 *      for at least the interval).
 *   2. For each dataset:
 *      a. Archives the dataset itself (datasets_archive).
 *      b. Archives each example that is new or has changed since the last archive
 *         (aiqa_dataset_examples_archive ES index).
 *      c. Records an archive_version row to mark completion.
 *   3. The job is idempotent: re-running is a no-op when nothing has changed.
 *      It is retryable: if interrupted, the next run will pick up where it left
 *      off because archive_version is written last.
 */

import dotenv from 'dotenv';
import {
  initPool,
  closePool,
  listOrganisations,
} from '../src/db/db_sql.js';
import {
  initClient,
  closeClient,
  searchExamples,
  DATASET_EXAMPLES_INDEX_ALIAS,
} from '../src/db/db_es.js';
import {
  findDatasetsToArchive,
  createDatasetArchive,
  getLastArchiveVersion,
  createArchiveVersion,
  bulkInsertArchivedExamples,
} from '../src/db/db_archive.js';
import { getDataset } from '../src/db/db_sql.js';

dotenv.config();

const ARCHIVE_INTERVAL_MINUTES = parseInt(
  process.env.ARCHIVE_INTERVAL_MINUTES || '15',
  10,
);

async function archiveDataset(
  datasetId: string,
  organisation: string,
  archivedAt: Date,
  lastArchive: Date | null,
): Promise<void> {
  // 1. Fetch live dataset
  const dataset = await getDataset(datasetId);
  if (!dataset) {
    // Dataset was deleted – record a deleted archive entry
    console.log(`  Dataset ${datasetId} not found (deleted?); skipping.`);
    return;
  }

  // 2. Archive the dataset
  await createDatasetArchive(datasetId, organisation, dataset, archivedAt, false);

  // 3. Archive examples that are new or changed since last archive
  //    Fetch all examples for the dataset (paginated to handle large sets)
  const PAGE_SIZE = 500;
  let offset = 0;
  let processed = 0;

  while (true) {
    const { hits, total } = await searchExamples(
      null,
      organisation,
      datasetId,
      PAGE_SIZE,
      offset,
    );

    const toArchive = lastArchive
      ? hits.filter((ex) => {
          const updated =
            ex.updated instanceof Date ? ex.updated : new Date(ex.updated as any);
          return updated > lastArchive;
        })
      : hits;

    if (toArchive.length > 0) {
      await bulkInsertArchivedExamples(toArchive, archivedAt);
      processed += toArchive.length;
    }

    offset += hits.length;
    if (offset >= total) break;
  }

  if (processed > 0) {
    console.log(`  Archived ${processed} example(s) for dataset ${datasetId}`);
  }
}

async function main(): Promise<void> {
  const pgConnectionString = process.env.DATABASE_URL;
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

  console.log(
    `Initializing connections (interval: ${ARCHIVE_INTERVAL_MINUTES} min)...`,
  );
  initPool(pgConnectionString);
  initClient(esUrl);

  try {
    const datasets = await findDatasetsToArchive(ARCHIVE_INTERVAL_MINUTES);
    console.log(`Found ${datasets.length} dataset(s) to archive`);

    const archivedAt = new Date();

    for (const ds of datasets) {
      console.log(
        `Archiving dataset ${ds.id} (${ds.name}) – last archive: ${ds.lastArchive ?? 'never'}`,
      );
      try {
        await archiveDataset(ds.id, ds.organisation, archivedAt, ds.lastArchive);
        await createArchiveVersion(ds.id, ds.organisation, archivedAt);
        console.log(`  Done.`);
      } catch (err: any) {
        console.error(`  Error archiving dataset ${ds.id}: ${err.message}`);
        // Continue with next dataset so one failure doesn't block others
      }
    }

    console.log('Archive job complete.');
  } finally {
    await closePool();
    await closeClient();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
