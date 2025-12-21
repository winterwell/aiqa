import { useState } from 'react';
import JsonObjectViewer from './JsonObjectViewer';
import XmlObjectViewer from './XmlObjectViewer';
import ExpandCollapseButton from './ExpandCollapseButton';

export type Block = {
	type: 'text' | 'xml' | 'json';
	text?: string;
	xml?: string;
	json?: any;
	id?: number;
};

/**
 * Extract blocks from text that may contain XML tags or JSON objects/arrays.
 * Blocks must start on a new line.
 * 
 * @param text - The text to parse
 * @returns Array of blocks with type 'text', 'xml', or 'json'
 */
export function extractBlocks(text: string): Block[] {
	const blocks: Block[] = [];
	// Blocks must start on a new line.
	// Look for xml blocks which start a line with <tag and end with </tag> 
	// or json blocks	
	const blockStart = /^(<[a-zA-Z][a-zA-Z0-9_]*|{|\[)/gm;
	const matches = Array.from(text.matchAll(blockStart));
	
	if (matches.length === 0) {
		// No structured blocks found, return entire text as a single text block
		return [{type: 'text', text, id: 0}];
	}
	
	let lastIndex = 0;
	let blockId = 0;
	
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i] as RegExpMatchArray;
		const matchIndex = match.index!;
		
		// Add text block before this match if there's any text
		if (matchIndex > lastIndex) {
			const textBefore = text.slice(lastIndex, matchIndex).trim();
			if (textBefore) {
				blocks.push({type: 'text', text: textBefore, id: blockId++});
			}
		}
		
		// Determine block type and extract content
		const matchedText = match[0];
		if (matchedText.startsWith('<')) {
			// XML block - extract tag name and find closing tag
			const tagMatch = matchedText.match(/^<([a-zA-Z][a-zA-Z0-9_]*)/);
			if (tagMatch) {
				const tagName = tagMatch[1];
				const closingTag = `</${tagName}>`;
				const startPos = matchIndex;
				// Find the closing tag (search from the start of the match)
				const closingPos = text.indexOf(closingTag, startPos);
				if (closingPos !== -1) {
					const xmlContent = text.slice(startPos, closingPos + closingTag.length);
					blocks.push({type: 'xml', xml: xmlContent, id: blockId++});
					lastIndex = closingPos + closingTag.length;
				} else {
					// No closing tag found, treat as text
					lastIndex = matchIndex + 1;
				}
			}
		} else if (matchedText === '{' || matchedText === '[') {
			// JSON block - parse until matching closing bracket
			const startPos = matchIndex;
			let depth = 1; // Start at 1 since we're already at the opening bracket
			let inString = false;
			let escapeNext = false;
			let endPos = startPos;
			
			for (let j = startPos + 1; j < text.length; j++) {
				const char = text[j];
				if (escapeNext) {
					escapeNext = false;
					continue;
				}
				if (char === '\\') {
					escapeNext = true;
					continue;
				}
				if (char === '"' && !escapeNext) {
					inString = !inString;
					continue;
				}
				if (!inString) {
					if (char === '{' || char === '[') {
						depth++;
					} else if (char === '}' || char === ']') {
						depth--;
						if (depth === 0) {
							endPos = j + 1;
							break;
						}
					}
				}
			}
			
			if (endPos > startPos) {
				const jsonString = text.slice(startPos, endPos);
				try {
					const jsonContent = JSON.parse(jsonString);
					blocks.push({type: 'json', json: jsonContent, id: blockId++});
					lastIndex = endPos;
				} catch (e) {
					// Invalid JSON, treat as text
					lastIndex = matchIndex + 1;
				}
			} else {
				lastIndex = matchIndex + 1;
			}
		}
	}
	
	// Add remaining text after last match
	if (lastIndex < text.length) {
		const remainingText = text.slice(lastIndex).trim();
		if (remainingText) {
			blocks.push({type: 'text', text: remainingText, id: blockId++});
		}
	}
	
	// Fallback if no blocks were created
	if (blocks.length === 0) {
		return [{type: 'text', text, id: 0}];
	}
	
	return blocks;
}

/**
 * For viewing LLM input and output (which could be big).
 * TODO show (with expand/collapse bits) text that may have
 * xml tags or json blobs in it.
 */
export default function TextWithStructureViewer({text}) {
	const blocks = extractBlocks(text);
	// render
	return <div>
		{blocks.map((block) => {
			return <div key={block.id}>
				{block.type === 'text' && <TextViewer text={block.text!} />}
				{block.type === 'xml' && <XmlObjectViewer xml={block.xml!} textComponent={TextWithStructureViewer} />}
				{block.type === 'json' && <JsonObjectViewer json={block.json} textComponent={TextWithStructureViewer} />}
			</div>
		})}
	</div>
}

function format(text: string) {
	return text.replace(/\r?\n/g, '<br />');
}

/**
 * Show potentially big text
 */
function TextViewer({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	if (text.length > 1000) {
		return (
			<div>
				<div className="d-flex align-items-center mb-1">
					<span className="text-muted fst-italic me-2">Text ({text.length} characters)</span>
					<ExpandCollapseButton expanded={expanded} onClick={() => setExpanded(!expanded)} />
				</div>
				{expanded ? (
					<div dangerouslySetInnerHTML={{ __html: format(text) }} />
				) : (
					<div dangerouslySetInnerHTML={{ __html: format(text.slice(0, 1000)) + '...' }} />
				)}
			</div>
		);
	}
	return <div dangerouslySetInnerHTML={{ __html: format(text) }} />
}
