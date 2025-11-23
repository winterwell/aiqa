/**
 * SQL query building utilities for converting SearchQuery objects to SQL WHERE clauses.
 */

import SearchQuery from '../common/SearchQuery.js';

/**
 * Convert SearchQuery to SQL WHERE clause string.
 * @param sq - SearchQuery instance, string, or null/undefined
 * @returns SQL WHERE clause (returns '1=1' if sq is null/undefined)
 */
export function searchQueryToSqlWhereClause(sq: SearchQuery | string | null | undefined): string {
  if (!sq) return '1=1';
  const searchQuery = typeof sq === 'string' ? new SearchQuery(sq) : sq;

  if (!searchQuery.tree || searchQuery.tree.length === 0) return '1=1';
  return searchQueryToSqlWhereClause2(searchQuery.tree);
}

/**
 * Recursive helper to convert SearchQuery tree to SQL WHERE clause.
 * @param tree - SearchQuery tree structure
 * @param isValue - Whether this is being used as a value in field:value syntax
 * @returns SQL WHERE clause fragment
 */
function searchQueryToSqlWhereClause2(tree: any[] | any, isValue: boolean = false): string {
  if (typeof tree === 'string') {
	const escapedValue = sqlEncodeValue(tree);
    if (isValue) {
      // When used as a value in field:value, return as SQL string literal
      return escapedValue;
    }
    // Standalone strings should search the name field (most common use case)
    return `name ILIKE '%${escapedValue.slice(1, -1)}%'`;
  }
  if (!Array.isArray(tree)) {
    return String(tree);
  }
  if (tree.length === 1) {
    const single = tree[0];
    if (typeof single === 'string') {
      const escapedValue = sqlEncodeValue(single);
      if (isValue) {
        return sqlEncodeValue(single);
      }
      return `name ILIKE '%${escapedValue.slice(1, -1)}%'`;
    }
    return String(single);
  }
  if (typeof tree === 'object' && !Array.isArray(tree)) {
    const keys = Object.keys(tree);
    if (keys.length === 1) {
      const key = keys[0];
      const value = tree[key];
      // Special handling for members field: check if value is in array
      if (key === 'members') {
        // Extract the raw value and escape it properly for ARRAY constructor
        const rawValue = typeof value === 'string' ? value : String(value);
        const escapedValue = sqlEncodeValue(rawValue);
        return `${escapedValue} = ANY(members)`;
      }
      return `${sqlEncodeColumn(key)} = ${searchQueryToSqlWhereClause2([value], true)}`;
    }
  }
  const op = tree[0];
  const bits = tree.slice(1);
  const ubits = bits.map((bit: any) => {
    if (typeof bit === 'object' && !Array.isArray(bit)) {
      const keys = Object.keys(bit);
      if (keys.length === 1) {
        const key = keys[0];
        const value = bit[key];
        // Special handling for members field: check if value is in array
        if (key === 'members') {
          // Extract the raw value and escape it properly for ARRAY constructor
          const rawValue = typeof value === 'string' ? value : String(value);
          const escapedValue = sqlEncodeValue(rawValue);
          return `${escapedValue} = ANY(members)`;
        }
        return `${sqlEncodeColumn(key)} = ${searchQueryToSqlWhereClause2([value], true)}`;
      }
    }
    return searchQueryToSqlWhereClause2(Array.isArray(bit) ? bit : [bit], false);
  });
  const sqlOp = op === 'OR' ? 'OR' : 'AND';
  return `(${ubits.join(` ${sqlOp} `)})`;
}

function sqlEncodeValue(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/**
 * check if value is a valid column name to prevent SQL injection
 * @param value 
 * @returns 
 */
function sqlEncodeColumn(value: string): string {
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
		throw new Error(`Invalid column name: ${value}`);
	}
	return value;
}
