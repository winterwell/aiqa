/**
 * Elasticsearch migration script for Span index.
 * 
 * Creates a new index with the updated schema mapping based on Span.ts type,
 * migrates data from the old index to the new index, and updates aliases.
 * 
 * This migration:
 *   1. Creates a new versioned index (e.g., aiqa_spans_v2) with the new mapping
 *   2. Reindexes all data from the old index to the new index
 *   3. Updates the alias to point to the new index
 *   4. Optionally keeps or deletes the old index
 * 
 * Usage:
 *   node dist/db/es_migration_examples.js
 * 
 * Environment variables:
 *   - ELASTICSEARCH_URL (default: http://localhost:9200)
 *   - SPANS_INDEX (default: aiqa_spans)
 *   - SPANS_INDEX_ALIAS (default: aiqa_spans_alias)
 *   - DELETE_OLD_INDEX (default: false) - Set to 'true' to delete old index after migration
 * 
 * The migration is idempotent - safe to run multiple times.
 */

import dotenv from 'dotenv';
import { Client } from '@elastic/elasticsearch';
import { initClient, getClient, closeClient } from './db_es.js';
import { generateExampleMappings } from './db_es_init.js';

dotenv.config();

const INDEX_ALIAS = process.env.DATASET_EXAMPLES_INDEX_ALIAS || 'aiqa_dataset_examples_alias';
const DELETE_OLD_INDEX = process.env.DELETE_OLD_INDEX === 'true';

// Generate new index name with version suffix
function getNewIndexName(oldIndexName: string): string {
  // Extract base name (without version suffix if present)
  const baseName = oldIndexName.replace(/_v\d+$/, '');
  // Find next available version
  let version = 2;
  let newIndexName = `${baseName}_v${version}`;
  
  // If old index already has a version, increment it
  const versionMatch = oldIndexName.match(/_v(\d+)$/);
  if (versionMatch) {
    version = parseInt(versionMatch[1], 10) + 1;
    newIndexName = `${baseName}_v${version}`;
  }
  
  return newIndexName;
}

/**
 * Get the actual index name that an alias points to.
 */
async function getIndexFromAlias(client: Client, alias: string): Promise<string | null> {
  try {
    const aliasInfo = await client.indices.getAlias({ name: alias });
    if (aliasInfo && typeof aliasInfo === 'object' && !Array.isArray(aliasInfo)) {
      const indices = Object.keys(aliasInfo);
      if (indices.length > 0) {
        return indices[0];
      }
    }
  } catch (error: any) {
    if (error.meta?.statusCode !== 404) {
      throw error;
    }
  }
  return null;
}

/**
 * Create a new index with the updated mapping.
 */
async function createNewIndex(client: Client, indexName: string, mappings: any): Promise<void> {
  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    console.log(`Index ${indexName} already exists. Skipping creation.`);
    return;
  }

  await client.indices.create({
    index: indexName,
    body: {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        'mapping.total_fields.limit': 1000,
        'mapping.depth.limit': 20,
      },
      mappings: {
        properties: mappings,
        dynamic: false
      }
    }
  });
  
  console.log(`Created new index: ${indexName}`);
}

/**
 * Reindex data from old index to new index.
 */
async function reindexData(
  client: Client,
  sourceIndex: string,
  destIndex: string
): Promise<void> {
  console.log(`Reindexing data from ${sourceIndex} to ${destIndex}...`);
  
  // Check if source index exists
  const sourceExists = await client.indices.exists({ index: sourceIndex });
  if (!sourceExists) {
    console.log(`Source index ${sourceIndex} does not exist. Nothing to migrate.`);
    return;
  }

  // Get document count from source
  const sourceCount = await client.count({ index: sourceIndex });
  const totalDocs = sourceCount.count;
  
  if (totalDocs === 0) {
    console.log(`Source index ${sourceIndex} is empty. Nothing to migrate.`);
    return;
  }

  console.log(`Found ${totalDocs} documents to migrate.`);

  // Use reindex API for efficient bulk copy
  const reindexResponse = await client.reindex({
    wait_for_completion: true,
    refresh: true,
    body: {
      source: {
        index: sourceIndex
      },
      dest: {
        index: destIndex
      }
    }
  });

  if (reindexResponse.failures && reindexResponse.failures.length > 0) {
    console.warn(`Reindex completed with ${reindexResponse.failures.length} failures:`);
    reindexResponse.failures.slice(0, 10).forEach((failure: any) => {
      console.warn(`  - ${failure.index}: ${failure.error?.reason || 'Unknown error'}`);
    });
    if (reindexResponse.failures.length > 10) {
      console.warn(`  ... and ${reindexResponse.failures.length - 10} more failures`);
    }
  }

  const destCount = await client.count({ index: destIndex });
  console.log(`Reindex completed. Migrated ${destCount.count} documents to ${destIndex}.`);
}

/**
 * Update alias to point to the new index.
 */
async function updateAlias(
  client: Client,
  alias: string,
  newIndex: string,
  oldIndex?: string | null
): Promise<void> {
  console.log(`Updating alias ${alias} to point to ${newIndex}...`);

  const actions: any[] = [];
  
  // Remove alias from old index if it exists
  if (oldIndex) {
    const oldIndexExists = await client.indices.exists({ index: oldIndex });
    if (oldIndexExists) {
      actions.push({ remove: { index: oldIndex, alias } });
    }
  } else {
    // Try to find any existing indices with this alias
    try {
      const aliasInfo = await client.indices.getAlias({ name: alias });
      if (aliasInfo && typeof aliasInfo === 'object' && !Array.isArray(aliasInfo)) {
        const indices = Object.keys(aliasInfo);
        indices.forEach(index => {
          if (index !== newIndex) {
            actions.push({ remove: { index, alias } });
          }
        });
      }
    } catch (error: any) {
      if (error.meta?.statusCode !== 404) {
        throw error;
      }
    }
  }
  
  // Add alias to new index
  actions.push({ add: { index: newIndex, alias } });
  
  // Update aliases atomically
  await client.indices.updateAliases({ body: { actions } });
  console.log(`Alias ${alias} now points to ${newIndex}`);
}

/**
 * Delete the old index (optional, for cleanup).
 */
async function deleteOldIndex(client: Client, indexName: string): Promise<void> {
  const indexExists = await client.indices.exists({ index: indexName });
  if (!indexExists) {
    console.log(`Old index ${indexName} does not exist. Nothing to delete.`);
    return;
  }

  console.log(`Deleting old index ${indexName}...`);
  await client.indices.delete({ index: indexName });
  console.log(`Deleted old index ${indexName}`);
}

/**
 * Main migration function.
 */
async function migrateSpanIndex(): Promise<void> {
  const client = getClient();
  
  // Get the current index name (either from alias or use SPAN_INDEX directly)
  let currentIndexName: string | null = null;
  
  try {
    currentIndexName = await getIndexFromAlias(client, INDEX_ALIAS);
  } catch (error: any) {
    console.error(`Could not get index from alias ${INDEX_ALIAS}:`, error.message);
    return;
  }
  
 
  console.log(`Current index: ${currentIndexName}`);
  
  // Generate new index name
  const newIndexName = getNewIndexName(currentIndexName);
  console.log(`New index name: ${newIndexName}`);

  // Check if new index already exists (migration already run)
  const newIndexExists = await client.indices.exists({ index: newIndexName });
  if (newIndexExists) {
    console.log(`New index ${newIndexName} already exists. Checking if migration is complete...`);
    
    // Check if alias already points to new index
    const aliasIndex = await getIndexFromAlias(client, INDEX_ALIAS);
    if (aliasIndex === newIndexName) {
      console.log('Migration already complete. Alias points to new index.');
      
      // Optionally delete old index if requested
      if (DELETE_OLD_INDEX && currentIndexName !== newIndexName) {
        await deleteOldIndex(client, currentIndexName);
      }
      return;
    } else {
      console.log('New index exists but alias not updated. Updating alias...');
      await updateAlias(client, INDEX_ALIAS, newIndexName, currentIndexName);
      
      if (DELETE_OLD_INDEX && currentIndexName !== newIndexName) {
        await deleteOldIndex(client, currentIndexName);
      }
      return;
    }
  }

  // Generate new mappings
  console.log('Generating new mappings from Example + Span schemas...');
  const mappings = generateExampleMappings();

  // Create new index
  await createNewIndex(client, newIndexName, mappings);

  // Reindex data
  await reindexData(client, currentIndexName, newIndexName);

  // Update alias
  await updateAlias(client, INDEX_ALIAS, newIndexName, currentIndexName);

  // Optionally delete old index
  if (DELETE_OLD_INDEX && currentIndexName !== newIndexName) {
    await deleteOldIndex(client, currentIndexName);
  } else if (currentIndexName !== newIndexName) {
    console.log(`Old index ${currentIndexName} kept for safety. Set DELETE_OLD_INDEX=true to delete it.`);
  }

  console.log('\nMigration completed successfully!');
}

/**
 * Main entry point.
 */
async function main() {
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

  console.log('Initializing Elasticsearch client...');
  initClient(esUrl);

  try {
    // Check if Elasticsearch is available
    const client = getClient();
    await client.ping();
    console.log('Connected to Elasticsearch\n');

    await migrateSpanIndex();
  } catch (error: any) {
    console.error('Migration failed:', error.message);
    if (error.meta) {
      console.error('Elasticsearch error details:', JSON.stringify(error.meta, null, 2));
    }
    process.exit(1);
  } finally {
    await closeClient();
  }
}

// Run if executed directly (when compiled to JS and run via node)
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { migrateSpanIndex };

