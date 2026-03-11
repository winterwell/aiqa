import { useState } from 'react';
import JsonObjectViewer from './JsonObjectViewer';
import XmlObjectViewer from './XmlObjectViewer';
import ExpandCollapseControl from './ExpandCollapseControl';
import CopyButton from './CopyButton';
import { extractBlocks, Block } from './extractBlocks';

export type { Block };

/**
 * For viewing LLM input and output (which could be big).
 * TODO show (with expand/collapse bits) text that may have
 * xml tags or json blobs in it.
 */
export default function TextWithStructureViewer({text, depth = 2}: {text: string, depth?: number}) {
	const blocks = extractBlocks(text);
	// render
	return <div style={{ maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
		{blocks.map((block) => {
			return <div key={block.id} style={{ maxWidth: '100%', minWidth: 0 }}>
				{block.type === 'text' && <TextViewer text={block.text!} depth={depth} />}
				{block.type === 'xml' && <XmlObjectViewer xml={block.xml!} textComponent={TextWithStructureViewer} depth={depth} />}
				{block.type === 'json' && <JsonObjectViewer json={block.json} textComponent={TextWithStructureViewer} depth={depth} />}
			</div>
		})}
	</div>
}

function format(text: string) {
	// detect some markdown and convert
	// html line-breaks
	text = text.replace(/\r?\n/g, '<br />');
	// html encoded line-breaks
	text = text.replace(/\\n/g, '<br />');	
	return text;
}  

/**
 * Show potentially big text
 */
function TextViewer({ text, depth = 2 }: { text: string, depth?: number }) {
	const [localDepth, setLocalDepth] = useState<number | null>(null);
	const effectiveDepth = localDepth !== null ? localDepth : depth;
	const expanded = effectiveDepth > 0;
	
	if (text.length > 1000) {
		return (
			<div style={{ maxWidth: '100%', minWidth: 0 }}>
				<div className="d-flex align-items-center mb-1">
					<ExpandCollapseControl hasChildren={true} isExpanded={expanded} onToggle={() => setLocalDepth(expanded ? 0 : 1)} />
					<span className="text-muted fst-italic me-2">Text ({text.length} characters)</span>
					<span className="ms-2"><CopyButton content={text} logToConsole /></span>
				</div>
				{expanded ? (
					<div dangerouslySetInnerHTML={{ __html: format(text) }} style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', maxWidth: '100%', minWidth: 0 }} />
				) : (
					<div dangerouslySetInnerHTML={{ __html: format(text.slice(0, 1000)) + '...' }} style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', maxWidth: '100%', minWidth: 0, maxHeight:'250px', overflowY: 'hidden' }} />
				)}
			</div>
		);
	}
	return <div dangerouslySetInnerHTML={{ __html: format(text) }} style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', maxWidth: '100%', minWidth: 0 }} />
}
