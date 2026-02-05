import dotenv from 'dotenv';
import tap from 'tap';
import { initClient, createIndices, closeClient, checkElasticsearchAvailable, generateSpanMappings, getClient, SPAN_INDEX_ALIAS, DATASET_EXAMPLES_INDEX, DATASET_EXAMPLES_INDEX_ALIAS } from '../dist/db/db_es.js';
import { SPAN_INDEX } from '../dist/db/db_es_init.js';

dotenv.config();

tap.test('generateSpanMappings returns valid mappings', t => {
  const mappings = generateSpanMappings();
  t.ok(mappings && typeof mappings === 'object', 'returns an object');
  t.ok(mappings.organisation, 'has organisation field');
  t.ok(mappings.name, 'has name field');
  t.ok(mappings.start && mappings.start.type === 'long', 'start is long');
  t.ok(mappings.attributes && mappings.attributes.type === 'flattened', 'attributes is flattened');
  t.ok(mappings.unindexed_attributes && mappings.unindexed_attributes.enabled === false, 'has unindexed_attributes');
  t.end();
});


tap.test('generateSpanMappings maps Span.status.code to numeric type', t => {
  const mappings = generateSpanMappings();
  t.ok(mappings && typeof mappings === 'object', 'returns an object');
  const statusMapping = mappings.status;
  t.ok(statusMapping, 'has status field');
  t.ok(statusMapping.properties?.code && (statusMapping.properties.code.type === 'integer' || statusMapping.properties.code.type === 'long'), 'code is integer or long');
  t.end();
});

tap.test('createIndices creates indices and aliases', async t => {
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  initClient(esUrl);

  const isAvailable = await checkElasticsearchAvailable();
  if (!isAvailable) {
    t.skip('Elasticsearch not available');
    await closeClient();
    return;
  }

  await createIndices();

  const client = getClient();

  const spanIndexExists = await client.indices.exists({ index: SPAN_INDEX });
  t.ok(spanIndexExists, 'span index exists');

  const examplesIndexExists = await client.indices.exists({ index: DATASET_EXAMPLES_INDEX });
  t.ok(examplesIndexExists, 'dataset examples index exists');

  // Aliases may be the same as index names in some envs; if alias is an index we skip alias check
  const spanAliasIsIndex = await client.indices.exists({ index: SPAN_INDEX_ALIAS });
  if (!spanAliasIsIndex) {
    const spanAlias = await client.indices.getAlias({ name: SPAN_INDEX_ALIAS }).catch(() => null);
    t.ok(spanAlias && Object.keys(spanAlias).length > 0, 'span index alias points to an index');
  }

  const examplesAliasIsIndex = await client.indices.exists({ index: DATASET_EXAMPLES_INDEX_ALIAS });
  if (!examplesAliasIsIndex) {
    const examplesAlias = await client.indices.getAlias({ name: DATASET_EXAMPLES_INDEX_ALIAS }).catch(() => null);
    t.ok(examplesAlias && Object.keys(examplesAlias).length > 0, 'examples index alias points to an index');
  }

  await closeClient();
  t.end();
});
