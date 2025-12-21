/**
 * Gmail-style search query parser and builder. Supports AND/OR operators and field:value syntax.
 * Used for filtering entities in both PostgreSQL and Elasticsearch queries.
 */

import { assert, assMatch } from './utils/assert.js';
import { is } from './utils/miscutils.js';

// Simple lodash-like utilities
const _ = {
	isString: (value: any): value is string => typeof value === 'string',
	find: <T>(array: T[], predicate: (item: T) => boolean): T | undefined => {
		return array.find(predicate);
	},
	eq: (a: any, b: any): boolean => {
		return JSON.stringify(a) === JSON.stringify(b);
	}
};

/**
 * Parses and manipulates Gmail-style search queries. Supports AND/OR operators and field:value syntax.
 * Example: new SearchQuery("apples OR oranges") or SearchQuery.setProp(sq, "lang", "en")
 */
class SearchQuery {

	/** @type {!String} */
	query: string;

	/**
	 * e.g. ["OR", "a", ["AND", "b", {"near", "c"}]]
	 */
	tree?: any[];

	options?: any;

	// Static constants
	static readonly AND = "AND";
	static readonly OR = "OR";
	static readonly NOT = "NOT";
	static readonly REMOVE = "RM";
	static readonly GENERAL_OPTIONS = {
		OR: ["OR", ","],
		AND: ["AND"],
		NOT: ["-"]
	};

	// Static methods
	static _init: (sq: SearchQuery) => void;
	static parse: (sq: SearchQuery) => void;
	static prop: (sq: SearchQuery, propName: string) => string | null;
	static setProp: (sq: SearchQuery | string | null, propName: string, propValue?: string | boolean | null) => SearchQuery;
	static setPropOr: (sq: SearchQuery | null | undefined, propName: string, propValues: string[]) => SearchQuery;
	static or: (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null) => SearchQuery | null;
	static op: (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null, op: string) => SearchQuery | null;
	static and: (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null) => SearchQuery | null;
	static remove: (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null) => SearchQuery | null;
	static str: (sq: SearchQuery | null | undefined) => string;

	/**
	 * 
	 * @param {?String|SearchQuery} query 
	 * @param {?Object} options 
	 */
	constructor(query?: string | SearchQuery | null, options?: any) {
		// DataClass._init(this, base); not needed??
		this.query = (query as any)?.query || (query as string) || "";
		// NB: unwrap if the input is a SearchQuery
		if ((this.query as any).query) this.query = (this.query as any).query;
		this.options = Object.assign({}, SearchQuery.GENERAL_OPTIONS, options, (this.query as any).options);
		SearchQuery.parse(this);
	}

} // ./SearchQuery


SearchQuery._init = (sq: SearchQuery) => {
	if (sq.tree) return;
	SearchQuery.parse(sq);
}


SearchQuery.parse = (sq: SearchQuery) => {
	// HACK just space separate and crude key:value for now!
	let bits = sq.query.split(" ");
	let bits2: any[] = [];
	let i = 0;
	let op = SearchQuery.AND;
	if (bits.includes("OR")) {
		op = SearchQuery.OR;
	}
	
	while (i < bits.length) {
		const bit = bits[i];
		if (bit === op) {
			i++;
			continue;
		}
		let kv = bit.match(/^([a-zA-Z_0-9.]+):(.+)/);
		if (kv) {
			// Found a field:value pair
			let value = kv[2];
			// If value starts with a quote, collect tokens until we find the closing quote
			if (value.startsWith('"')) {
				let j = i + 1;
				// Collect following tokens until we find the closing quote
				while (j < bits.length && !value.endsWith('"')) {
					value += ' ' + bits[j];
					j++;
				}
				// Remove quotes from the value
				if (value.startsWith('"') && value.endsWith('"')) {
					value = value.slice(1, -1);
				}
				bits2.push({[kv[1]]: value});
				i = j;
			} else {
				// Value doesn't start with quote, so it's just this token (no spaces in unquoted values)
				bits2.push({[kv[1]]: value});
				i++;
			}
		} else {
			bits2.push(bit);
			i++;
		}
	}
	
	/**
	 * Return the expression tree, which is a nested array
	 * E.g. "a OR (b AND near:c)" --> ["OR", "a", ["AND", "b", ["near", "c"]]]
	 */
	sq.tree = [op, ...bits2];
}


/**
 * Convenience method.
 * IF propName occurs at the top-level, then return the value
 * @param {!SearchQuery} sq
 * @param {!string} propName 
 * @returns {?string}
 */
SearchQuery.prop = (sq: SearchQuery, propName: string): string | null => {
	SearchQuery._init(sq);
	let props = sq.tree!.filter(bit => Object.keys(bit).includes(propName));
	// ??What to return if prop:value is present but its complex??
	if (props.length > 1) console.warn("SearchQuery.prop multiple values!", props, sq);
	if (props.length) {
		return props[0][propName];
	}
	return null;
}


/**
 * Set a top-level prop, e.g. vert:foo
 * @param {?SearchQuery|string} sq
 * @param {!String} propName 
 * @param {?String|Boolean} propValue If unset (null,undefined, or "" -- but not false or 0!), clear the prop. The caller is responsible for converting non-strings to strings - apart from boolean which thie method will handle, 'cos we're nice like that.
 * @returns {SearchQuery} a NEW SearchQuery. Use .query to get the string
 */
SearchQuery.setProp = (sq: SearchQuery | string | null, propName: string, propValue?: string | boolean | null): SearchQuery => {	
	assMatch(propName, String);
	if (_.isString(sq)) {
		sq = new SearchQuery(sq);
	}
	// boolean has gotchas, so lets handle it. But not number, as the caller should decide on e.g. rounding
	if (typeof(propValue) === "boolean") propValue = ""+propValue; // true/false
	assMatch(propValue, "?String");
	assMatch(propName, String, "searchquery.js - "+propName+" "+propValue);
	let newq = "";
	// remove the old
	if (sq) {
		assMatch(sq, SearchQuery);
		newq = snipProp(sq, propName);
	}
	// unset? (but do allow prop:false and x:0)
	if (propValue===null || propValue===undefined || propValue==="") {
		if ( ! newq) {
			// console.warn("SearchQuery.js null + null!",sq,propName,propValue);
			return new SearchQuery();
		}
		// already removed the old
	} else {
		// quote the value?
		const propValueStr = String(propValue);
		let qpropValue = propValueStr.indexOf(" ") === -1? propValueStr : '"'+propValueStr+'"';
		newq = (newq? newq+" AND " : "") + propName+":"+qpropValue;
	}
	// Collapse duplicate ANDs
	newq = newq.replace(/\s+AND(\s+AND)+\s+/g, " AND ");
	// Trim leading, trailing, empty ANDs
	newq = newq.replace(/^\s*(AND\s+)+/g, "");
	newq = newq.replace(/(\s+AND)+\s*$/g, "");
	newq = newq.replace(/^\s*AND\s*$/, "");

	// done
	return new SearchQuery(newq.trim());
}


/**
 * 
 * @param {SearchQuery} sq
 * @param {String} propName
 * @returns {String}
 */
const snipProp = (sq: SearchQuery, propName: string): string => {
	assMatch(sq, SearchQuery);
	SearchQuery._init(sq);
	assMatch(propName, String);
	// Cut out the old value (use the parse tree to handle quoting)
	let tree2 = sq.tree!.filter(bit => ! is((bit as any)[propName]));
	let newq = unparse(tree2);
	return newq;
};


/**
 * Set several options for a top-level prop, e.g. "vert:foo OR vert:bar"
 * @param {SearchQuery?} [sq] If set, this is combined via AND!
 * @param {String} propName
 * @param {String[]} propValues Must not be empty
 * @returns a NEW SearchQuery
 */
SearchQuery.setPropOr = (sq: SearchQuery | null | undefined, propName: string, propValues: string[]): SearchQuery => {	
	assMatch(propName, String, "searchquery.js "+propName+": "+propValues);
	assMatch(propValues, "String[]", "searchquery.js "+propName); // NB: Should we allow empty? No - ambiguous whether or(empty) should mean all or none
	assert(propValues.length, "searchquery.js - "+propName+" Cant OR over nothing "+propValues)
	// quote the values? HACK if they have a space
	let qpropValues = propValues.map(propValue => propValue.indexOf(" ") === -1? propValue : '"'+propValue+'"');
	// join by OR
	let qor = propName+":" + qpropValues.join(" OR "+propName+":");	

	// no need to merge into a bigger query? Then we're done :)
	if ( ! sq || ! sq.query) {
		return new SearchQuery(qor);
	}

	// AND merge...
	let newq = snipProp(sq, propName);
	newq = newq+" AND ("+qor+")";
	// HACK - trim ANDs??
	newq = newq.replace(/ AND +AND /g," AND ");
	if (newq.substr(0, 5) === " AND ") {
		newq = newq.substr(5);
	}
	if (newq.substr(newq.length-5, newq.length) === " AND ") {
		newq = newq.substr(0, newq.length - 5);
	}
	// done
	return new SearchQuery(newq.trim());
};


/**
 * Merge two queries with OR
 * @param {?String|SearchQuery} sq 
 * @returns a NEW SearchQuery
 */
SearchQuery.or = (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null): SearchQuery | null => {
	return SearchQuery.op(sq1, sq2, SearchQuery.OR);
}


/**
 * 
 * @param {?string|SearchQuery} sq1 
 * @param {?string|SearchQuery} sq2 
 * @param {!string} op 
 * @returns {SearchQuery} Can be null if both inputs are null
 */
SearchQuery.op = (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null, op: string): SearchQuery | null => {	
	// convert to class
	if (typeof(sq1)==='string') sq1 = new SearchQuery(sq1);
	if (typeof(sq2)==='string') sq2 = new SearchQuery(sq2);

	// HACK remove (works for simple cases)
	// NB: done before the null tests as this handles null differently to and/or 
	if (SearchQuery.REMOVE === op) {
		if ( ! sq2 || ! sq2.query) return sq1 || null;
		// null remove thing => null??
		if ( ! sq1 || ! sq1.query) return sq1 || null;
		// (assume AND) pop the 1st tree op, filter out nodes that appear in sq2
		let t2 = sq1.tree!.slice(1).filter(
			n1 => ! _.find(sq2!.tree!, n2 => _.eq(JSON.stringify(n1), JSON.stringify(n2)))
		);
		t2 = [sq1.tree![0]].concat(t2);
		let u = unparse(t2);
		// console.warn(sq1.tree, sq2.tree, t2, u);
		let newsq = new SearchQuery(u);
		return newsq;
	}

	// one is falsy? then just return the other
	if ( ! sq2) return sq1 || null;
	if ( ! sq1) return sq2 || null;
	if ( ! sq1.query) return sq2;
	if ( ! sq2.query) return sq1;

	// Same top-level op?
	if (op === sq1.tree![0] && op === sq2.tree![0]) {
		let newq = sq1.query+" "+op+" "+sq2.query;	
		return new SearchQuery(newq);
	}

	// CRUDE but it should work -- at least for simple cases
	let newq = bracket(sq1.query)+" "+op+" "+bracket(sq2.query);
	return new SearchQuery(newq);
};


/**
 * Add brackets if needed.
 * @param {!String} s 
 */
const bracket = (s: string): string => s.includes(" ")? "("+s+")" : s;


/**
 * Merge two queries with AND
 * @param {?String|SearchQuery} sq 
 * @returns {SearchQuery} a NEW SearchQuery
 */
SearchQuery.and = (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null): SearchQuery | null => {
	return SearchQuery.op(sq1, sq2, SearchQuery.AND);
}


/**
 * Remove sq2 from sq1, e.g. remove("foo AND bar", "bar") -> "foo"
 * @param {?String|SearchQuery} sq1
 * @param {?String|SearchQuery} sq2
 * @returns {SearchQuery} a NEW SearchQuery
 */
SearchQuery.remove = (sq1: SearchQuery | string | null, sq2: SearchQuery | string | null): SearchQuery | null => {
	return SearchQuery.op(sq1, sq2, SearchQuery.REMOVE);
}


/**
 * @param {?SearchQuery} sq 
 * @returns {!string}
 */
SearchQuery.str = (sq: SearchQuery | null | undefined): string => sq? sq.query : '';


/**
 * Convert a parse tree back into a query string
 * @param {Object[]|string} tree 
 * @returns {string}
 */
const unparse = (tree: any): string => {
	// a search term?
	if (typeof(tree)==='string') return tree;
	// key:value?
	if ( ! tree.length) {
		let keys = Object.keys(tree);
		assert(keys.length === 1);
		return keys[0]+":"+tree[keys[0]];
	}
	if (tree.length===1) return tree[0]; // just a sole keyword
	let op = tree[0];
	let bits = tree.slice(1);
	// TODO bracketing
	let ubits = bits.map(unparse);
	return ubits.join(" "+op+" ");
};


export default SearchQuery;

export function searchQueryToSqlWhereClause(sq: SearchQuery): string {
	// use the parse tree to convert to SQL
	console.log('sq.tree', sq.tree);
	return searchQueryToSqlWhereClause2(sq.tree!);
}

/**
 * recursive 
 */
function searchQueryToSqlWhereClause2(tree: any[]): string {
	if (typeof(tree) === 'string') {
		return "'"+tree+"'";
	}
	if (tree.length === 1) {
		return tree[0];
	}
	let op = tree[0];
	if (typeof(op) === 'object') {
		const v = op[Object.keys(op)[1]];
		return op[Object.keys(op)[0]]+"="+searchQueryToSqlWhereClause2(v);
	}	
	let bits = tree.slice(1);	
	console.log('bits', bits);
	let ubits = bits.map(searchQueryToSqlWhereClause2);
	return "("+ubits.join(" "+op+" ")+")";
}