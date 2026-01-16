import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Row, Col, Input } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { createExampleFromSpans, listDatasets } from '../api';
import { Span } from '../common/types';
import { getSpanId, getStartTime, getEndTime, getDurationMs, getDurationUnits, getTraceId, getTotalTokenCount, getCost, prettyNumber } from '../utils/span-utils';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import CopyButton from '../components/generic/CopyButton';
import ExpandCollapseControl from '../components/generic/ExpandCollapseControl';
import { useToast } from '../utils/toast';
import { durationString } from '../utils/span-utils';
import JsonObjectViewer from '../components/generic/JsonObjectViewer';
import StarButton from '../components/generic/StarButton';
import LoadingSpinner from '../components/generic/LoadingSpinner';
import TraceDetailsPageHeader from '../components/TraceDetailsPageHeader';
import TraceDetailsContent from '../components/TraceDetailsContent';
import { useSpanData, useConversationTraceIds } from '../hooks/useSpanData';
import { useSpanTreeState } from '../hooks/useSpanTreeState';

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

function organiseSpansIntoTree(spans: Span[], parent: Span | null, traceIds?: string[]): SpanTree | null {
	if ( ! parent) {
		// If we have multiple traces, organize by trace first
		if (traceIds && traceIds.length > 1) {
			const traceMap = new Map<string, Span[]>();
			spans.forEach(span => {
				const traceId = getTraceId(span);
				if (traceId && traceIds.includes(traceId)) {
					if (!traceMap.has(traceId)) {
						traceMap.set(traceId, []);
					}
					traceMap.get(traceId)!.push(span);
				}
			});
			
			// Create a virtual root for the conversation
			const virtualRoot: Span = {
				...spans[0],
				name: `Conversation (${traceIds.length} traces)`,
			} as Span;
			
			const children: SpanTree[] = [];
			traceMap.forEach((traceSpans, traceId) => {
				const roots = traceSpans.filter(span => !getParentSpanId(span));
				if (roots.length > 0) {
					// For each trace, create a virtual root if multiple roots, or use the single root
					if (roots.length === 1) {
						const tree = organiseSpansIntoTree(traceSpans, roots[0]);
						if (tree) children.push(tree);
					} else {
						const traceVirtualRoot: Span = {
							...roots[0],
							name: `Trace ${traceId.substring(0, 8)}... (${roots.length} roots)`,
						} as Span;
						const traceTree: SpanTree = {
							span: traceVirtualRoot,
							children: roots.map(root => organiseSpansIntoTree(traceSpans, root)).filter((child): child is SpanTree => child !== null),
						};
						children.push(traceTree);
					}
				}
			});
			
			return {
				span: virtualRoot,
				children,
			};
		}
		
		// Single trace or no trace grouping
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
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Support multiple trace IDs from URL params (comma-separated)
  const traceIdsParam = searchParams.get('traceIds');
  const initialTraceIds = useMemo(() => {
    if (traceIdsParam) {
      return traceIdsParam.split(',').filter(id => id.trim().length > 0);
    }
    return traceId ? [traceId] : [];
  }, [traceId, traceIdsParam]);

  // Use span data layer for loading spans
  const spanData = useSpanData(organisationId, initialTraceIds, {
    fields: '*',
    exclude: undefined, // Need all attributes for display
  });

  // Get conversation ID from first trace's root span
  const conversationId = spanData.conversationId;
  
  // Load conversation trace IDs (lazy, only when needed)
  const conversationTraceIdsQuery = useConversationTraceIds(
    organisationId,
    conversationId || undefined,
    { enabled: false } // Only fetch when explicitly requested
  );

  // Combine all spans from all traces
  const allSpans = useMemo(() => {
    const spans: Span[] = [];
    spanData.allSpans.forEach((traceSpans) => {
      spans.push(...traceSpans);
    });
    return spans;
  }, [spanData.allSpans]);

  // Handle expanding to conversation
  const handleExpandToConversation = useCallback(async () => {
    if (!conversationId || !organisationId) return;
    
    try {
      // Fetch conversation trace IDs
      const result = await conversationTraceIdsQuery.refetch();
      if (result.data && result.data.length > 0) {
        // Update URL with all trace IDs - this will trigger re-render with new initialTraceIds
        const newParams = new URLSearchParams(searchParams);
        newParams.set('traceIds', result.data.join(','));
        setSearchParams(newParams, { replace: true });
      }
    } catch (error) {
      console.error('Failed to expand to conversation:', error);
    }
  }, [conversationId, organisationId, conversationTraceIdsQuery, searchParams, setSearchParams]);

  const isLoadingSpans = spanData.isLoadingAllSpans;
  const traceSpans = allSpans;

  // Callback to update a span when it's starred/unstarred
  const handleSpanUpdate = useCallback((updatedSpan: Span) => {
    // Refetch the affected trace
    const traceId = getTraceId(updatedSpan);
    if (traceId) {
      // The span data layer will handle caching, so we just need to invalidate
      // For now, we'll rely on the cache invalidation from the update API call
    }
  }, []);
  // organise the traceSpans into a tree of spans, with the root span at the top
  // MEMOIZE THIS - it's O(n²) and runs on every render without memoization!
  const spanTree = useMemo(() => {
    return traceSpans && traceSpans.length > 0 
      ? organiseSpansIntoTree(traceSpans, null, initialTraceIds.length > 1 ? initialTraceIds : undefined)
      : null;
  }, [traceSpans, initialTraceIds]);
  
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

  // Manage span tree state (selection, expansion, filtering)
  const {
    selectedSpanId,
    expandedSpanIds,
    filterInput,
    debouncedFilter,
    setFilterInput,
    toggleExpanded,
    handleSelectSpan,
  } = useSpanTreeState(spanTree);

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

  if (isLoadingSpans) {
    return (
      <div className="mt-4" style={containerStyle}>
        <TraceDetailsPageHeader
          organisationId={organisationId!}
          traceId={traceId!}
          traceIds={initialTraceIds}
          conversationId={conversationId}
          canExpandToConversation={!!conversationId}
          isExpanding={false}
          onExpandToConversation={handleExpandToConversation}
        />
        <LoadingSpinner message="Loading spans data..." />
      </div>
    );
  }

  if (isProcessingSpans) {
    return (
      <div className="mt-4" style={containerStyle}>
        <TraceDetailsPageHeader
          organisationId={organisationId!}
          traceId={traceId!}
          traceIds={initialTraceIds}
          conversationId={conversationId}
          canExpandToConversation={!!conversationId}
          isExpanding={false}
          onExpandToConversation={handleExpandToConversation}
        />
        <LoadingSpinner 
          message="Processing spans data..." 
          subtitle={`Organizing ${traceSpans?.length || 0} spans into tree structure`}
        />
      </div>
    );
  }

  return (
    <div className="mt-4" style={containerStyle}>
      <TraceDetailsPageHeader
        organisationId={organisationId!}
        traceId={traceId!}
        traceIds={initialTraceIds}
        conversationId={conversationId}
        canExpandToConversation={!!conversationId}
        isExpanding={conversationTraceIdsQuery.isLoading || conversationTraceIdsQuery.isFetching}
        onExpandToConversation={handleExpandToConversation}
      />
      <TraceDetailsContent
        spanTree={spanTree}
        traceSpans={traceSpans}
        selectedSpan={selectedSpan}
        treeState={{
          selectedSpanId,
          expandedSpanIds,
          onSelectSpan: handleSelectSpan,
          onToggleExpanded: toggleExpanded,
        }}
        filterState={{
          filterInput,
          debouncedFilter,
          onFilterChange: setFilterInput,
        }}
        durationUnit={durationUnit}
        onSpanUpdate={handleSpanUpdate}
        SpanDetails={SpanDetails}
        FullJson={FullJson}
      />
    </div>
  );
}; // end of TraceDetailsPage

/** Provide access to the full raw json for all spans */
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

function SpanDetails({ span }: { span: Span }) {
	const spanId = getSpanId(span);
	const spanAny = span as any;
	const input = spanAny.attributes?.input;
	const output = spanAny.attributes?.output;
	const durationMs = getDurationMs(span);
	const tokenCount = getTotalTokenCount(span);
	const cost = getCost(span);

	return (
		<div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9', minWidth: 0, maxWidth: '100%' }}>
			<div style={{ marginBottom: '15px' }}>
				<div><strong>Span ID:</strong> {spanId}</div>
				<div><strong>Name:</strong> {getSpanName(span) || 'Unnamed Span'}</div>
				<div><strong>Date:</strong> {getStartTime(span)?.toLocaleString() || 'N/A'}</div>
				<div><strong>Duration:</strong> {durationMs ? `${durationMs}ms` : 'N/A'}</div>
				{tokenCount !== null && <div><strong>Tokens:</strong> {tokenCount.toLocaleString()}</div>}
				{cost !== null && <div><strong>Cost:</strong> ${prettyNumber(cost)}</div>}
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

