
import tap from 'tap';
import { initClient, getClient, generateSpanMappings, checkElasticsearchAvailable } from '../../dist/db/db_es.js';
import { SPAN_INDEX } from '../../dist/db/db_es_init.js';
import dotenv from 'dotenv';

dotenv.config();

tap.test('create index - update Span', async (t) => {
  initClient(process.env.ELASTICSEARCH_URL || 'http://localhost:9200');
  const available = await checkElasticsearchAvailable();
  if (!available) {
    t.skip('Elasticsearch not available');
    t.end();
    return;
  }
  const client = getClient();
  const indexName = SPAN_INDEX;
  const mappings = generateSpanMappings();
  try {
    await client.indices.putMapping({ index: indexName, properties: mappings });
  } catch (error: any) {
    console.warn(`Could not update mapping for ${indexName}:`, error.message);
    console.warn(`Desired Mappings`, JSON.stringify(mappings, null, 2));
  }
  t.end();
});
