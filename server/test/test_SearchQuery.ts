import tap from 'tap';
import SearchQuery, { searchQueryToSqlWhereClause } from '../dist/common/SearchQuery.js';

tap.test('searchQueryToSqlWhereClause - simple OR', t => {
  const sq = new SearchQuery('apples OR oranges');
  const sql = searchQueryToSqlWhereClause(sq);
  t.equal(sql, "('apples' OR 'oranges')", 'should convert to SQL');
  t.end();
});

tap.test('searchQueryToSqlWhereClause - complex OR AND', { skip: true }, t => {
	const sq = new SearchQuery('(apples OR oranges) AND (bananas OR pears)');
	const sql = searchQueryToSqlWhereClause(sq);
	t.equal(sql, '((apples OR oranges) AND (bananas OR pears))', 'should convert to SQL');
	t.end();
  });
  
tap.test('searchQueryToSqlWhereClause - complex OR AND with props', { skip: true }, t => {
	const sq = new SearchQuery('lang:en (fruit:apple OR fruit:orange)');
	const sql = searchQueryToSqlWhereClause(sq);
	t.equal(sql, "(lang='en' (fruit='apple' OR fruit='orange'))", 'should convert KVs to SQL');
	t.end();
  });

tap.test('SearchQuery constructor with string', t => {
  const sq = new SearchQuery('apples oranges');
  t.equal(sq.query, 'apples oranges', 'query should be set correctly');
  t.ok(sq.tree, 'tree should be parsed');
  t.equal(sq.tree![0], SearchQuery.AND, 'default operator should be AND');
  t.end();
});

tap.test('SearchQuery constructor with empty string', t => {
  const sq = new SearchQuery('');
  t.equal(sq.query, '', 'query should be empty string');
  t.ok(sq.tree, 'tree should exist');
  t.end();
});

tap.test('SearchQuery constructor with null/undefined', t => {
  const sq1 = new SearchQuery(null);
  t.equal(sq1.query, '', 'null should become empty string');
  
  const sq2 = new SearchQuery(undefined);
  t.equal(sq2.query, '', 'undefined should become empty string');
  t.end();
});

tap.test('SearchQuery constructor with SearchQuery instance', t => {
  const sq1 = new SearchQuery('test query');
  const sq2 = new SearchQuery(sq1);
  t.equal(sq2.query, 'test query', 'should unwrap SearchQuery instance');
  t.end();
});

tap.test('SearchQuery.parse with OR operator', t => {
  const sq = new SearchQuery('apples OR oranges');
  t.equal(sq.tree![0], SearchQuery.OR, 'should detect OR operator');
  t.end();
});

tap.test('SearchQuery.parse with key:value pairs', t => {
  const sq = new SearchQuery('lang:en vert:foo');
  t.ok(sq.tree, 'tree should exist');
  // Check that key:value pairs are parsed correctly
  const hasLang = sq.tree!.some(bit => typeof bit === 'object' && 'lang' in bit);
  const hasVert = sq.tree!.some(bit => typeof bit === 'object' && 'vert' in bit);
  t.ok(hasLang, 'should parse lang:en');
  t.ok(hasVert, 'should parse vert:foo');
  t.end();
});

tap.test('SearchQuery.prop - get existing property', t => {
  const sq = new SearchQuery('lang:en apples');
  const lang = SearchQuery.prop(sq, 'lang');
  t.equal(lang, 'en', 'should return property value');
  t.end();
});

tap.test('SearchQuery.prop - get non-existent property', t => {
  const sq = new SearchQuery('apples oranges');
  const lang = SearchQuery.prop(sq, 'lang');
  t.equal(lang, null, 'should return null for non-existent property');
  t.end();
});

tap.test('SearchQuery.setProp - set new property', t => {
  const sq = new SearchQuery('apples');
  const newSq = SearchQuery.setProp(sq, 'lang', 'en');
  t.equal(newSq.query, 'apples AND lang:en', 'should add property with AND');
  t.end();
});

tap.test('SearchQuery.setProp - set property on empty query', t => {
  const sq = new SearchQuery('');
  const newSq = SearchQuery.setProp(sq, 'lang', 'en');
  t.equal(newSq.query, 'lang:en', 'should set property without AND');
  t.end();
});

tap.test('SearchQuery.setProp - replace existing property', t => {
  const sq = new SearchQuery('lang:en apples');
  const newSq = SearchQuery.setProp(sq, 'lang', 'fr');
  t.equal(SearchQuery.prop(newSq, 'lang'), 'fr', 'should replace existing property');
  t.ok(newSq.query.indexOf('lang:fr') !== -1, 'should contain new value');
  t.ok(newSq.query.indexOf('lang:en') === -1, 'should not contain old value');
  t.end();
});

tap.test('SearchQuery.setProp - remove property (null value)', t => {
  const sq = new SearchQuery('lang:en apples');
  const newSq = SearchQuery.setProp(sq, 'lang', null);
  t.equal(SearchQuery.prop(newSq, 'lang'), null, 'should remove property');
  t.equal(newSq.query, 'apples', 'should only contain remaining terms');
  t.end();
});

tap.test('SearchQuery.setProp - remove property (empty string)', t => {
  const sq = new SearchQuery('lang:en apples');
  const newSq = SearchQuery.setProp(sq, 'lang', '');
  t.equal(SearchQuery.prop(newSq, 'lang'), null, 'should remove property');
  t.end();
});

tap.test('SearchQuery.setProp - quote values with spaces', t => {
  const sq = new SearchQuery('');
  const newSq = SearchQuery.setProp(sq, 'vert', 'foo bar');
  t.equal(newSq.query, 'vert:"foo bar"', 'should quote values with spaces');
  t.end();
});

tap.test('SearchQuery.setProp - boolean values', t => {
  const sq = new SearchQuery('');
  const newSq1 = SearchQuery.setProp(sq, 'flag', true);
  t.equal(newSq1.query, 'flag:true', 'should convert boolean true to string');
  
  const newSq2 = SearchQuery.setProp(sq, 'flag', false);
  t.equal(newSq2.query, 'flag:false', 'should convert boolean false to string');
  t.end();
});

tap.test('SearchQuery.setProp - with string input', t => {
  const newSq = SearchQuery.setProp('apples', 'lang', 'en');
  t.equal(newSq.query, 'apples AND lang:en', 'should accept string input');
  t.end();
});

tap.test('SearchQuery.setPropOr - single value', t => {
  const sq = new SearchQuery('');
  const newSq = SearchQuery.setPropOr(sq, 'vert', ['foo']);
  t.equal(newSq.query, 'vert:foo', 'should set single value');
  t.end();
});

tap.test('SearchQuery.setPropOr - multiple values', t => {
  const sq = new SearchQuery('');
  const newSq = SearchQuery.setPropOr(sq, 'vert', ['foo', 'bar']);
  t.equal(newSq.query, 'vert:foo OR vert:bar', 'should join values with OR');
  t.end();
});

tap.test('SearchQuery.setPropOr - merge with existing query', t => {
  const sq = new SearchQuery('apples');
  const newSq = SearchQuery.setPropOr(sq, 'vert', ['foo', 'bar']);
  t.equal(newSq.query, 'apples AND (vert:foo OR vert:bar)', 'should merge with AND');
  t.end();
});

tap.test('SearchQuery.setPropOr - replace existing property', t => {
  const sq = new SearchQuery('vert:baz apples');
  const newSq = SearchQuery.setPropOr(sq, 'vert', ['foo', 'bar']);
  // setPropOr creates an OR query, so prop() will return the first value
  // The old property should be removed from the query string
  t.ok(newSq.query.indexOf('vert:foo') !== -1, 'should contain new values');
  t.ok(newSq.query.indexOf('vert:bar') !== -1, 'should contain new values');
  t.ok(newSq.query.indexOf('vert:baz') === -1, 'old property should be removed');
  t.end();
});

tap.test('SearchQuery.setPropOr - quote values with spaces', t => {
  const sq = new SearchQuery('');
  const newSq = SearchQuery.setPropOr(sq, 'vert', ['foo bar', 'baz']);
  t.equal(newSq.query, 'vert:"foo bar" OR vert:baz', 'should quote values with spaces');
  t.end();
});

tap.test('SearchQuery.and - combine two queries', t => {
  const sq1 = new SearchQuery('apples');
  const sq2 = new SearchQuery('oranges');
  const result = SearchQuery.and(sq1, sq2);
  t.ok(result, 'should return a SearchQuery');
  t.equal(result!.query, 'apples AND oranges', 'should combine with AND');
  t.end();
});

tap.test('SearchQuery.and - with string inputs', t => {
  const result = SearchQuery.and('apples', 'oranges');
  t.ok(result, 'should return a SearchQuery');
  t.equal(result!.query, 'apples AND oranges', 'should accept string inputs');
  t.end();
});

tap.test('SearchQuery.and - with null inputs', t => {
  const sq1 = new SearchQuery('apples');
  const result1 = SearchQuery.and(sq1, null);
  t.equal(result1!.query, 'apples', 'should return first query if second is null');
  
  const result2 = SearchQuery.and(null, sq1);
  t.equal(result2!.query, 'apples', 'should return second query if first is null');
  
  const result3 = SearchQuery.and(null, null);
  t.equal(result3, null, 'should return null if both are null');
  t.end();
});

tap.test('SearchQuery.and - same operator optimization', t => {
  const sq1 = new SearchQuery('apples');
  const sq2 = new SearchQuery('oranges');
  const sq3 = new SearchQuery('bananas');
  const result1 = SearchQuery.and(sq1, sq2);
  const result2 = SearchQuery.and(result1, sq3);
  t.ok(result2, 'should handle multiple AND operations');
  t.end();
});

tap.test('SearchQuery.or - combine two queries', t => {
  const sq1 = new SearchQuery('apples');
  const sq2 = new SearchQuery('oranges');
  const result = SearchQuery.or(sq1, sq2);
  t.ok(result, 'should return a SearchQuery');
  t.equal(result!.query, 'apples OR oranges', 'should combine with OR');
  t.end();
});

tap.test('SearchQuery.or - same operator optimization', t => {
  const sq1 = new SearchQuery('apples OR bananas');
  const sq2 = new SearchQuery('oranges OR grapes');
  const result = SearchQuery.or(sq1, sq2);
  t.ok(result, 'should return a SearchQuery');
  t.ok(result!.query.indexOf('OR') !== -1, 'should contain OR operator');
  t.end();
});

tap.test('SearchQuery.remove - remove term from query', t => {
  const sq1 = new SearchQuery('apples AND oranges');
  const sq2 = new SearchQuery('oranges');
  const result = SearchQuery.remove(sq1, sq2);
  t.ok(result, 'should return a SearchQuery');
  t.equal(result!.query, 'apples', 'should remove matching term');
  t.end();
});

tap.test('SearchQuery.remove - with null inputs', t => {
  const sq1 = new SearchQuery('apples');
  const result1 = SearchQuery.remove(sq1, null);
  t.equal(result1!.query, 'apples', 'should return first query if second is null');
  
  const result2 = SearchQuery.remove(null, sq1);
  t.equal(result2, null, 'should return null if first is null');
  t.end();
});

tap.test('SearchQuery.str - convert to string', t => {
  const sq = new SearchQuery('apples oranges');
  t.equal(SearchQuery.str(sq), 'apples oranges', 'should return query string');
  t.end();
});

tap.test('SearchQuery.str - with null', t => {
  t.equal(SearchQuery.str(null), '', 'should return empty string for null');
  t.equal(SearchQuery.str(undefined), '', 'should return empty string for undefined');
  t.end();
});

tap.test('SearchQuery - complex query with brackets', t => {
  const sq1 = new SearchQuery('apples oranges');
  const sq2 = new SearchQuery('bananas');
  const result = SearchQuery.or(sq1, sq2);
  // When combining queries with different operators, brackets should be added
  t.ok(result, 'should handle complex queries');
  t.end();
});

tap.test('SearchQuery - multiple property operations', t => {
  let sq = new SearchQuery('apples');
  sq = SearchQuery.setProp(sq, 'lang', 'en');
  sq = SearchQuery.setProp(sq, 'vert', 'foo');
  const lang = SearchQuery.prop(sq, 'lang');
  const vert = SearchQuery.prop(sq, 'vert');
  t.equal(lang, 'en', 'should preserve lang property');
  t.equal(vert, 'foo', 'should preserve vert property');
  t.end();
});

tap.test('SearchQuery - setProp then remove', t => {
  let sq = new SearchQuery('apples');
  sq = SearchQuery.setProp(sq, 'lang', 'en');
  t.equal(SearchQuery.prop(sq, 'lang'), 'en', 'property should be set');
  sq = SearchQuery.setProp(sq, 'lang', null);
  t.equal(SearchQuery.prop(sq, 'lang'), null, 'property should be removed');
  t.end();
});

tap.test('SearchQuery - empty query after removing all terms', t => {
  const sq = new SearchQuery('apples');
  const newSq = SearchQuery.setProp(sq, 'lang', null);
  // Removing the only term should leave empty or minimal query
  t.ok(newSq, 'should return valid SearchQuery');
  t.end();
});

// Tests for parentheses handling (bug fix)
tap.test('SearchQuery.parse - parentheses around field:value', t => {
  const sq = new SearchQuery('(traceId:871d07301f2ece35baf54e06add78544)');
  t.ok(sq.tree, 'tree should be parsed');
  const hasTraceId = sq.tree!.some(bit => typeof bit === 'object' && 'traceId' in bit);
  t.ok(hasTraceId, 'should parse traceId field with parentheses');
  const traceIdValue = sq.tree!.find(bit => typeof bit === 'object' && 'traceId' in bit);
  t.equal(traceIdValue!['traceId'], '871d07301f2ece35baf54e06add78544', 'should extract value correctly');
  t.end();
});

tap.test('SearchQuery.parse - parentheses around first field:value in OR query', t => {
  const sq = new SearchQuery('(traceId:871d07301f2ece35baf54e06add78544 OR traceId:7ee52d7bb0be3118970bc399354c92c6)');
  t.ok(sq.tree, 'tree should be parsed');
  t.equal(sq.tree![0], SearchQuery.OR, 'should detect OR operator');
  const traceIdBits = sq.tree!.filter(bit => typeof bit === 'object' && 'traceId' in bit);
  t.equal(traceIdBits.length, 2, 'should parse both traceId values');
  t.equal(traceIdBits[0]['traceId'], '871d07301f2ece35baf54e06add78544', 'should parse first traceId correctly');
  t.equal(traceIdBits[1]['traceId'], '7ee52d7bb0be3118970bc399354c92c6', 'should parse second traceId correctly');
  t.end();
});

tap.test('SearchQuery.parse - parentheses around last field:value in OR query', t => {
  const sq = new SearchQuery('(traceId:871d07301f2ece35baf54e06add78544 OR traceId:7ee52d7bb0be3118970bc399354c92c6)');
  t.ok(sq.tree, 'tree should be parsed');
  const traceIdBits = sq.tree!.filter(bit => typeof bit === 'object' && 'traceId' in bit);
  t.equal(traceIdBits.length, 2, 'should parse both traceId values');
  t.equal(traceIdBits[1]['traceId'], '7ee52d7bb0be3118970bc399354c92c6', 'should parse last traceId correctly without trailing paren');
  t.end();
});

tap.test('SearchQuery.parse - multiple OR conditions with parentheses (real-world case)', t => {
  const query = '(traceId:871d07301f2ece35baf54e06add78544 OR traceId:7ee52d7bb0be3118970bc399354c92c6 OR traceId:487c9dc63c7f0c49e8b671357ce82c67)';
  const sq = new SearchQuery(query);
  t.ok(sq.tree, 'tree should be parsed');
  t.equal(sq.tree![0], SearchQuery.OR, 'should detect OR operator');
  const traceIdBits = sq.tree!.filter(bit => typeof bit === 'object' && 'traceId' in bit);
  t.equal(traceIdBits.length, 3, 'should parse all three traceId values');
  t.equal(traceIdBits[0]['traceId'], '871d07301f2ece35baf54e06add78544', 'should parse first traceId');
  t.equal(traceIdBits[1]['traceId'], '7ee52d7bb0be3118970bc399354c92c6', 'should parse second traceId');
  t.equal(traceIdBits[2]['traceId'], '487c9dc63c7f0c49e8b671357ce82c67', 'should parse third traceId');
  t.end();
});

tap.test('SearchQuery.parse - parentheses with AND operator', t => {
  const sq = new SearchQuery('(lang:en AND vert:foo)');
  t.ok(sq.tree, 'tree should be parsed');
  t.equal(sq.tree![0], SearchQuery.AND, 'should detect AND operator');
  const langBit = sq.tree!.find(bit => typeof bit === 'object' && 'lang' in bit);
  const vertBit = sq.tree!.find(bit => typeof bit === 'object' && 'vert' in bit);
  t.ok(langBit, 'should parse lang field');
  t.ok(vertBit, 'should parse vert field');
  t.equal(langBit!['lang'], 'en', 'should extract lang value correctly');
  t.equal(vertBit!['vert'], 'foo', 'should extract vert value correctly');
  t.end();
});

tap.test('SearchQuery.parse - opening parenthesis only', t => {
  const sq = new SearchQuery('(traceId:871d07301f2ece35baf54e06add78544');
  t.ok(sq.tree, 'tree should be parsed');
  const traceIdBit = sq.tree!.find(bit => typeof bit === 'object' && 'traceId' in bit);
  t.ok(traceIdBit, 'should parse traceId field');
  t.equal(traceIdBit!['traceId'], '871d07301f2ece35baf54e06add78544', 'should extract value correctly');
  t.end();
});

tap.test('SearchQuery.parse - closing parenthesis only', t => {
  const sq = new SearchQuery('traceId:871d07301f2ece35baf54e06add78544)');
  t.ok(sq.tree, 'tree should be parsed');
  const traceIdBit = sq.tree!.find(bit => typeof bit === 'object' && 'traceId' in bit);
  t.ok(traceIdBit, 'should parse traceId field');
  t.equal(traceIdBit!['traceId'], '871d07301f2ece35baf54e06add78544', 'should extract value correctly');
  t.end();
});

tap.test('SearchQuery.parse - nested parentheses', t => {
  const sq = new SearchQuery('((traceId:871d07301f2ece35baf54e06add78544))');
  t.ok(sq.tree, 'tree should be parsed');
  const traceIdBit = sq.tree!.find(bit => typeof bit === 'object' && 'traceId' in bit);
  t.ok(traceIdBit, 'should parse traceId field with nested parentheses');
  t.equal(traceIdBit!['traceId'], '871d07301f2ece35baf54e06add78544', 'should extract value correctly');
  t.end();
});

tap.test('SearchQuery.parse - parentheses with quoted values', t => {
  const sq = new SearchQuery('(vert:"foo bar" OR vert:"baz qux")');
  t.ok(sq.tree, 'tree should be parsed');
  t.equal(sq.tree![0], SearchQuery.OR, 'should detect OR operator');
  const vertBits = sq.tree!.filter(bit => typeof bit === 'object' && 'vert' in bit);
  t.equal(vertBits.length, 2, 'should parse both vert values');
  t.equal(vertBits[0]['vert'], 'foo bar', 'should parse first quoted value');
  t.equal(vertBits[1]['vert'], 'baz qux', 'should parse second quoted value');
  t.end();
});

tap.test('SearchQuery.parse - parentheses with plain text terms', t => {
  const sq = new SearchQuery('(apples OR oranges)');
  t.ok(sq.tree, 'tree should be parsed');
  t.equal(sq.tree![0], SearchQuery.OR, 'should detect OR operator');
  const hasApples = sq.tree!.some(bit => bit === 'apples');
  const hasOranges = sq.tree!.some(bit => bit === 'oranges');
  t.ok(hasApples, 'should parse apples');
  t.ok(hasOranges, 'should parse oranges');
  t.end();
});

tap.test('SearchQuery.parse - mixed parentheses and field:value', t => {
  const sq = new SearchQuery('(traceId:871d07301f2ece35baf54e06add78544) AND attributes.aiqa.span_type:feedback');
  t.ok(sq.tree, 'tree should be parsed');
  t.equal(sq.tree![0], SearchQuery.AND, 'should detect AND operator');
  const traceIdBit = sq.tree!.find(bit => typeof bit === 'object' && 'traceId' in bit);
  const spanTypeBit = sq.tree!.find(bit => typeof bit === 'object' && 'attributes.aiqa.span_type' in bit);
  t.ok(traceIdBit, 'should parse traceId field');
  t.ok(spanTypeBit, 'should parse attributes.aiqa.span_type field');
  t.equal(traceIdBit!['traceId'], '871d07301f2ece35baf54e06add78544', 'should extract traceId correctly');
  t.equal(spanTypeBit!['attributes.aiqa.span_type'], 'feedback', 'should extract span_type correctly');
  t.end();
});

tap.test('SearchQuery.parse - field names with dots and parentheses', t => {
  const sq = new SearchQuery('(attributes.aiqa.span_type:feedback)');
  t.ok(sq.tree, 'tree should be parsed');
  const spanTypeBit = sq.tree!.find(bit => typeof bit === 'object' && 'attributes.aiqa.span_type' in bit);
  t.ok(spanTypeBit, 'should parse field with dots');
  t.equal(spanTypeBit!['attributes.aiqa.span_type'], 'feedback', 'should extract value correctly');
  t.end();
});

tap.test('SearchQuery.parse - empty parentheses', t => {
  const sq = new SearchQuery('()');
  t.ok(sq.tree, 'tree should be parsed');
  // Empty parentheses should result in an empty or minimal tree
  t.ok(sq.tree!.length >= 1, 'tree should have at least operator');
  t.end();
});

tap.test('SearchQuery.parse - value ending with closing parenthesis', t => {
  const sq = new SearchQuery('traceId:value)');
  t.ok(sq.tree, 'tree should be parsed');
  const traceIdBit = sq.tree!.find(bit => typeof bit === 'object' && 'traceId' in bit);
  t.ok(traceIdBit, 'should parse traceId field');
  t.equal(traceIdBit!['traceId'], 'value', 'should extract value without trailing paren');
  t.end();
});

tap.test('SearchQuery.parse - value starting with opening parenthesis', t => {
  const sq = new SearchQuery('traceId:(value');
  t.ok(sq.tree, 'tree should be parsed');
  const traceIdBit = sq.tree!.find(bit => typeof bit === 'object' && 'traceId' in bit);
  t.ok(traceIdBit, 'should parse traceId field');
  t.equal(traceIdBit!['traceId'], '(value', 'should extract value with opening paren if part of value');
  t.end();
});

tap.test('SearchQuery.parse - complex real-world query from error log', t => {
  // This is the actual query from the error log that was failing
  const query = '(traceId:871d07301f2ece35baf54e06add78544 OR traceId:7ee52d7bb0be3118970bc399354c92c6 OR traceId:487c9dc63c7f0c49e8b671357ce82c67 OR traceId:cfc7bd7d8815fd73d8981ff690d4060a OR traceId:285ae64f68e67931ad7b6c1bb66055f5) AND attributes.aiqa.span_type:feedback';
  const sq = new SearchQuery(query);
  t.ok(sq.tree, 'tree should be parsed');
  // The query should parse without errors
  const traceIdBits = sq.tree!.filter(bit => typeof bit === 'object' && 'traceId' in bit);
  t.ok(traceIdBits.length >= 1, 'should parse at least one traceId');
  const spanTypeBit = sq.tree!.find(bit => typeof bit === 'object' && 'attributes.aiqa.span_type' in bit);
  t.ok(spanTypeBit, 'should parse attributes.aiqa.span_type field');
  t.end();
});

tap.test('SearchQuery.parse - OR query with AND after parentheses', t => {
  const sq = new SearchQuery('(traceId:1 OR traceId:2) AND parentSpanId:unset');
  t.ok(sq.tree, 'tree should be parsed');
  t.equal(sq.tree![0], SearchQuery.AND, 'should detect AND as top-level operator');
  const traceIdBits = sq.tree!.filter(bit => typeof bit === 'object' && 'traceId' in bit);
  t.ok(traceIdBits.length >= 1, 'should parse traceId fields');
  const parentSpanIdBit = sq.tree!.find(bit => typeof bit === 'object' && 'parent_span_id' in bit);
  t.ok(parentSpanIdBit, 'should parse parent_span_id field');
  t.end();
});

tap.test('SearchQuery.propFromString - get value from query string', t => {
  t.equal(SearchQuery.propFromString('feedback:positive', 'feedback'), 'positive', 'should get value');
  t.equal(SearchQuery.propFromString('foo AND feedback:negative AND bar', 'feedback'), 'negative', 'should get value from AND query');
  t.equal(SearchQuery.propFromString('parent_span_id:unset', 'feedback'), null, 'should return null when key absent');
  t.equal(SearchQuery.propFromString('', 'feedback'), null, 'should return null for empty string');
  t.end();
});

tap.test('SearchQuery.setOrRemoveInString - set and remove key:value', t => {
  t.equal(SearchQuery.setOrRemoveInString('foo', 'feedback', 'positive'), 'foo AND feedback:positive', 'should add key:value');
  t.equal(SearchQuery.setOrRemoveInString('foo AND bar', 'feedback', 'negative'), 'foo AND bar AND feedback:negative', 'should add to existing AND');
  t.equal(SearchQuery.setOrRemoveInString('feedback:positive AND parent_span_id:unset', 'feedback', null), 'parent_span_id:unset', 'should remove key');
  t.equal(SearchQuery.setOrRemoveInString('feedback:positive', 'feedback', null), '', 'should return empty when only key removed');
  t.equal(SearchQuery.setOrRemoveInString('a AND feedback:positive AND b', 'feedback', null), 'a AND b', 'should remove key from middle');
  t.end();
});
