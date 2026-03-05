import { describe, it, expect } from 'vitest';
import { extractBlocks, extractBlockJson } from './extractBlocks';

describe('extractBlocks', () => {
	it('returns single text block for plain text', () => {
		const blocks = extractBlocks('Just some text.');
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toEqual({ type: 'text', text: 'Just some text.', id: 0 });
	});

	it('strips wrapping quotes when input is quoted string', () => {
		// Input: "{"a": 1}" → after strip → {"a": 1}
		const blocks = extractBlocks('"{"a": 1}"');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('json');
		expect(blocks[0].json).toEqual({ a: 1 });
	});

	it('treats null/undefined as empty text', () => {
		const blocks = extractBlocks(null as unknown as string);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toEqual({ type: 'text', text: '', id: 0 });
	});

	it('only detects blocks that start on a new line', () => {
		// JSON in the middle of a line is not extracted as a block
		const blocks = extractBlocks('prefix {"a": 1} suffix');
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('text');
		expect(blocks[0].text).toContain('{"a": 1}');
	});

	it('extracts JSON and XML when they start at line start', () => {
		const blocks = extractBlocks('intro\n{"x": 1}\n<root>hi</root>\noutro');
		expect(blocks.length).toBeGreaterThanOrEqual(2);
		const jsonBlock = blocks.find(b => b.type === 'json');
		const xmlBlock = blocks.find(b => b.type === 'xml');
		expect(jsonBlock?.json).toEqual({ x: 1 });
		expect(xmlBlock?.xml).toBe('<root>hi</root>');
	});
});

describe('extractBlockJson', () => {
	it('returns failure when start position is not { or [', () => {
		expect(extractBlockJson('abc', 0)).toEqual({ success: false, endPos: 0 });
		expect(extractBlockJson('x [1]', 0)).toEqual({ success: false, endPos: 0 });
	});

	it('parses complete JSON and returns endPos', () => {
		const text = '{"a": 1}';
		const result = extractBlockJson(text, 0);
		expect(result.success).toBe(true);
		expect(result.jsonContent).toEqual({ a: 1 });
		expect(result.endPos).toBe(text.length);
		expect(result.patched).toBeUndefined();
	});

	it('patches truncated JSON and sets patched flag', () => {
		const result = extractBlockJson('{"name": "x", "n":', 0);
		expect(result.success).toBe(true);
		expect(result.jsonContent).toEqual({ name: 'x', n: null });
		expect(result.patched).toBe(true);
	});

	it('extracts from middle of string when startPos is given', () => {
		const text = 'ignore {"k": "v"} rest';
		const result = extractBlockJson(text, 7);
		expect(result.success).toBe(true);
		expect(result.jsonContent).toEqual({ k: 'v' });
		expect(result.endPos).toBe(17); // position after closing '}'
	});
});
