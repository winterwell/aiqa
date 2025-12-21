import React, { useState } from 'react';
import CopyButton from './CopyButton';
import ExpandCollapseButton from './ExpandCollapseButton';

interface XmlNode {
	tag: string;
	attributes: Record<string, string>;
	children: (XmlNode | string)[];
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

function XmlNodeViewer({ node, textComponent }: { node: XmlNode, textComponent?: React.ComponentType<{ text: string }> }) {
	const [expanded, setExpanded] = useState(true);
	const $copyButton = <CopyButton content={node} />;
	const hasContent = node.children.length > 0 || Object.keys(node.attributes).length > 0;
	
	const attributeString = Object.keys(node.attributes).length > 0
		? ' ' + Object.entries(node.attributes).map(([key, value]) => `${key}="${value}"`).join(' ')
		: '';
	
	if (!expanded) {
		return (
			<div className="border rounded p-2 my-2" style={{ borderColor: '#e0e0e0' }}>
				<div className="d-flex align-items-center mb-1">
					<span className="text-muted fst-italic me-2">
						&lt;{node.tag}{attributeString}&gt; ({node.children.length} {node.children.length === 1 ? 'child' : 'children'})
					</span>
					<ExpandCollapseButton expanded={false} onClick={() => setExpanded(true)} />
					{hasContent && <span className="ms-2">{$copyButton}</span>}
				</div>
			</div>
		);
	}
	
	return (
		<div className="border rounded p-2 my-2" style={{ borderColor: '#e0e0e0' }}>
			<div className="d-flex align-items-center mb-1">
				<span className="fw-bold me-2" style={{ color: '#555' }}>
					&lt;{node.tag}{attributeString}&gt;
				</span>
				<ExpandCollapseButton expanded={true} onClick={() => setExpanded(false)} />
				{hasContent && <span className="ms-2">{$copyButton}</span>}
			</div>
			{node.children.map((child, index) => {
				if (typeof child === 'string') {
					if (textComponent) {
						const TextComponent = textComponent;
						return (
							<div key={index} className="my-2 ps-2" style={{ borderLeft: '2px solid #e0e0e0' }}>
								<TextComponent text={child} />
							</div>
						);
					}
					return (
						<div key={index} className="my-2 ps-2 text-muted" style={{ borderLeft: '2px solid #e0e0e0' }}>
							{child}
						</div>
					);
				} else {
					return (
						<div key={index} className="my-2 ps-2" style={{ borderLeft: '2px solid #e0e0e0' }}>
							<XmlNodeViewer node={child} textComponent={textComponent} />
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
export default function XmlObjectViewer({ xml, textComponent }: { xml: string, textComponent?: React.ComponentType<{ text: string }> }) {
	const [expanded, setExpanded] = useState(true);
	const parsed = parseXml(xml);
	const $copyButton = <CopyButton content={xml} />;
	
	if (!parsed) {
		// If parsing fails, show raw XML with expand/collapse
		if (xml.length > 1000) {
			return (
				<div className="border rounded p-2 my-2" style={{ borderColor: '#e0e0e0' }}>
					<div className="d-flex align-items-center mb-1">
						<span className="text-muted fst-italic me-2">XML ({xml.length} characters, parse failed)</span>
						<ExpandCollapseButton expanded={expanded} onClick={() => setExpanded(!expanded)} />
						<span className="ms-2">{$copyButton}</span>
					</div>
					{expanded && (
						<pre className="my-2" style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>{xml}</pre>
					)}
				</div>
			);
		}
		return (
			<div className="border rounded p-2 my-2" style={{ borderColor: '#e0e0e0' }}>
				<div className="d-flex align-items-center mb-1">
					<span className="text-muted fst-italic me-2">XML (parse failed)</span>
					<span className="ms-2">{$copyButton}</span>
				</div>
				<pre className="my-2" style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>{xml}</pre>
			</div>
		);
	}
	
	return <XmlNodeViewer node={parsed} textComponent={textComponent} />;
}