/**
 * A component to display a JSON object in a readable format, 
 * with expandable/collapsable sections for each key.
 * Large value shown truncated with a link to expand.
 * Small copy buttons to copy the JSON (or sub-objects) to the clipboard.
 */

import React, { useState } from 'react';
import CopyButton from './CopyButton';
import ExpandCollapseButton from './ExpandCollapseButton';

export default function JsonObjectViewer({ json, textComponent }: { json: any, textComponent?: React.ComponentType<{ text: string }> }) {
	const $copyButton = <CopyButton content={json} />
	const [expanded, setExpanded] = useState(true);
	const [arrayFullyExpanded, setArrayFullyExpanded] = useState(false);
	
	if (Array.isArray(json)) {
		const itemsToShow = arrayFullyExpanded ? json.length : Math.min(3, json.length);
		const hasMore = json.length > 3;
		
		if (!expanded) {
			return (
				<div className="border rounded p-2 my-2" style={{ borderColor: '#e0e0e0' }}>
					<div className="d-flex align-items-center mb-1">
						<span className="text-muted fst-italic me-2">Array ({json.length} items)</span>
						<ExpandCollapseButton expanded={false} onClick={() => setExpanded(true)} />
						{json.length > 0 && <span className="ms-2">{$copyButton}</span>}
					</div>
				</div>
			);
		}
		
		return (
			<div className="border rounded p-2 my-2" style={{ borderColor: '#e0e0e0' }}>
				<div className="d-flex align-items-center mb-1">
					<span className="text-muted fst-italic me-2">Array ({json.length} items)</span>
					<ExpandCollapseButton expanded={true} onClick={() => setExpanded(false)} />
					{json.length > 0 && <span className="ms-2">{$copyButton}</span>}
				</div>
				{json.slice(0, itemsToShow).map((item, index) => (
					<div key={index} className="my-2 ps-2" style={{ borderLeft: '2px solid #e0e0e0' }}>
						<JsonObjectViewer json={item} textComponent={textComponent} />
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
	if (typeof(json) === 'object' && json !== null) {
		const hasKeys = Object.keys(json).length > 0;
		const keyCount = Object.keys(json).length;
		
		if (!expanded) {
			return (
				<div className="border rounded p-2 my-2" style={{ borderColor: '#e0e0e0' }}>
					<div className="d-flex align-items-center mb-1">
						<span className="text-muted fst-italic me-2">Object ({keyCount} keys)</span>
						<ExpandCollapseButton expanded={false} onClick={() => setExpanded(true)} />
						{hasKeys && <span className="ms-2">{$copyButton}</span>}
					</div>
				</div>
			);
		}
		
		return (
			<div className="border rounded p-2 my-2" style={{ borderColor: '#e0e0e0' }}>
				<div className="d-flex align-items-center mb-1">
					<span className="text-muted fst-italic me-2">Object ({keyCount} keys)</span>
					<ExpandCollapseButton expanded={true} onClick={() => setExpanded(false)} />
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
							<div key={key} className="my-1">
								<span className="fw-bold me-2" style={{ color: '#555' }}>{key}:</span>
								<JsonObjectViewer json={value} textComponent={textComponent} />
							</div>
						);
					}
					
					// For complex values, show on separate line
					return (
						<div key={key} className="my-2">
							<span className="fw-bold me-2" style={{ color: '#555' }}>{key}:</span>
							<JsonObjectViewer json={value} textComponent={textComponent} />
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
		return <TextComponent text={json} />;
	}
	return <span className="text-muted">{""+json}</span>;
}