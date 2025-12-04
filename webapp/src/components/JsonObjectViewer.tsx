/**
 * A component to display a JSON object in a readable format, 
 * with expandable/collapsable sections for each key.
 * Large value shown truncated with a link to expand.
 * Small copy buttons to copy the JSON (or sub-objects) to the clipboard.
 */

import React from 'react';

export default function JsonObjectViewer({ json }: { json: any }) {
    return (
        <div>
            <pre>{JSON.stringify(json, null, 2)}</pre>
            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(json))}>Copy JSON</button>
            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(json, null, 2))}>Copy Pretty</button>
        </div>
    );
}