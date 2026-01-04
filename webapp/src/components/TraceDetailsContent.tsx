import React from 'react';
import { Row, Col, Input } from 'reactstrap';
import { Span } from '../common/types';
import { getSpanId, getDurationMs, durationString } from '../utils/span-utils';
import ExpandCollapseControl from './generic/ExpandCollapseControl';
import StarButton from './generic/StarButton';
import CopyButton from './generic/CopyButton';

interface SpanTree {
  span: Span;
  children: SpanTree[];
}

// Helper function to get span name
const getSpanName = (span: Span): string => (span as any).name || '';

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

  const spanAny = span as any;
  const spanName = getSpanName(span);
  const spanSummary = spanAny.attributes?.input?.message 
    ? <div>Message: {JSON.stringify(spanAny.attributes.input.message).substring(0,100)}</div>
    : null;

  return (
    <div style={{ marginLeft: '20px', marginTop: '5px', borderLeft: '2px solid #ccc', paddingLeft: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '5px' }}>
        <ExpandCollapseControl 
          hasChildren={children.length > 0}
          isExpanded={isExpanded}
          onToggle={() => treeState.onToggleExpanded(spanId)}
        />
        <div 
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
          {spanSummary}
          <div><small>Span ID: {spanId}</small></div>
          <div><small>Duration: <span>{durationString(getDurationMs(span), config.durationUnit)}</span></small></div>
          <div style={{ position: 'absolute', right: '20px', top: '10px', display: 'flex', gap: '5px', alignItems: 'center' }}>
            <StarButton span={span} size="sm" onUpdate={config.onSpanUpdate} />
            <CopyButton content={span} logToConsole size="xs" />
          </div>
        </div>
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

