/**
 * Retention script to delete old spans based on organisation retention_period_days.
 * 
 * This script should be run periodically (e.g., via crontab) to clean up old spans.
 * 
 * Usage:
 *   node dist/scripts/delete-old-spans.js
 * 
 * Environment variables:
 *   - DATABASE_URL or PGHOST/PGDATABASE/etc (PostgreSQL connection)
 *   - ELASTICSEARCH_URL (default: http://localhost:9200)
 * 
 * The script:
 *   1. Connects to PostgreSQL and Elasticsearch
 *   2. Gets all organisations
 *   3. For each organisation, deletes spans older than retention_period_days (default: 20)
 *   4. Uses endTime (or startTime if endTime is missing) to determine span age
 */

import dotenv from 'dotenv';
import { initPool, listOrganisations, closePool } from '../src/db/db_sql.js';
import { initClient, deleteOldSpans, closeClient } from '../src/db/db_es.js';

dotenv.config();

const DEFAULT_RETENTION_DAYS = 20;

async function main() {
  const pgConnectionString = process.env.DATABASE_URL;
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

  console.log('Initializing connections...');
  initPool(pgConnectionString);
  initClient(esUrl);

  try {
    console.log('Fetching organisations...');
    const organisations = await listOrganisations();
    console.log(`Found ${organisations.length} organisations`);

    let totalDeleted = 0;
    const startTime = Date.now();

    for (const org of organisations) {
      const retentionDays = org.retention_period_days ?? DEFAULT_RETENTION_DAYS;
      console.log(`Processing organisation ${org.id} (${org.name || 'unnamed'}) - retention: ${retentionDays} days`);

      try {
        const deleted = await deleteOldSpans(org.id, retentionDays);
        totalDeleted += deleted;
        if (deleted > 0) {
          console.log(`  Deleted ${deleted} old spans`);
        }
      } catch (error: any) {
        console.error(`  Error processing organisation ${org.id}:`, error.message);
        // Continue with other organisations
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nCompleted in ${duration}s. Total spans deleted: ${totalDeleted}`);
  } catch (error: any) {
    console.error('Error running retention script:', error.message);
    process.exit(1);
  } finally {
    await closePool();
    await closeClient();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

