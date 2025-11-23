/**
 * Elasticsearch query building functions.
 * Converts SearchQuery objects to Elasticsearch query DSL.
 */

import { Client } from '@elastic/elasticsearch';
import SearchQuery from '../common/SearchQuery.js';

/**
 * Convert SearchQuery to Elasticsearch query
 */
export function searchQueryToEsQuery(sq: SearchQuery | string | null | undefined): any {
  if (!sq) {
    return { match_all: {} };
  }

  const searchQuery = typeof sq === 'string' ? new SearchQuery(sq) : sq;
  if (!searchQuery.tree || searchQuery.tree.length === 0) {
    return { match_all: {} };
  }

  return buildEsQuery(searchQuery.tree);
}

/**
 * Build Elasticsearch query from parse tree
 */
export function buildEsQuery(tree: any[]): any {
  if (typeof tree === 'string') {
    return { match: { _all: tree } };
  }

  if (tree.length === 1) {
    const item = tree[0];
    if (typeof item === 'string') {
      return { match: { _all: item } };
    }
    if (typeof item === 'object' && !Array.isArray(item)) {
      const keys = Object.keys(item);
      if (keys.length === 1) {
        const key = keys[0];
        let value = item[key];
        // Convert string numbers to actual numbers for numeric fields
        if (typeof value === 'string' && /^-?\d+$/.test(value)) {
          value = parseInt(value, 10);
        } else if (typeof value === 'string' && /^-?\d*\.\d+$/.test(value)) {
          value = parseFloat(value);
        }
        return { term: { [key]: value } };
      }
    }
    return buildEsQuery(Array.isArray(item) ? item : [item]);
  }

  const op = tree[0];
  const bits = tree.slice(1);

  const queries = bits.map((bit: any) => {
    if (typeof bit === 'string') {
      return { match: { _all: bit } };
    }
    if (typeof bit === 'object' && !Array.isArray(bit)) {
      const keys = Object.keys(bit);
      if (keys.length === 1) {
        const key = keys[0];
        let value = bit[key];
        // Convert string numbers to actual numbers for numeric fields
        if (typeof value === 'string' && /^-?\d+$/.test(value)) {
          value = parseInt(value, 10);
        } else if (typeof value === 'string' && /^-?\d*\.\d+$/.test(value)) {
          value = parseFloat(value);
        }
        return { term: { [key]: value } };
      }
    }
    return buildEsQuery(Array.isArray(bit) ? bit : [bit]);
  });

  if (op === 'OR') {
    return { bool: { should: queries, minimum_should_match: 1 } };
  } else {
    return { bool: { must: queries } };
  }
}

/**
 * Generic search function for Elasticsearch
 */
export async function searchEntities<T>(
  client: Client,
  indexName: string,
  searchQuery?: SearchQuery | string | null,
  filters?: Record<string, string>,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: T[]; total: number }> {
  const baseQuery = searchQueryToEsQuery(searchQuery);
  console.log("baseQuery", baseQuery);
  const esQuery: any = {
    bool: {
      must: []
    }
  };

  // Add the search query if it's not match_all
  if (!baseQuery.match_all) {
    esQuery.bool.must.push(baseQuery);
  }

  // Add filters
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        esQuery.bool.must.push({ term: { [key]: value } });
      }
    }
  }

  // If no must clauses, use match_all
  if (esQuery.bool.must.length === 0) {
    esQuery.bool.must.push({ match_all: {} });
  }

  const result = await client.search<T>({
    index: indexName,
    query: esQuery,
    size: limit,
    from: offset,
    sort: [{ '@timestamp': { order: 'desc' } }]
  });

  const hits = (result.hits.hits || []).map((hit: any) => hit._source!);
  const total = result.hits.total as number | { value: number };

  return { hits, total: typeof total === 'number' ? total : total.value };
}

