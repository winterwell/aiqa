import tap from 'tap';
import SearchQuery, { searchQueryToSqlWhereClause } from '../dist/src/common/SearchQuery.js';

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

