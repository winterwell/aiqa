import tap from 'tap';
import SearchQuery from '../dist/common/SearchQuery.js';
import { searchQueryToEsQuery } from '../dist/db/es_query.js';

function maxBoolDepth(node: any, depth: number = 0): number {
  if (!node || typeof node !== 'object') return depth;
  const isBool = !!node.bool;
  const nextDepth = isBool ? depth + 1 : depth;
  let maxDepth = nextDepth;
  for (const value of Object.values(isBool ? node.bool : node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        maxDepth = Math.max(maxDepth, maxBoolDepth(item, nextDepth));
      }
    } else {
      maxDepth = Math.max(maxDepth, maxBoolDepth(value, nextDepth));
    }
  }
  return maxDepth;
}

tap.test('searchQueryToEsQuery flattens long OR chains', (t) => {
  const ids = Array.from({ length: 120 }, (_, i) => `trace_${i}`);
  const query = ids.map((id) => `trace:${id}`).join(' OR ');
  const sq = new SearchQuery(query);
  const esQuery = searchQueryToEsQuery(sq);

  t.ok(esQuery?.bool?.should, 'top-level bool.should exists');
  t.equal(esQuery.bool.minimum_should_match, 1, 'top-level minimum_should_match is preserved');
  t.equal(esQuery.bool.should.length, ids.length * 3, 'all trace alternatives are flattened into one should list');

  const nestedShould = esQuery.bool.should.filter((clause: any) => clause?.bool?.should);
  t.equal(nestedShould.length, 0, 'should clauses are not nested bool.should trees');
  t.ok(maxBoolDepth(esQuery) <= 1, 'bool nesting depth stays shallow for OR chains');
  t.end();
});

tap.test('searchQueryToEsQuery keeps AND of OR groups valid', (t) => {
  const sq = new SearchQuery('(trace:a OR trace:b OR trace:c) AND parent:unset');
  const esQuery = searchQueryToEsQuery(sq);

  t.ok(esQuery?.bool?.must, 'top-level bool.must exists for AND query');
  t.equal(esQuery.bool.must.length, 2, 'AND query has two must clauses');
  t.ok(maxBoolDepth(esQuery) <= 3, 'query stays reasonably shallow');
  t.end();
});
