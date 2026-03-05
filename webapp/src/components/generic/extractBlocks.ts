export type Block = {
	type: 'text' | 'xml' | 'json';
	text?: string;
	xml?: string;
	json?: any;
	id?: number;
};

type JsonExtractionResult = {
	success: boolean;
	endPos: number;
	jsonContent?: any;
	/** true if the JSON was patched to complete it */
	patched?: boolean;
};

/**
 * Extract a JSON block from text starting at the given position.
 * Supports truncated JSON by completing unclosed brackets/braces.
 * 
 * @param text - The full text
 * @param startPos - Starting position of the JSON block (should be at '{' or '[')
 * @returns Result with success flag, end position, and parsed JSON if successful
 */
export function extractBlockJson(text: string, startPos: number): JsonExtractionResult {
	const openingChar = text[startPos];
	if (openingChar !== '{' && openingChar !== '[') {
		return { success: false, endPos: startPos };
	}

	const closingChar = openingChar === '{' ? '}' : ']';
	let depth = 1; // Start at 1 since we're already at the opening bracket
	let inString = false;
	let escapeNext = false;
	let endPos = startPos;
	let lastUnescapedNewline = -1;

	// First pass: try to find the closing bracket normally
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
			if (char === '\n' || char === '\r') {
				lastUnescapedNewline = j;
			}
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

	// If we found a closing bracket, try to parse normally
	if (endPos > startPos) {
		const jsonString = text.slice(startPos, endPos);
		try {
			const jsonContent = JSON.parse(jsonString);
			return { success: true, endPos, jsonContent };
		} catch (e) {
			// Normal parsing failed, fall through to truncated JSON handling
		}
	}

	// Check if this looks like truncated JSON (no unescaped line-breaks between start and end)
	// If we didn't find a closing bracket and there are no unescaped newlines after startPos,
	// it likely means the JSON was truncated
	const looksTruncated = endPos === startPos && lastUnescapedNewline === -1;
	
	if (!looksTruncated) {
		// Doesn't look truncated, return failure
		return { success: false, endPos: startPos };
	}

	// Handle truncated JSON: re-parse to track structure and complete it
	// Reset state for second pass
	depth = 1;
	inString = false;
	escapeNext = false;
	endPos = text.length; // Use end of string as the end position
	
	// Track what type of closers we need (object vs array)
	const openerStack: ('{' | '[')[] = [openingChar as '{' | '['];
	let expectingValue = false; // True if we just saw ':' and need a value

	// Second pass: track the structure to know what needs closing
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
			if (!inString) {
				// Just closed a string
				expectingValue = false;
			}
			continue;
		}
		if (!inString) {
			if (char === '{') {
				depth++;
				openerStack.push('{');
				expectingValue = false;
			} else if (char === '[') {
				depth++;
				openerStack.push('[');
				expectingValue = false;
			} else if (char === '}' || char === ']') {
				depth--;
				if (openerStack.length > 0) {
					openerStack.pop();
				}
				expectingValue = false;
			} else if (char === ':') {
				// Key-value separator - we're now expecting a value
				expectingValue = true;
			} else if (char === ',' || char === '}') {
				// End of value
				expectingValue = false;
			}
		}
	}

	// Build the completed JSON string
	let completedJson = text.slice(startPos);
	
	// Close any unclosed strings
	if (inString) {
		completedJson += '"';
	}

	// If we're expecting a value (just saw ':'), check if we have a partial value
	if (expectingValue) {
		// Check if there's any content after the last ':'
		// Find the last ':' in the completed JSON
		const lastColonIndex = completedJson.lastIndexOf(':');
		if (lastColonIndex !== -1) {
			const afterColon = completedJson.slice(lastColonIndex + 1).trim();
			// If there's non-whitespace content after ':', we have a partial value
			// Only add null if there's nothing after the colon
			if (afterColon.length === 0) {
				completedJson = completedJson.trimEnd();
				completedJson += ' null';
			}
			// Otherwise, we assume the partial value is valid (e.g., "123" or "true")
		} else {
			// No colon found, shouldn't happen but be safe
			completedJson = completedJson.trimEnd();
			completedJson += ' null';
		}
	}

	// Close any unclosed objects/arrays in reverse order
	for (let i = openerStack.length - 1; i >= 0; i--) {
		const opener = openerStack[i];
		if (opener === '{') {
			completedJson += '}';
		} else if (opener === '[') {
			completedJson += ']';
		}
	}

	// Try to parse the completed JSON
	try {
		const jsonContent = JSON.parse(completedJson);
		return { success: true, endPos, jsonContent, patched: true };
	} catch (e) {
		return { success: false, endPos: startPos };
	}
}

/**
 * Extract blocks from text that may contain XML tags or JSON objects/arrays.
 * Blocks must start on a new line.
 * If text is "json" or "xml", then strip the wrapping quotes.
 * 
 * @param text - The text to parse
 * @returns Array of blocks with type 'text', 'xml', or 'json'
 */
export function extractBlocks(text: string): Block[] {
	const blocks: Block[] = [];
	
	// Ensure text is a string
	if (text == null) {
		return [{type: 'text', text: '', id: 0}];
	}
	let textStr = String(text);
	if (textStr.startsWith('"') && textStr.endsWith('"')) {
		textStr = textStr.slice(1, -1);
	}
	// Blocks MUST start on a new line. This is a deliberate design limitation to avoid false-positive detection of blocks in the middle of text.
	// Look for xml blocks which start a line with <tag and end with </tag> 
	// or json blocks	
	const blockStart = /^(<[a-zA-Z][a-zA-Z0-9_]*|{|\[)/gm;
	const matches = Array.from(textStr.matchAll(blockStart));
	
	if (matches.length === 0) {
		// No structured blocks found, return entire text as a single text block
		return [{type: 'text', text: textStr, id: 0}];
	}
	
	let lastIndex = 0;
	let blockId = 0;
	
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i] as RegExpMatchArray;
		const matchIndex = match.index!;
		
		// Skip matches that are already inside a previously processed block
		// (e.g., nested XML/JSON that starts on a new line)
		if (matchIndex < lastIndex) {
			continue;
		}
		
		// Add text block before this match if there's any text
		if (matchIndex > lastIndex) {
			const textBefore = textStr.slice(lastIndex, matchIndex).trim();
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
				const closingPos = textStr.indexOf(closingTag, startPos);
				if (closingPos !== -1) {
					const xmlContent = textStr.slice(startPos, closingPos + closingTag.length);
					blocks.push({type: 'xml', xml: xmlContent, id: blockId++});
					lastIndex = closingPos + closingTag.length;
				} else {
					// No closing tag found, treat as text
					lastIndex = matchIndex + 1;
				}
			}
		} else if (matchedText === '{' || matchedText === '[') {
			// JSON block - use extractBlockJson
			const startPos = matchIndex;
			const result = extractBlockJson(textStr, startPos);
			
			if (result.success && result.jsonContent !== undefined) {
				blocks.push({type: 'json', json: result.jsonContent, id: blockId++});
				lastIndex = result.endPos;
			} else {
				// Invalid or incomplete JSON, treat as text
				lastIndex = matchIndex + 1;
			}
		}
	}
	
	// Add remaining text after last match
	if (lastIndex < textStr.length) {
		const remainingText = textStr.slice(lastIndex).trim();
		if (remainingText) {
			blocks.push({type: 'text', text: remainingText, id: blockId++});
		}
	}
	
	// Fallback if no blocks were created
	if (blocks.length === 0) {
		return [{type: 'text', text: textStr, id: 0}];
	}
	
	return blocks;
}

