import React, { useState } from 'react';
import CopyButton from './CopyButton';
import ExpandCollapseControl from './ExpandCollapseControl';

interface XmlNode {
	tag: string;
	attributes: Record<string, string>;
	children: (XmlNode | string)[];
}

// Safe HTML tags that can be rendered as HTML
// Includes common formatting, structural, and semantic tags that are safe for display
const SAFE_HTML_TAGS = new Set([
	// blah
	'html', 'body',
	// Text formatting
	'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'small', 'sub', 'sup', 'mark',
	// Structural
	'p', 'div', 'span', 'br', 'hr',
	// Headings
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	// Lists
	'ul', 'ol', 'li', 'dl', 'dt', 'dd',
	// Tables
	'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col',
	// Semantic HTML5 - no - useful to see as block structure
	// 'article', 'section', 'aside', 'header', 'footer', 'nav', 'main',
	// Other
	'blockquote', 'pre', 'code', 'q', 'cite', 'abbr', 'dfn', 'kbd', 'samp', 'var', 'time', 'address',
	// Media
	'img'
]);

/**
 * Check if a node is safe to render as HTML
 */
function isSafeHtmlNode(node: XmlNode): boolean {
	const tagLower = node.tag.toLowerCase();
	
	// Check if tag is in the safe list
	if (!SAFE_HTML_TAGS.has(tagLower)) {
		return false;
	}
	
	// Check attributes - only allow class, style, and for img: src
	const allowedAttrs = tagLower === 'img' 
		? new Set(['class', 'style', 'src'])
		: new Set(['class', 'style']);
	
	for (const attrName of Object.keys(node.attributes)) {
		if (!allowedAttrs.has(attrName.toLowerCase())) {
			return false;
		}
	}
	
	return true;
}

/**
 * Serialize an XmlNode to HTML string
 */
function serializeNodeToHtml(node: XmlNode): string {
	const tagLower = node.tag.toLowerCase();
	const attrs = Object.entries(node.attributes)
		.map(([key, value]) => `${key}="${value.replace(/"/g, '&quot;')}"`)
		.join(' ');
	const attrString = attrs ? ' ' + attrs : '';
	
	// Self-closing tags
	if (tagLower === 'hr' || tagLower === 'img' || tagLower === 'br') {
		return `<${node.tag}${attrString} />`;
	}
	
	// Regular tags with children
	const childrenHtml = node.children.map(child => {
		if (typeof child === 'string') {
			return escapeHtml(child);
		} else {
			return serializeNodeToHtml(child);
		}
	}).join('');
	
	return `<${node.tag}${attrString}>${childrenHtml}</${node.tag}>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Parse XML string into a tree structure
 */
function parseXml(xml: string): XmlNode | null {
	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xml, 'text/xml');
		
		// Check for parsing errors
		const parserError = doc.querySelector('parsererror');
		if (parserError) {
			return null;
		}
		
		const rootElement = doc.documentElement;
		if (!rootElement) {
			return null;
		}
		
		return parseElement(rootElement);
	} catch (e) {
		return null;
	}
}

function parseElement(element: Element): XmlNode {
	const attributes: Record<string, string> = {};
	for (let i = 0; i < element.attributes.length; i++) {
		const attr = element.attributes[i];
		attributes[attr.name] = attr.value;
	}
	
	const children: (XmlNode | string)[] = [];
	for (let i = 0; i < element.childNodes.length; i++) {
		const node = element.childNodes[i];
		if (node.nodeType === Node.ELEMENT_NODE) {
			children.push(parseElement(node as Element));
		} else if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent?.trim();
			if (text) {
				children.push(text);
			}
		}
	}
	
	return {
		tag: element.tagName,
		attributes,
		children
	};
}

function XmlNodeViewer({ node, textComponent, depth = 2 }: { node: XmlNode, textComponent?: React.ComponentType<{ text: string, depth?: number }>, depth?: number }) {
	const [localDepth, setLocalDepth] = useState<number | null>(null);
	const effectiveDepth = localDepth !== null ? localDepth : depth;
	const expanded = effectiveDepth > 0;
	const $copyButton = <CopyButton content={node} />;
	const hasContent = node.children.length > 0 || Object.keys(node.attributes).length > 0;
	
	// Check if this node should be rendered as HTML
	// Only render as HTML if the node is safe AND all children are safe (or strings)
	const isSafeHtml = isSafeHtmlNode(node);
	const allChildrenSafe = node.children.every(child => 
		typeof child === 'string' || isSafeHtmlNode(child)
	);
	const shouldRenderAsHtml = isSafeHtml && allChildrenSafe;
	
	const attributeString = Object.keys(node.attributes).length > 0
		? ' ' + Object.entries(node.attributes).map(([key, value]) => `${key}="${value}"`).join(' ')
		: '';
	
	// Render as HTML if safe and all children are safe
	if (shouldRenderAsHtml) {
		const htmlContent = serializeNodeToHtml(node);
		return (
			<div className="my-2" dangerouslySetInnerHTML={{ __html: htmlContent }} style={{ maxWidth: '100%', minWidth: 0, overflowX: 'auto', wordBreak: 'break-all', overflowWrap: 'anywhere' }} />
		);
	}
	
	// Otherwise render as XML structure
	if (!expanded) {
		return (
			<div className="my-2" style={{ marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
				<div className="d-flex align-items-center mb-1">
					<ExpandCollapseControl hasChildren={true} isExpanded={false} onToggle={() => setLocalDepth(1)} />
					<span className="text-muted fst-italic me-2">
						&lt;{node.tag}{attributeString}&gt; ({node.children.length} {node.children.length === 1 ? 'child' : 'children'})
					</span>
					{hasContent && <span className="ms-2">{$copyButton}</span>}
				</div>
			</div>
		);
	}
	
	return (
		<div className="my-2" style={{ marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
			<div className="d-flex align-items-center mb-1">
				<ExpandCollapseControl hasChildren={true} isExpanded={true} onToggle={() => setLocalDepth(0)} />
				<span className="fw-bold me-2" style={{ color: '#555' }}>
					&lt;{node.tag}{attributeString}&gt;
				</span>
				{hasContent && <span className="ms-2">{$copyButton}</span>}
			</div>
			{node.children.map((child, index) => {
				if (typeof child === 'string') {
					if (textComponent) {
						const TextComponent = textComponent;
						return (
							<div key={index} className="my-2 ps-2" style={{ borderLeft: '2px solid #e0e0e0', maxWidth: '100%', minWidth: 0 }}>
								<TextComponent text={child} depth={effectiveDepth - 1} />
							</div>
						);
					}
					return (
						<div key={index} className="my-2 ps-2 text-muted" style={{ borderLeft: '2px solid #e0e0e0', wordBreak: 'break-all', overflowWrap: 'anywhere', maxWidth: '100%', minWidth: 0 }}>
							{child}
						</div>
					);
				} else {
					return (
						<div key={index} className="my-2 ps-2" style={{ borderLeft: '2px solid #e0e0e0', maxWidth: '100%', minWidth: 0 }}>
							<XmlNodeViewer node={child} textComponent={textComponent} depth={effectiveDepth - 1} />
						</div>
					);
				}
			})}
			{node.children.length > 0 && (
				<div className="mt-1">
					<span className="fw-bold" style={{ color: '#555' }}>&lt;/{node.tag}&gt;</span>
				</div>
			)}
		</div>
	);
}

/** Show potentially big xml */
export default function XmlObjectViewer({ xml, textComponent, depth = 2 }: { xml: string, textComponent?: React.ComponentType<{ text: string, depth?: number }>, depth?: number }) {
	const [viewMode, setViewMode] = useState<'html' | 'text'>('html');
	const [localDepth, setLocalDepth] = useState<number | null>(null);
	const effectiveDepth = localDepth !== null ? localDepth : depth;
	const expanded = effectiveDepth > 0;
	const parsed = parseXml(xml);
	const $copyButton = <CopyButton content={xml} />;
	
	const toggleButtons = (
		<div className="btn-group btn-group-sm" role="group">
			<button
				type="button"
				className={`btn ${viewMode === 'html' ? 'btn-primary' : 'btn-outline-secondary'}`}
				onClick={() => setViewMode('html')}
			>
				HTML
			</button>
			<button
				type="button"
				className={`btn ${viewMode === 'text' ? 'btn-primary' : 'btn-outline-secondary'}`}
				onClick={() => setViewMode('text')}
			>
				Text
			</button>
		</div>
	);
	
	// Text view - show raw XML as plain text
	if (viewMode === 'text') {
		return (
			<div className="my-2" style={{ position: 'relative', marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0 }}>
				<div className="d-flex align-items-center justify-content-between mb-1">
					<div className="d-flex align-items-center">
						<span className="text-muted fst-italic me-2">XML</span>
						<span className="ms-2">{$copyButton}</span>
					</div>
					{toggleButtons}
				</div>
				<pre className="my-2" style={{ fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'anywhere', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>{xml}</pre>
			</div>
		);
	}
	
	// HTML view - show structured view
	if (!parsed) {
		// If parsing fails, show raw XML with expand/collapse
		if (xml.length > 1000) {
			return (
				<div className="my-2" style={{ position: 'relative', marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
					<div className="d-flex align-items-center justify-content-between mb-1">
						<div className="d-flex align-items-center">
							<ExpandCollapseControl hasChildren={true} isExpanded={expanded} onToggle={() => setLocalDepth(expanded ? 0 : 1)} />
							<span className="text-muted fst-italic me-2">XML ({xml.length} characters, parse failed)</span>
							<span className="ms-2">{$copyButton}</span>
						</div>
						{toggleButtons}
					</div>
					{expanded && (
						<pre className="my-2" style={{ fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'anywhere', maxWidth: '100%', minWidth: 0 }}>{xml}</pre>
					)}
				</div>
			);
		}
		return (
			<div className="my-2" style={{ position: 'relative', marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
				<div className="d-flex align-items-center justify-content-between mb-1">
					<div className="d-flex align-items-center">
						<span className="text-muted fst-italic me-2">XML (parse failed)</span>
						<span className="ms-2">{$copyButton}</span>
					</div>
					{toggleButtons}
				</div>
				<pre className="my-2" style={{ fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'anywhere', maxWidth: '100%', minWidth: 0 }}>{xml}</pre>
			</div>
		);
	}
	
	// Wrap the parsed view with toggle in top-right
	return (
		<div className="my-2" style={{ position: 'relative', marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0 }}>
			<div className="d-flex align-items-center justify-content-end mb-1" style={{ position: 'absolute', top: 0, right: 0, zIndex: 1 }}>
				{toggleButtons}
			</div>
			<div style={{ paddingTop: '30px' }}>
				<XmlNodeViewer node={parsed} textComponent={textComponent} depth={depth} />
			</div>
		</div>
	);
}