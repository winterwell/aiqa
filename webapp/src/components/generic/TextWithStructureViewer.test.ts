import { describe, it, expect } from 'vitest';
import { extractBlocks, Block } from './TextWithStructureViewer';

describe('extractBlocks', () => {
	it('should return a single text block when no structured content is found', () => {
		const text = 'This is plain text with no structure.';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toEqual({
			type: 'text',
			text: 'This is plain text with no structure.',
			id: 0
		});
	});

	it('should extract a single JSON object block', () => {
		const text = '{"name": "test", "value": 123}';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('json');
		expect(blocks[0].json).toEqual({ name: 'test', value: 123 });
	});

	it('should extract a single JSON array block', () => {
		const text = '[1, 2, 3, "test"]';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('json');
		expect(blocks[0].json).toEqual([1, 2, 3, 'test']);
	});

	it('should extract a single XML block', () => {
		const text = '<root>Hello World</root>';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('xml');
		expect(blocks[0].xml).toBe('<root>Hello World</root>');
	});

	it('should extract text before and after a JSON block', () => {
		const text = 'Before text\n{"key": "value"}\nAfter text';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(3);
		expect(blocks[0].type).toBe('text');
		expect(blocks[0].text).toBe('Before text');
		expect(blocks[1].type).toBe('json');
		expect(blocks[1].json).toEqual({ key: 'value' });
		expect(blocks[2].type).toBe('text');
		expect(blocks[2].text).toBe('After text');
	});

	it('should extract multiple JSON blocks', () => {
		const text = '{"first": 1}\n{"second": 2}';
		const blocks = extractBlocks(text);
		
		expect(blocks.length).toBeGreaterThanOrEqual(2);
		const jsonBlocks = blocks.filter(b => b.type === 'json');
		expect(jsonBlocks).toHaveLength(2);
		expect(jsonBlocks[0].json).toEqual({ first: 1 });
		expect(jsonBlocks[1].json).toEqual({ second: 2 });
	});

	it('should extract nested JSON objects', () => {
		const text = '{"outer": {"inner": "value"}}';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('json');
		expect(blocks[0].json).toEqual({ outer: { inner: 'value' } });
	});

	it('should handle JSON with strings containing brackets', () => {
		const text = '{"message": "This has [brackets] in it"}';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('json');
		expect(blocks[0].json).toEqual({ message: 'This has [brackets] in it' });
	});

	it('should handle JSON with escaped quotes', () => {
		const text = '{"quote": "He said \\"hello\\""}';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('json');
		expect(blocks[0].json).toEqual({ quote: 'He said "hello"' });
	});

	it('should extract XML block with content', () => {
		const text = '<message>Hello World</message>';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('xml');
		expect(blocks[0].xml).toBe('<message>Hello World</message>');
	});

	it('should extract XML block with nested tags', () => {
		const text = '<root><child>Content</child></root>';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('xml');
		expect(blocks[0].xml).toBe('<root><child>Content</child></root>');
	});

	it('should extract text, XML, and JSON blocks together', () => {
		const text = 'Start text\n<tag>XML content</tag>\n{"json": "data"}\nEnd text';
		const blocks = extractBlocks(text);
		
		expect(blocks.length).toBeGreaterThanOrEqual(3);
		expect(blocks.some(b => b.type === 'text' && b.text?.includes('Start text'))).toBe(true);
		expect(blocks.some(b => b.type === 'xml' && b.xml?.includes('<tag>'))).toBe(true);
		expect(blocks.some(b => b.type === 'json' && b.json && typeof b.json === 'object' && b.json.json === 'data')).toBe(true);
	});

	it('should handle XML tags that start on a new line', () => {
		const text = 'Some text\n<root>Content</root>';
		const blocks = extractBlocks(text);
		
		expect(blocks.length).toBeGreaterThanOrEqual(2);
		const xmlBlock = blocks.find(b => b.type === 'xml');
		expect(xmlBlock).toBeDefined();
		expect(xmlBlock?.xml).toBe('<root>Content</root>');
	});

	it('should handle invalid JSON gracefully', () => {
		const text = '{invalid json}';
		const blocks = extractBlocks(text);
		
		// Should fall back to text or handle gracefully
		expect(blocks.length).toBeGreaterThan(0);
	});

	it('should handle XML without closing tag', () => {
		const text = '<unclosed>content';
		const blocks = extractBlocks(text);
		
		// Should handle gracefully, likely as text
		expect(blocks.length).toBeGreaterThan(0);
	});

	it('should handle empty string', () => {
		const text = '';
		const blocks = extractBlocks(text);
		
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('text');
		expect(blocks[0].text).toBe('');
	});

	it('should handle whitespace-only text', () => {
		const text = '   \n   ';
		const blocks = extractBlocks(text);
		
		// Should return a single text block or handle whitespace
		expect(blocks.length).toBeGreaterThan(0);
	});

	it('should assign unique IDs to blocks', () => {
		const text = 'Text 1\n{"json": 1}\nText 2\n{"json": 2}';
		const blocks = extractBlocks(text);
		
		const ids = blocks.map(b => b.id).filter(id => id !== undefined);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});
});

