import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Row, Col, Input } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { createExampleFromSpans, listDatasets, searchSpans } from '../api';
import { Span } from '../common/types';
import { getSpanId, getStartTime, getEndTime, getDurationMs, getDurationUnits } from '../utils/span-utils';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import CopyButton from '../components/generic/CopyButton';
import ExpandCollapseControl from '../components/generic/ExpandCollapseControl';
import { useToast } from '../utils/toast';
import { durationString } from '../utils/span-utils';
import JsonObjectViewer from '../components/generic/JsonObjectViewer';
import StarButton from '../components/generic/StarButton';

interface SpanTree {
	span: Span;
	children: SpanTree[];
}

// Common styles
const containerStyle: React.CSSProperties = { maxWidth: '100%', minWidth: 0, width: '100%', boxSizing: 'border-box' };
const textBoxStyle: React.CSSProperties = { 
	marginTop: '10px', padding: '10px', backgroundColor: '#fff', border: '1px solid #ddd', 
	borderRadius: '4px', overflowX: 'auto', maxWidth: '100%', minWidth: 0, 
	wordBreak: 'break-all', overflowWrap: 'anywhere' 
};

// Helper functions
const getSpanName = (span: Span): string => (span as any).name || '';
const convertToText = (value: any): string | null => {
	if (value === undefined || value === null) return null;
	return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

function collectSpansFromTree(spanTree: SpanTree): Span[] {
	return [spanTree.span, ...spanTree.children.flatMap(child => collectSpansFromTree(child))];
}

// Unified filter matching logic
function treeMatchesFilter(tree: SpanTree, filterLower: string): boolean {
	const name = getSpanName(tree.span);
	if (name.toLowerCase().includes(filterLower)) return true;
	return tree.children.some(child => treeMatchesFilter(child, filterLower));
}

function getParentSpanId(span: Span): string | null {
	return (span as any).parentSpanId || (span as any).span?.parent?.id || null;
}

function getAllPossibleSpanIds(span: Span): Set<string> {
	const ids = new Set<string>();
	// Check all possible ID fields that might be used as parent references
	const possibleIds = [
		(span as any).clientSpanId,
		(span as any).spanId,
		(span as any).span?.id,
		(span as any).client_span_id,
	];
	possibleIds.forEach(id => {
		if (id && id !== 'N/A') {
			ids.add(String(id));
		}
	});
	// Also add the result from getSpanId (which uses the same logic)
	const spanId = getSpanId(span);
	if (spanId && spanId !== 'N/A') {
		ids.add(spanId);
	}
	return ids;
}

function organiseSpansIntoTree(spans: Span[], parent: Span | null): SpanTree | null {
	if ( ! parent) {
		const roots = spans.filter(span => !getParentSpanId(span));
		if ( ! roots.length) {
			return null;
		}
		// If there's only one root, return its tree
		if (roots.length === 1) {
			return organiseSpansIntoTree(spans, roots[0]);
		}
		// If there are multiple roots, create a virtual root with all roots as children
		const virtualRoot: Span = {
			...roots[0],
			name: 'Multiple Root Spans',
		} as Span;
		const tree: SpanTree = {
			span: virtualRoot,
			children: roots.map(root => organiseSpansIntoTree(spans, root)).filter((child): child is SpanTree => child !== null),
		};
		return tree;
	}
	
	const parentIds = getAllPossibleSpanIds(parent);
	const childSpans = spans.filter(span => {
		const spanParentId = getParentSpanId(span);
		if (!spanParentId) return false;
		// Check if this span's parent ID matches any of the parent's possible IDs
		return parentIds.has(spanParentId);
	});
	
	const tree: SpanTree = {
		span: parent,
		children: childSpans.map(childSpan => organiseSpansIntoTree(spans, childSpan)).filter((child): child is SpanTree => child !== null),
	};
	return tree;
}

const TraceDetailsPage: React.FC = () => {
  const { organisationId, traceId } = useParams<{ organisationId: string; traceId: string }>();

  // Load all spans
  const { data: traceSpans, isLoading: isLoadingSpans, refetch: refetchSpans } = useQuery({
    queryKey: ['spans', organisationId, traceId],
    queryFn: async () => {
      const result = await searchSpans({ organisationId: organisationId!, query: `traceId:${traceId}`, limit: 1000, offset: 0, fields: '*' }); // Need attributes for input/output display
	  return result.hits;
    },
    enabled: !!organisationId && !!traceId,
  });

  // Callback to update a span when it's starred/unstarred
  const handleSpanUpdate = useCallback((updatedSpan: Span) => {
    if (!traceSpans) return;
    // Update the span in the traceSpans array
    const updatedSpans = traceSpans.map(span => {
      const spanId = getSpanId(span);
      const updatedSpanId = getSpanId(updatedSpan);
      if (spanId === updatedSpanId) {
        return { ...span, starred: updatedSpan.starred };
      }
      return span;
    });
    // Refetch to ensure consistency
    refetchSpans();
  }, [traceSpans, refetchSpans]);
  // organise the traceSpans into a tree of spans, with the root span at the top
  // MEMOIZE THIS - it's O(n²) and runs on every render without memoization!
  const spanTree = useMemo(() => {
    return traceSpans ? organiseSpansIntoTree(traceSpans, null) : null;
  }, [traceSpans]);
  
  // Track if we're processing spans (data loaded but tree not ready)
  const isProcessingSpans = traceSpans !== undefined && spanTree === null;
  
  // Calculate duration unit from root span (longest duration) for consistent display across all spans
  const durationUnit = useMemo(() => {
    if (!spanTree) return null;
    const rootDurationMs = getDurationMs(spanTree.span);
    return getDurationUnits(rootDurationMs);
  }, [spanTree]);

  const {data:datasets, isLoading:isLoadingDataSets} = useQuery({
     queryKey: ['datasets'],
	 queryFn: async () => {
		const result = await listDatasets(organisationId);
		return result;
	 },
	 enabled: !!organisationId
  });

  // State for selected span and expanded spans
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(new Set());
  
  // State for filter input and debounced filter value
  const [filterInput, setFilterInput] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Debounce filter input (500ms delay)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedFilter(filterInput);
    }, 500);
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filterInput]);

  // Initialize selected span to the root span when tree is loaded
  useEffect(() => {
    if (spanTree && !selectedSpanId) {
      const rootSpanId = getSpanId(spanTree.span);
      setSelectedSpanId(rootSpanId);
      // Only expand the root span initially (not all spans) for better performance
      setExpandedSpanIds(new Set([rootSpanId]));
    }
  }, [spanTree, selectedSpanId]);
  
  // Auto-expand nodes that contain matching spans when filter is applied
  useEffect(() => {
    if (!debouncedFilter || !spanTree) return;
    
    const filterLower = debouncedFilter.toLowerCase().trim();
    if (!filterLower) return;
    
    const spansToExpand = new Set<string>();
    
    // Recursively find matching nodes and expand all nodes on path to matches
    function findMatchesAndExpandPath(tree: SpanTree, pathFromRoot: string[]): boolean {
      const spanId = getSpanId(tree.span);
      const currentPath = [...pathFromRoot, spanId];
      
      const spanName = getSpanName(tree.span).toLowerCase();
      const matches = spanName.includes(filterLower);
      
      // Check if any descendant matches
      let hasMatchingDescendant = false;
      for (const child of tree.children) {
        if (findMatchesAndExpandPath(child, currentPath)) {
          hasMatchingDescendant = true;
        }
      }
      
      // If this node matches or has a matching descendant, expand the entire path from root
      if (matches || hasMatchingDescendant) {
        // Expand all nodes in the path from root to this node (including this node)
        currentPath.forEach(id => spansToExpand.add(id));
      }
      
      return matches || hasMatchingDescendant;
    }
    
    findMatchesAndExpandPath(spanTree, []);
    
    setExpandedSpanIds(prev => {
      const next = new Set(prev);
      spansToExpand.forEach(id => next.add(id));
      return next;
    });
  }, [debouncedFilter, spanTree]);

  /** spans must be from the same trace */
  const addToDataSet = async (spanTree: SpanTree) => {
	console.log('addToDataSet', spanTree);
	// recursively collect all spans from the tree
	const spans = collectSpansFromTree(spanTree);
	if (!datasets?.length) {
		console.warn("No datasets?!", datasets, isLoadingDataSets);
		return;
	}
	const dataset = datasets[0]; // HACK
	// post to dataset examples
	const ok = await createExampleFromSpans({organisationId, datasetId:dataset.id, spans});
	console.log(ok);
};

  const toggleExpanded = useCallback((spanId: string) => {
    setExpandedSpanIds(prev => {
      const next = new Set(prev);
      next.has(spanId) ? next.delete(spanId) : next.add(spanId);
      return next;
    });
  }, []);

  const handleSelectSpan = useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
  }, []);

  // Find the selected span from the tree or original spans array
  function findSpanById(tree: SpanTree, id: string): Span | null {
    const treeSpanId = getSpanId(tree.span);
    if (treeSpanId === id) {
      return tree.span;
    }
    for (const child of tree.children) {
      const found = findSpanById(child, id);
      if (found) return found;
    }
    return null;
  }

  const selectedSpan = useMemo(() => {
    if (!selectedSpanId) return null;
    if (spanTree) {
      const foundInTree = findSpanById(spanTree, selectedSpanId);
      if (foundInTree) return foundInTree;
    }
    return traceSpans?.find(span => getSpanId(span) === selectedSpanId) || null;
  }, [spanTree, selectedSpanId, traceSpans]);

  // Shared header component
  const PageHeader = () => (
    <Row>
      <Col>
        <Link to={`/organisation/${organisationId}/traces`} className="btn btn-link mb-3">
          ← Back to Traces
        </Link>
        <h1>Trace: <code>{traceId}</code></h1>
      </Col>
    </Row>
  );

  // Loading spinner component
  const LoadingSpinner = ({ message, subtitle }: { message: string; subtitle?: string }) => (
    <div className="mt-4" style={containerStyle}>
      <PageHeader />
      <Row>
        <Col>
          <div className="text-center" style={{ padding: '40px' }}>
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <div style={{ marginTop: '15px' }}>
              <strong>{message}</strong>
              {subtitle && <div className="text-muted" style={{ marginTop: '5px' }}>{subtitle}</div>}
            </div>
          </div>
        </Col>
      </Row>
    </div>
  );

  if (isLoadingSpans) {
    return <LoadingSpinner message="Loading spans data..." />;
  }

  if (isProcessingSpans) {
    return <LoadingSpinner 
      message="Processing spans data..." 
      subtitle={`Organizing ${traceSpans?.length || 0} spans into tree structure`}
    />;
  }

  return (
    <div className="mt-4" style={containerStyle}>
      <PageHeader />
      <Row>
        <Col md={4} style={{ minWidth: 0, maxHeight: '100vh', overflowY: 'auto' }}>
          <h3>Span Tree</h3>
          <div style={{ marginBottom: '10px' }}>
            <Input
              type="text"
              placeholder="Filter by span name..."
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              style={{ marginBottom: '5px' }}
            />
            {filterInput && (
              <small className="text-muted">
                {debouncedFilter ? 'Filtering...' : 'Type to filter (debounced)'}
              </small>
            )}
          </div>
          {spanTree && (
            <SpanTreeViewer 
              spanTree={spanTree} 
              selectedSpanId={selectedSpanId}
              expandedSpanIds={expandedSpanIds}
              onSelectSpan={handleSelectSpan}
              onToggleExpanded={toggleExpanded}
              durationUnit={durationUnit}
              filter={debouncedFilter || undefined}
              onSpanUpdate={handleSpanUpdate}
            />
          )}
        </Col>
        <Col md={8} style={{ minWidth: 0, maxHeight: '100vh', overflowY: 'auto' }}>
          <h3>Span Details: {selectedSpan ? getSpanName(selectedSpan) : selectedSpanId}</h3>
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
    </div>
  );
};

function FullJson({ json }: { json: any }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const {showToast} = useToast();
	
	// Only stringify when expanded to avoid expensive operation on initial render
	const jsonString = useMemo(() => {
		return isExpanded ? JSON.stringify(json, null, 2) : '';
	}, [json, isExpanded]);

	if (!json) return null;

	return (
		<div style={{ marginTop: '30px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9', maxWidth: '100%', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
		  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', minWidth: 0, maxWidth: '100%' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
				<ExpandCollapseControl 
					hasChildren={true} 
					isExpanded={isExpanded} 
					onToggle={() => setIsExpanded(!isExpanded)} 
				/>
				<strong>Full trace JSON</strong>
			</div>
			<CopyButton content={json} showToast={showToast} logToConsole successMessage="Copied json to clipboard and logged to console." />
		  </div>
		  {isExpanded && (
			<pre style={{ 
				fontSize: '11px', 
				maxHeight: '150px', 
				maxWidth: '100%',
				width: '100%',
				minWidth: 0,
				overflow: 'auto',
				overflowX: 'auto',
				overflowY: 'auto',
				margin: 0,
				padding: '10px',
				backgroundColor: '#fff',
				border: '1px solid #ddd',
				borderRadius: '3px',
				wordBreak: 'break-all',
				overflowWrap: 'anywhere',
				whiteSpace: 'pre-wrap',
				boxSizing: 'border-box'
			}}>
				<code style={{ maxWidth: '100%', wordBreak: 'break-all', overflowWrap: 'anywhere', display: 'block' }}>{jsonString.substring(0, 100000)/* traces can get BIG */}</code>
			</pre>
		  )}
		  {!isExpanded && (
			<div style={{ color: '#666', fontStyle: 'italic', padding: '10px' }}>
				Click to expand and view full trace JSON ({Array.isArray(json) ? json.length : 'N/A'} spans)
			</div>
		  )}
		</div>
	  )
}

function SpanTreeViewer({ 
	spanTree, 
	selectedSpanId,
	expandedSpanIds,
	onSelectSpan,
	onToggleExpanded,
	durationUnit,
	filter,
	onSpanUpdate
}: { 
	spanTree: SpanTree;
	selectedSpanId: string | null;
	expandedSpanIds: Set<string>;
	onSelectSpan: (spanId: string) => void;
	onToggleExpanded: (spanId: string) => void;
	durationUnit: 'ms' | 's' | 'm' | 'h' | 'd' | null | undefined;
	filter?: string;
	onSpanUpdate?: (span: Span) => void;
}) {
	const { span, children } = spanTree;
	const spanId = getSpanId(span);
	const isExpanded = expandedSpanIds.has(spanId);
	const isSelected = selectedSpanId === spanId;
	
	// Filter matching logic - treat undefined/empty/whitespace as no filter
	const hasFilter = Boolean(filter && filter.trim().length > 0);
	const filterLower = hasFilter ? filter!.toLowerCase().trim() : '';
	
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
		onSelectSpan(spanId);
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
					onToggle={() => onToggleExpanded(spanId)}
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
					<div><small>Duration: <span>{durationString(getDurationMs(span), durationUnit)}</span></small></div>
					<div style={{ position: 'absolute', right: '20px', top: '10px', display: 'flex', gap: '5px', alignItems: 'center' }}>
						<StarButton span={span} size="sm" onUpdate={onSpanUpdate} />
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
								selectedSpanId={selectedSpanId}
								expandedSpanIds={expandedSpanIds}
								onSelectSpan={onSelectSpan}
								onToggleExpanded={onToggleExpanded}
								durationUnit={durationUnit}
								filter={filter}
								onSpanUpdate={onSpanUpdate}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}

function SpanDetails({ span }: { span: Span }) {
	const spanId = getSpanId(span);
	const spanAny = span as any;
	const input = spanAny.attributes?.input;
	const output = spanAny.attributes?.output;
	const durationMs = getDurationMs(span);

	return (
		<div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9', minWidth: 0, maxWidth: '100%' }}>
			<div style={{ marginBottom: '15px' }}>
				<div><strong>Span ID:</strong> {spanId}</div>
				<div><strong>Name:</strong> {getSpanName(span) || 'Unnamed Span'}</div>
				<div><strong>Date:</strong> {getStartTime(span)?.toLocaleString() || 'N/A'}</div>
				<div><strong>Duration:</strong> {durationMs ? `${durationMs}ms` : 'N/A'}</div>
			</div>
			{input && (
				<div style={{ marginTop: '15px', minWidth: 0, maxWidth: '100%' }}>
					<strong>Input:</strong>
					<div style={textBoxStyle}>
						{typeof input === 'string' ? <TextWithStructureViewer text={input} /> : <JsonObjectViewer json={input} textComponent={TextWithStructureViewer} />}
					</div>
				</div>
			)}
			{output && (
				<div style={{ marginTop: '15px', minWidth: 0, maxWidth: '100%' }}>
					<strong>Output:</strong>
					<div style={textBoxStyle}>
					{typeof output === 'string' ? <TextWithStructureViewer text={output} /> : <JsonObjectViewer json={output} textComponent={TextWithStructureViewer} />}
					</div>
				</div>
			)}
			{!input && !output && (
				<div style={{ marginTop: '15px', color: '#666', fontStyle: 'italic' }}>
					No input or output data available for this span.
				</div>
			)}
			<OtherAttributes span={span} />
		</div>
	);
}


function OtherAttributes({ span }: { span: Span }) {
	const spanAny = span as any;
	if ( ! span || ! spanAny.attributes ) {
		return null;
	}
	const attributes2 = {...spanAny.attributes};	
	delete attributes2.input;
	delete attributes2.output;
	delete attributes2.attributes; // In case of badly nested attributes (which suggests a client bug)
	if (Object.keys(attributes2).length === 0) {
		return null;
	}
	return (
	<div style={{ marginTop: '15px', minWidth: 0, maxWidth: '100%' }}>
					<strong>Other Attributes:</strong>
					<JsonObjectViewer json={attributes2} />
				</div>
	);
}


export default TraceDetailsPage;

