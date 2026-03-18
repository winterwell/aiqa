/**
 * Tests for archive functionality: datasets_archive, archive_version (Postgres),
 * and aiqa_dataset_examples_archive (Elasticsearch).
 */

import dotenv from 'dotenv';
import tap from 'tap';
import { randomUUID } from 'node:crypto';

dotenv.config();

// ---------------------------------------------------------------------------
// Postgres archive tests
// ---------------------------------------------------------------------------
tap.test('Archive: Postgres datasets_archive and archive_version', async (t) => {
  const {
    initPool,
    createTables,
    closePool,
    createOrganisation,
    createDataset,
    deleteDataset,
    deleteOrganisation,
  } = await import('../dist/db/db_sql.js');

  const {
    createDatasetArchive,
    getDatasetAtTime,
    createArchiveVersion,
    getLastArchiveVersion,
    findDatasetsToArchive,
  } = await import('../dist/db/db_archive.js');

  const pgConnectionString =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}/${process.env.PGDATABASE}?sslmode=${process.env.PGSSLMODE || 'require'}`;

  let dbAvailable = true;
  try {
    initPool(pgConnectionString);
    await createTables();
  } catch (_e) {
    dbAvailable = false;
  }

  if (!dbAvailable) {
    t.skip('Database not available');
    await closePool();
    return;
  }

  // Create test org + dataset
  const org = await createOrganisation({ name: `Archive Test Org ${randomUUID()}`, members: [] });
  const dataset = await createDataset({ organisation: org.id, name: `Archive Test Dataset ${randomUUID()}` });

  t.test('createDatasetArchive stores a snapshot', async (st) => {
    const archivedAt = new Date();
    const archive = await createDatasetArchive(dataset.id, org.id, dataset, archivedAt, false);
    st.ok(archive.id, 'archive row has an id');
    st.equal(archive.datasetId, dataset.id, 'datasetId matches');
    st.equal(archive.deleted, false, 'deleted is false');
    st.ok(archive.data, 'data is present');
    st.equal(archive.data.name, dataset.name, 'archived name matches');
  });

  t.test('getDatasetAtTime returns the best snapshot', async (st) => {
    const t0 = new Date('2000-01-01T00:00:00Z');
    const t1 = new Date('2000-06-01T00:00:00Z');
    const t2 = new Date('2000-12-01T00:00:00Z');

    // Archive two snapshots with different names
    const ds2 = await createDataset({ organisation: org.id, name: `Timeline DS ${randomUUID()}` });
    const snap1 = { ...ds2, name: 'v1' };
    const snap2 = { ...ds2, name: 'v2' };

    await createDatasetArchive(ds2.id, org.id, snap1 as any, t1, false);
    await createDatasetArchive(ds2.id, org.id, snap2 as any, t2, false);

    // Before any archive → null
    const beforeAny = await getDatasetAtTime(ds2.id, t0);
    st.equal(beforeAny, null, 'no archive before t0');

    // Between t1 and t2 → v1
    const between = await getDatasetAtTime(ds2.id, new Date('2000-09-01T00:00:00Z'));
    st.ok(between, 'found archived snapshot');
    st.equal(between!.name, 'v1', 'snapshot at mid-point is v1');

    // After t2 → v2
    const after = await getDatasetAtTime(ds2.id, new Date('2001-01-01T00:00:00Z'));
    st.equal(after!.name, 'v2', 'latest snapshot is v2');

    // Cleanup
    await deleteDataset(ds2.id);
  });

  t.test('getDatasetAtTime returns null for deleted snapshot', async (st) => {
    const ds3 = await createDataset({ organisation: org.id, name: `Deleted DS ${randomUUID()}` });
    const archivedAt = new Date('2001-01-01T00:00:00Z');
    await createDatasetArchive(ds3.id, org.id, ds3 as any, archivedAt, true);

    const result = await getDatasetAtTime(ds3.id, new Date('2002-01-01T00:00:00Z'));
    st.equal(result, null, 'deleted snapshot returns null');

    await deleteDataset(ds3.id);
  });

  t.test('createArchiveVersion and getLastArchiveVersion', async (st) => {
    const none = await getLastArchiveVersion(dataset.id);
    st.equal(none, null, 'no version before first archive');

    const v1 = await createArchiveVersion(dataset.id, org.id, new Date('2021-01-01T00:00:00Z'));
    st.ok(v1.id, 'archive version has id');
    st.equal(v1.datasetId, dataset.id);

    const v2 = await createArchiveVersion(dataset.id, org.id, new Date('2021-06-01T00:00:00Z'));
    const last = await getLastArchiveVersion(dataset.id);
    st.equal(last!.id, v2.id, 'getLastArchiveVersion returns the most recent');
  });

  t.test('findDatasetsToArchive respects interval', async (st) => {
    // Create a dataset with updated in the far past (needs archiving, never archived)
    const oldDs = await createDataset({ organisation: org.id, name: `Old DS ${randomUUID()}` });
    // Force updated to 2 hours ago via raw SQL
    const { doQuery } = await import('../dist/db/db_sql.js');
    await doQuery(`UPDATE datasets SET updated = NOW() - INTERVAL '2 hours' WHERE id = $1`, [oldDs.id]);

    const toArchive = await findDatasetsToArchive(15);
    const found = toArchive.find((d: any) => d.id === oldDs.id);
    st.ok(found, 'old dataset should appear in findDatasetsToArchive');

    // After creating an archive_version, it should no longer appear (last_archive >= updated)
    await createArchiveVersion(oldDs.id, org.id, new Date());
    const toArchive2 = await findDatasetsToArchive(15);
    const found2 = toArchive2.find((d: any) => d.id === oldDs.id);
    st.notOk(found2, 'dataset should not appear after being archived');

    await deleteDataset(oldDs.id);
  });

  // Cleanup
  await deleteDataset(dataset.id);
  await deleteOrganisation(org.id);
  await closePool();
});

// ---------------------------------------------------------------------------
// Elasticsearch archive tests
// ---------------------------------------------------------------------------
tap.test('Archive: Elasticsearch example archive', async (t) => {
  const { initClient, closeClient, checkElasticsearchAvailable, createIndices } = await import('../dist/db/db_es.js');
  const {
    bulkInsertArchivedExamples,
    getArchivedExamples,
    getArchivedExample,
  } = await import('../dist/db/db_archive.js');

  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  initClient(esUrl);

  const isAvailable = await checkElasticsearchAvailable();
  if (!isAvailable) {
    t.skip('Elasticsearch not available');
    await closeClient();
    return;
  }

  await createIndices();

  const orgId = `archive_test_org_${randomUUID()}`;
  const datasetId = randomUUID();
  const exampleId1 = randomUUID();
  const exampleId2 = randomUUID();

  const now = new Date();
  const past = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
  const archiveTime = new Date(now.getTime() - 30 * 60 * 1000); // 30m ago

  const example1v1: any = {
    id: exampleId1,
    dataset: datasetId,
    organisation: orgId,
    name: 'Example 1 v1',
    created: past,
    updated: past,
  };
  const example2: any = {
    id: exampleId2,
    dataset: datasetId,
    organisation: orgId,
    name: 'Example 2',
    created: past,
    updated: past,
  };

  t.test('bulkInsertArchivedExamples and getArchivedExamples', async (st) => {
    await bulkInsertArchivedExamples([example1v1, example2], archiveTime);

    // Query at a time after archive
    const afterArchive = new Date(archiveTime.getTime() + 1000);
    const result = await getArchivedExamples(datasetId, orgId, afterArchive, 100, 0);
    st.ok(result.hits.length >= 2, 'should return at least 2 archived examples');
    const ids = result.hits.map((h: any) => h.id);
    st.ok(ids.includes(exampleId1), 'example1 present');
    st.ok(ids.includes(exampleId2), 'example2 present');
  });

  t.test('getArchivedExamples returns empty before archive time', async (st) => {
    const beforeArchive = new Date(archiveTime.getTime() - 1000);
    const result = await getArchivedExamples(datasetId, orgId, beforeArchive, 100, 0);
    st.equal(result.hits.length, 0, 'no examples before archive time');
  });

  t.test('getArchivedExample returns latest version', async (st) => {
    const result = await getArchivedExample(exampleId1, orgId, new Date());
    st.ok(result, 'archived example found');
    st.equal(result!.id, exampleId1, 'correct example returned');
    st.equal((result as any).name, 'Example 1 v1', 'correct version');
  });

  t.test('bulkInsertArchivedExamples is idempotent (same version)', async (st) => {
    // Re-archiving the same version should not create duplicates
    await bulkInsertArchivedExamples([example1v1], archiveTime);
    const result = await getArchivedExamples(datasetId, orgId, new Date(), 100, 0);
    const ex1hits = result.hits.filter((h: any) => h.id === exampleId1);
    st.equal(ex1hits.length, 1, 'only one copy of example1 (idempotent)');
  });

  t.test('deleted examples are excluded', async (st) => {
    const deletedId = randomUUID();
    const deletedExample: any = {
      id: deletedId,
      dataset: datasetId,
      organisation: orgId,
      name: 'Deleted Example',
      created: past,
      updated: past,
      deleted: true,
    };
    await bulkInsertArchivedExamples([deletedExample], archiveTime);

    const result = await getArchivedExamples(datasetId, orgId, new Date(), 100, 0);
    const found = result.hits.find((h: any) => h.id === deletedId);
    st.notOk(found, 'deleted example should not appear in results');

    const single = await getArchivedExample(deletedId, orgId, new Date());
    st.equal(single, null, 'deleted example returns null for getArchivedExample');
  });

  await closeClient();
});
