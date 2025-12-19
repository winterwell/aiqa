/**
 * A component to display a JSON object in a readable format, 
 * with expandable/collapsable sections for each key.
 * Large value shown truncated with a link to expand.
 * Small copy buttons to copy the JSON (or sub-objects) to the clipboard.
 */

import React, { useState } from 'react';
import CopyButton from './CopyButton';

export default function JsonObjectViewer({ json }: { json: any }) {
	const $copyButton = <CopyButton content={json} />
	const [expanded, setExpanded] = useState(false);
	if (Array.isArray(json)) {
		return (
			<div>
				{expanded && Object.entries(item => <JsonObjectViewer json={item} />)}
				<pre>{JSON.stringify(json, null, 2)}</pre>
				{$copyButton}
			</div>
		);
	}
	if (typeof(json) === 'object') {
		return (
			<div>
				{Object.entries(json).map(([key, value]) => {
					return (
						<div key={key}>
							<span>{key}</span>
							<JsonObjectViewer json={value} />
						</div>
					);

				})}
				{$copyButton}
			</div>
		);
	}
	if (json === null || json === undefined) {
		return null;
	}
	return ""+json;
}