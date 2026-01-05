import React from 'react';
import { Row, Col, Input } from 'reactstrap';
import { Span } from '../common/types';
import { getSpanId, getDurationMs, durationString, getSpanName } from '../utils/span-utils';
import ExpandCollapseControl from './generic/ExpandCollapseControl';
import StarButton from './generic/StarButton';
import CopyButton from './generic/CopyButton';
import { truncate } from '../common/utils/miscutils';
import ChatMessage from '../common/types/ChatMessage';

interface SpanTree {
  span: Span;
  children: SpanTree[];
}

// Helper function to extract message text from output, recursing up to depth 2
function extractMessageFromOutput(output: any, depth: number = 0): string | ChatMessage | null {
  if (depth > 2 || output === null || output === undefined) {
    return null;
  }

  // Direct string message
  if (typeof output === 'string') {
    return output;
  }

    // Check for {role, content} format
    if (typeof output === 'object' && output.role && output.content) {
      return output as ChatMessage;
    }

  if (typeof output === 'object') {
    // Check for direct message property
    if (typeof output.message === 'string') {
      return output.message;
    }

    // Check for choices[0].message.content format (OpenAI style)
    if (Array.isArray(output.choices) && output.choices.length > 0) {
      const message = output.choices[0].message;
      if (message && message.content) {
        if (typeof message.content === 'string') {
          return message.content;
        }
        // Recurse into content if it's an array
        if (Array.isArray(message.content) && message.content.length === 1) {
          return extractMessageFromOutput(message.content[0], depth + 1);
        }
      }
    }

    // If it's an array with one item, recurse into it
    if (Array.isArray(output) && output.length === 1) {
      return extractMessageFromOutput(output[0], depth + 1);
    }

    // Recurse into object properties
    if (depth < 2) {
      for (const key of ['content', 'message', 'text', 'response', 'output']) {
        if (output[key] !== undefined) {
          const result = extractMessageFromOutput(output[key], depth + 1);
          if (result) return result;
        }
      }
    }
  }

  return null;
}

/** Helper function to get spanSummary from a span, checking output first, then child spans */
function getSpanSummary(span: Span, children: SpanTree[]): string | ChatMessage | null  {
  const spanAny = span as any;
  const output = spanAny.attributes?.output;

  // First, try to extract message from output
  if (output) {
    const message = extractMessageFromOutput(output);
    if (message) {
      return message;
    }
  }

  // If no summary from output, check child spans
  for (const child of children) {
    const childSummary = getSpanSummary(child.span, child.children);
    if (childSummary) {
      return childSummary;
    }
  }

  return null;
}

// Helper function for filter matching
function treeMatchesFilter(tree: SpanTree, filterLower: string): boolean {
  const name = getSpanName(tree.span);
  if (name.toLowerCase().includes(filterLower)) return true;
  return tree.children.some(child => treeMatchesFilter(child, filterLower));
}

interface TreeState {
  selectedSpanId: string | null;
  expandedSpanIds: Set<string>;
  onSelectSpan: (spanId: string) => void;
  onToggleExpanded: (spanId: string) => void;
}

interface FilterState {
  filterInput: string;
  debouncedFilter: string;
  onFilterChange: (value: string) => void;
}

interface TraceDetailsContentProps {
  spanTree: SpanTree | null;
  traceSpans: Span[];
  selectedSpan: Span | null;
  treeState: TreeState;
  filterState: FilterState;
  durationUnit: 'ms' | 's' | 'm' | 'h' | 'd' | null;
  onSpanUpdate?: (span: Span) => void;
  SpanDetails: React.ComponentType<{ span: Span }>;
  FullJson: React.ComponentType<{ json: any }>;
}

/**
 * Main content area for TraceDetailsPage.
 * Shows span tree on the left and span details on the right.
 */
interface TreeViewConfig {
  durationUnit: 'ms' | 's' | 'm' | 'h' | 'd' | null | undefined;
  filter?: string;
  onSpanUpdate?: (span: Span) => void;
}

function SpanTreeViewer({ 
  spanTree, 
  treeState,
  config
}: { 
  spanTree: SpanTree;
  treeState: TreeState;
  config: TreeViewConfig;
}) {
  const { span, children } = spanTree;
  const spanId = getSpanId(span);
  const isExpanded = treeState.expandedSpanIds.has(spanId);
  const isSelected = treeState.selectedSpanId === spanId;
  
  // Filter matching logic - treat undefined/empty/whitespace as no filter
  const hasFilter = Boolean(config.filter && config.filter.trim().length > 0);
  const filterLower = hasFilter ? config.filter!.toLowerCase().trim() : '';
  
  // Apply filtering if filter is active
  let shouldShow = true;
  let filteredChildren = children;
  
  if (hasFilter) {
    const spanNameLower = getSpanName(span).toLowerCase();
    const matchesFilter = spanNameLower.includes(filterLower);
    const hasMatchingDescendant = children.some(child => treeMatchesFilter(child, filterLower));
    
    // Only show this node if it matches or has a matching descendant
    shouldShow = matchesFilter || hasMatchingDescendant;
    
    // Filter children:
    // - If this node matches: show ALL children (full context)
    // - If this node doesn't match but has matching descendants: only show children on path to matches
    if (shouldShow) {
      filteredChildren = matchesFilter 
        ? children  // Show all children when parent matches
        : children.filter(child => treeMatchesFilter(child, filterLower)); // Only show path to matches
    }
  }
  
  if (!shouldShow) return null;

  const handleSelect = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    treeState.onSelectSpan(spanId);
  };

  return (
    <div style={{ marginLeft: '20px', marginTop: '5px', borderLeft: '2px solid #ccc', paddingLeft: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '5px' }}>
        <ExpandCollapseControl 
          hasChildren={children.length > 0}
          isExpanded={isExpanded}
          onToggle={() => treeState.onToggleExpanded(spanId)}
        />
       <SpanTreeItem span={span} children={children} treeState={treeState} config={config} />
      </div>
      {isExpanded && filteredChildren.length > 0 && (
        <div>
          {filteredChildren.map(kid => {
            const kidSpanId = getSpanId(kid.span);
            return (
              <SpanTreeViewer 
                key={kidSpanId} 
                spanTree={kid}
                treeState={treeState}
                config={config}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SpanTreeItem({ span, children, treeState, config }: { span: Span; children: SpanTree[]; treeState: TreeState; config: TreeViewConfig }) {
  const isSelected = treeState.selectedSpanId === getSpanId(span);
  const spanId = getSpanId(span);
  const handleSelect = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    treeState.onSelectSpan(spanId);
  };
  const spanName = getSpanName(span);
  const spanSummary = getSpanSummary(span, children);
  // TODO better
  const spanSummaryText = typeof spanSummary === 'string' 
    ? spanSummary 
    : spanSummary?.content && typeof spanSummary.content === 'string'
    ? spanSummary.content
    : spanSummary ? JSON.stringify(spanSummary) : null;
  return (<div 
  style={{ 
    flex: 1,
    cursor: 'pointer',
    padding: '5px',
    borderRadius: '4px',
    backgroundColor: isSelected ? '#e3f2fd' : 'transparent',
    border: isSelected ? '2px solid #2196f3' : '2px solid transparent',
    position: 'relative'
  }}
  onClick={handleSelect}
>									
  {spanName && <div>{spanName}</div>}
  {spanSummaryText && <div style={{ fontSize: '0.9em', color: '#666', marginTop: '2px' }}>{spanSummaryText}</div>}
  <div><small>Span ID: {spanId}</small></div>
  <div><small>Duration: <span>{durationString(getDurationMs(span), config.durationUnit)}</span></small></div>
  <div style={{ position: 'absolute', right: '20px', top: '10px', display: 'flex', gap: '5px', alignItems: 'center' }}>
    <StarButton span={span} size="sm" onUpdate={config.onSpanUpdate} />
    <CopyButton content={span} logToConsole size="xs" />
  </div>
</div>
);
}

export default function TraceDetailsContent({
  spanTree,
  traceSpans,
  selectedSpan,
  treeState,
  filterState,
  durationUnit,
  onSpanUpdate,
  SpanDetails,
  FullJson,
}: TraceDetailsContentProps) {
  return (
    <>
      <Row>
        <Col md={4} style={{ minWidth: 0, maxHeight: '100vh', overflowY: 'auto' }}>
          <h3>Span Tree</h3>
          <div style={{ marginBottom: '10px' }}>
            <Input
              type="text"
              placeholder="Filter by span name..."
              value={filterState.filterInput}
              onChange={(e) => filterState.onFilterChange(e.target.value)}
              style={{ marginBottom: '5px' }}
            />
            {filterState.filterInput && (
              <small className="text-muted">
                {filterState.debouncedFilter ? 'Filtering...' : 'Type to filter (debounced)'}
              </small>
            )}
          </div>
          {spanTree && (
            <SpanTreeViewer
              spanTree={spanTree}
              treeState={treeState}
              config={{
                durationUnit,
                filter: filterState.debouncedFilter || undefined,
                onSpanUpdate,
              }}
            />
          )}
        </Col>
        <Col md={8} style={{ minWidth: 0, maxHeight: '100vh', overflowY: 'auto' }}>
          <h3>Span Details: {selectedSpan ? getSpanName(selectedSpan) : treeState.selectedSpanId}</h3>
          {selectedSpan ? (
            <SpanDetails span={selectedSpan} />
          ) : (
            <div>Select a span to view details</div>
          )}
        </Col>
      </Row>
      <Row style={{ margin: 0, maxWidth: '100%' }}>
        <Col style={{ minWidth: 0, maxWidth: '100%', paddingLeft: '15px', paddingRight: '15px' }}>
          <FullJson json={traceSpans} />
        </Col>
      </Row>
    </>
  );
}

