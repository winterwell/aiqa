

import React, { useState } from 'react';
import CopyButton from './CopyButton';
import ExpandCollapseControl from './ExpandCollapseControl';
import { truncate } from '../../common/utils/miscutils';

function _asString(value: any): string {
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value);
}

function getMessageContentObj(json: any): any | null {
	let baseContent = json.content || json.Content || (json.choices?.length > 0 ? json.choices[0].message?.content : null);
	return baseContent;
}

function getMessageContentText(json: any): string | null {
	let baseContent = getMessageContentObj(json);
	if ( ! baseContent) return null;
	// unwrap common chat message formats
	if (Array.isArray(baseContent) && baseContent.length === 1) {
		baseContent = baseContent[0];
	}
	if (typeof baseContent === "object") {
		if (baseContent.type === "text") {
			const text = baseContent.text;
			if (typeof text === "string") {
				return text;
			}
			return _asString(baseContent);
		}
		// Bedrock Converse format
		if (baseContent.value || baseContent.Value) {
			return _asString(baseContent.value || baseContent.Value);
		}
	}
	return _asString(baseContent === "string" ? baseContent : JSON.stringify(baseContent));
}

/**
 * A component to display a JSON object in a readable format.
 * with expandable/collapsable sections for each key.
 * Content: can handle string, object, xml, and json/xml-in-string provided TextComponent=TextWithStructureViewer.
 * Small copy buttons to copy the JSON (or sub-objects) to the clipboard.
 */
function MessageViewer({ json, textComponent, depth = 2 }: { json: any, textComponent?: React.ComponentType<{ text: string, depth?: number }>, depth?: number }) {	
	const TextComponent = textComponent;
	const [expanded, setExpanded] = useState(false);
	const $copyButton = <CopyButton content={json} logToConsole />
	let content = getMessageContentText(json);
	let role = json.role || json.Role;
	// HACK sniff tool use from e.g. Bedrock which uses role:user
	if (role==='user' && getMessageContentObj(json)?.ToolUseId) {
		role = 'tool';
	}
	const otherKVs = { ...json };
	delete otherKVs.role;
	delete otherKVs.Role;
	delete otherKVs.content;
	delete otherKVs.Content;
	if (json.choices && json.choices.length === 1 && json.choices[0].message) {
		delete otherKVs.choices;
	}
	// clear out blanks
	Object.keys(otherKVs).forEach(key => {
		const v = otherKVs[key];
		if (v === null || v === undefined || v === '' || v === 'null' || (Array.isArray(v) && v.length === 0)) {
			delete otherKVs[key];
		}
	});
	//
	return <div className="my-2" style={{ marginLeft: '20px', border: '2px solid #ccc', borderRadius: '5px', padding: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
		<div className="d-flex align-items-center mb-1 w-100">			
			<div>
				<b className="ms-2 me-2">Role:</b>
				<span>
					{role === 'user' && <>🧑 </>}
					{role === 'assistant' && <>🤖 </>}
					{role === 'system' && <>📜 </>}
					{role === 'tool' && <>🛠️ </>}
					{role}
				</span>
			</div>
			<span className="ms-auto">{$copyButton}</span>
		</div>
		{content && <div className="my-1">
			<div style={{ display: 'flex', alignItems: 'center' }}>
				<b>Content:</b>
				<ExpandCollapseControl
					hasChildren={true}
					isExpanded={expanded}
					onToggle={() => setExpanded(!expanded)}
				/>
			</div>
			{expanded
				? (typeof content === "string" ? <TextComponent text={content} depth={depth - 1} /> : <JsonObjectViewer json={content} textComponent={textComponent} depth={depth - 1} />)
				: <TruncatedText text={typeof content === "string" ? content : JSON.stringify(content)} maxLength={100} setExpanded={setExpanded} />
			}			
		</div>}
		{Object.keys(otherKVs).length > 0 && (
			<div className="my-2 ps-2" style={{ borderLeft: '2px solid #e0e0e0', maxWidth: '100%', minWidth: 0 }}>
				Other: <JsonObjectViewer json={otherKVs} textComponent={textComponent} depth={depth - 1} />
			</div>
		)}
	</div>;
}

function TruncatedText({ text, maxLength, setExpanded }: { text: string, maxLength: number, setExpanded: (expanded: boolean) => void }) {
	if (text.length <= maxLength) {
		return <span>{text}</span>;
	}
	return <div style={{ display: 'inline-block' }}>{text.substring(0, maxLength)} <span onClick={() => setExpanded(true)} style={{ cursor: 'pointer' }}>...</span></div>;
}


function isChatMessage(json: any): boolean {
	if ( ! json) return false;
	if (json.role && json.content) return true;
	if (json.Role && json.Content) return true;
	if (json.role ==="assistant") return true;
	// HACK is this an LLM chat response? Recognise OpenAI and other common formats
	if (json.choices && json.choices.length > 0 && json.choices[0].message?.content) {
		return true;
	}
	return false;
}

export default function JsonObjectViewer({ json, textComponent, depth = 2 }: { json: any, textComponent?: React.ComponentType<{ text: string, depth?: number }>, depth?: number }) {	
	const [localDepth, setLocalDepth] = useState<number | null>(null);
	const effectiveDepth = localDepth !== null ? localDepth : depth;
	const expanded = effectiveDepth > 0;
	const [arrayFullyExpanded, setArrayFullyExpanded] = useState(false);
	if (json===null || json===undefined) {
		return null;
	}
	const $copyButton = <CopyButton content={json} logToConsole />

	// HACK is this a chat message?
	if (isChatMessage(json)) {
		return <MessageViewer json={json} textComponent={textComponent} depth={depth} />
	}

	if (Array.isArray(json)) {
		if (json.length === 0) {
			return <span className="text-muted">[]</span>;
		}
		// Single-item array: expand by default (same idea as single-key object below)
		if (json.length === 1 && localDepth === null && effectiveDepth <= 0) {
			setLocalDepth(1);
		}
		const itemsToShow = arrayFullyExpanded ? json.length : Math.min(3, json.length);
		const hasMore = json.length > 3;

		if (!expanded) {
			return (
				<div className="my-2" style={{ marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
					<div className="d-flex align-items-center mb-1">
						<ExpandCollapseControl hasChildren={true} isExpanded={false} onToggle={() => setLocalDepth(1)} />
						<span className="text-muted fst-italic me-2">Array ({json.length} items)</span>
						{json.length > 0 && <span className="ms-2">{$copyButton}</span>}
					</div>
				</div>
			);
		}

		return (
			<div className="my-2" style={{ marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
				<div className="d-flex align-items-center mb-1">
					<ExpandCollapseControl hasChildren={true} isExpanded={true} onToggle={() => setLocalDepth(0)} />
					<span className="text-muted fst-italic me-2">Array ({json.length} items)</span>
					{json.length > 0 && <span className="ms-2">{$copyButton}</span>}
				</div>
				{json.slice(0, itemsToShow).map((item, index) => (
					<div key={index} className="my-2 ps-2" style={{ borderLeft: '2px solid #e0e0e0', maxWidth: '100%', minWidth: 0 }}>
						<JsonObjectViewer json={item} textComponent={textComponent} depth={effectiveDepth - 1} />
					</div>
				))}
				{hasMore && !arrayFullyExpanded && (
					<button
						className="btn btn-sm btn-link mt-2 p-0"
						onClick={() => setArrayFullyExpanded(true)}
						style={{ fontSize: '12px' }}
					>
						Expand to see {json.length - 3} more items
					</button>
				)}
				{hasMore && arrayFullyExpanded && (
					<button
						className="btn btn-sm btn-link mt-2 p-0"
						onClick={() => setArrayFullyExpanded(false)}
						style={{ fontSize: '12px' }}
					>
						Collapse to show 3 items
					</button>
				)}
			</div>
		);
	}
	if (typeof (json) === 'object' && json !== null) {
		const hasKeys = Object.keys(json).length > 0;
		const keyCount = Object.keys(json).length;
		// no keys - show as empty object without a new line
		if (keyCount === 0) {
			return <span className="text-muted">{'{}'}</span>;
		}
		// if keyCount == 1 then expand by default
		if (keyCount === 1 && localDepth === null && !expanded) {
			setLocalDepth(1);
		}

		if (!expanded) {
			let summary;
			for(const key of ['name', 'description', 'title', 'summary', 'message', 'error']) {
				if (json[key]) {
					let v = json[key];
					let vs = ""+v;
					if (typeof v === 'number') {
						vs = v.toFixed(2);
					} else if (typeof v === 'boolean') {
						vs = v ? "true" : "false";
					} else if (typeof v === 'object') {
						vs = JSON.stringify(v);
					}
					summary = <span className="text-muted me-2">{key}: {truncate(vs, 60)}</span>;
					break;
				}
			}
			return (
				<div className="my-2" style={{ marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
					<div className="d-flex align-items-center mb-1">
						<ExpandCollapseControl hasChildren={true} isExpanded={false} onToggle={() => setLocalDepth(1)} />
						<span className="text-muted fst-italic me-2">Object ({keyCount} keys) {summary}</span>
						{hasKeys && <span className="ms-2">{$copyButton}</span>}
					</div>
				</div>
			);
		}

		return (
			<div className="my-2" style={{ marginLeft: '20px', borderLeft: '2px solid #ccc', paddingLeft: '10px', maxWidth: '100%', minWidth: 0, overflowX: 'auto' }}>
				<div className="d-flex align-items-center mb-1">
					<ExpandCollapseControl hasChildren={true} isExpanded={true} onToggle={() => setLocalDepth(0)} />
					<span className="text-muted fst-italic me-2">Object ({keyCount} keys)</span>
					{hasKeys && <span className="ms-2">{$copyButton}</span>}
				</div>
				{Object.entries(json).map(([key, value]) => {
					// Check if value is a short primitive that can be shown inline
					const isShortPrimitive =
						(typeof value === 'string' && value.length < 100) ||
						typeof value === 'number' ||
						typeof value === 'boolean' ||
						value === null ||
						value === undefined;

					if (isShortPrimitive) {
						// Show key: value on the same line
						return (
							<div key={key} className="my-1" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', maxWidth: '100%', minWidth: 0 }}>
								<span className="fw-bold me-2" style={{ color: '#555' }}>{key}:</span>
								<span>{String(value)}</span>
							</div>
						);
					}

					// For complex values, show on separate line
					return (
						<div key={key} className="my-2" style={{ maxWidth: '100%', minWidth: 0 }}>
							<span className="fw-bold me-2" style={{ color: '#555' }}>{key}:</span>
							<JsonObjectViewer json={value} textComponent={textComponent} depth={effectiveDepth - 1} />
						</div>
					);

				})}
			</div>
		);
	}
	if (json === null || json === undefined) {
		return null;
	}
	if (typeof json === 'string' && textComponent) {
		const TextComponent = textComponent;
		return <TextComponent text={json} depth={effectiveDepth - 1} />;
	}
	return <span className="text-muted">{"" + json}</span>;
}