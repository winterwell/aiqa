
import tap from 'tap';
import { encodeOtlpProtobuf } from '../utils-for-tests';
import { getClient } from '../../dist/db/db_es.js';
import { SPAN_INDEX } from '../../dist/db/db_es_init.js';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.SERVER_URL || 'http://localhost:4318';
const API_KEY = process.env.AIQA_API_KEY;

tap.test('create index - update Span', async (t) => {
  const client = getClient();
  const indexName = SPAN_INDEX;
  const mappings = generateSpanMappings();
    try {
      await client.indices.putMapping({ index: indexName, properties: mappings });
    } catch (error: any) {
      console.warn(`Could not update mapping for ${indexName}:`, error.message);
      console.warn(`Desired Mappings`, JSON.stringify(mappings, null, 2));
    }
    return;
  }