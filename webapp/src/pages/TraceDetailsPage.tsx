import React, { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Button, FormGroup, Input, Label } from 'reactstrap';
import { createExampleFromSpans, createDataset, listDatasets } from '../api';
import { Span } from '../common/types';
import { getSpanId, getTraceId, getParentSpanId } from '../common/types/Span.js';
import { getStartTime, getEndTime, getDurationMs, getDurationUnits, getTotalTokenCount, getCost, prettyNumber } from '../utils/span-utils';
import { useToast } from '../utils/toast';
import LoadingSpinner from '../components/generic/LoadingSpinner';
import TraceDetailsPageHeader from '../components/TraceDetailsPageHeader';
import TraceDetailsContent from '../components/TraceDetailsContent';
import JsonObjectViewer from '../components/generic/JsonObjectViewer';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import { useSpanData, useConversationTraceIds } from '../hooks/useSpanData';
import { useSpanTreeState } from '../hooks/useSpanTreeState';
import ExpandCollapseControl from '../components/generic/ExpandCollapseControl';
import CopyButton from '../components/generic/CopyButton';
	
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
const convertToText = (value: any): string | null => {
	if (value === undefined || value === null) return null;
	return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

function collectSpansFromTree(spanTree: SpanTree): Span[] {
	return [spanTree.span, ...spanTree.children.flatMap(child => collectSpansFromTree(child))];
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
	
	const parentId = getSpanId(parent);
	const childSpans = spans.filter(span => {
		const spanParentId = getParentSpanId(span);
		if (!spanParentId) return false;
		// Check if this span's parent ID matches the parent's ID
		return spanParentId === parentId;
	});
	
	const tree: SpanTree = {
		span: parent,
		children: childSpans.map(childSpan => organiseSpansIntoTree(spans, childSpan)).filter((child): child is SpanTree => child !== null),
	};
	return tree;
}

/**
 * The main container widget
 * @returns 
 */
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
     queryKey: ['datasets', organisationId],
	 queryFn: async () => {
		const result = await listDatasets(organisationId!);
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
    <div className="" style={containerStyle}>
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
        organisationId={organisationId}
        datasets={datasets}
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

function maybeParseJson(suspectedJsonString: unknown): any {
	if (typeof suspectedJsonString !== 'string') return suspectedJsonString;
	try {
		return JSON.parse(suspectedJsonString);
	} catch (error) {
		return suspectedJsonString;
	}
}

/** Input to show in Span Details: attributes.input, or gen_ai.input.messages when input is unset. */
function getDisplayInput(attrs: Record<string, unknown> | undefined): any {
	if (!attrs) return undefined;
	let input : any = attrs.input;
	const genaiInputMessages = attrs['gen_ai.input.messages'];
	if (genaiInputMessages && ! input?.messages) {
		const messages = maybeParseJson(genaiInputMessages);
		input = Object.assign({}, input, {messages});
	} 
	return input;
}

function getDisplayOutput(attrs: Record<string, unknown> | undefined): unknown {
	if (!attrs) return undefined;
	let output : any = attrs.output;
	if (attrs['gen_ai.output.messages'] && ! output?.messages) {
		const messages = maybeParseJson(attrs['gen_ai.output.messages']);
		output = Object.assign({}, output, {messages});
	}
	return output;
}

function SpanDetails({ span, organisationId, datasets }: { span: Span; organisationId?: string; datasets?: any[] }) {
	const spanId = getSpanId(span);
	const spanAny = span as any;
	const attrs = spanAny.attributes;
	const input = getDisplayInput(attrs);
	const output = getDisplayOutput(attrs);
	const durationMs = getDurationMs(span);
	const tokenCount = getTotalTokenCount(span);
	const cost = getCost(span);
	const { showToast } = useToast();
	const queryClient = useQueryClient();
	const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');

	// Shared function to add span to a dataset (DRY)
	const addSpanToDataset = useCallback(async (datasetId: string) => {
		if (!organisationId) {
			throw new Error('Organisation ID is required');
		}
		return createExampleFromSpans({
			organisationId,
			datasetId,
			spans: [span],
		});
	}, [organisationId, span]);

	const addToDatasetMutation = useMutation({
		mutationFn: addSpanToDataset,
		onSuccess: () => {
			showToast('Span added to dataset successfully!', 'success');
			queryClient.invalidateQueries({ queryKey: ['examples'] });
			queryClient.invalidateQueries({ queryKey: ['table-data'] });
			queryClient.invalidateQueries({ queryKey: ['datasets', organisationId] });
			setSelectedDatasetId('');
		},
		onError: (error: Error) => {
			showToast(`Failed to add span to dataset: ${error.message}`, 'error');
		},
	});

	// Mutation to create a new dataset and add the span to it
	const createDatasetAndAddMutation = useMutation({
		mutationFn: async () => {
			if (!organisationId) {
				throw new Error('Organisation ID is required');
			}
			// Create the dataset first
			const newDataset = await createDataset({
				organisation: organisationId,
				name: 'Dataset 1',
			});
			// Then add the span to the newly created dataset
			await addSpanToDataset(newDataset.id);
			return newDataset;
		},
		onSuccess: () => {
			showToast('Dataset created and span added successfully!', 'success');
			queryClient.invalidateQueries({ queryKey: ['examples'] });
			queryClient.invalidateQueries({ queryKey: ['table-data'] });
			queryClient.invalidateQueries({ queryKey: ['datasets', organisationId] });
		},
		onError: (error: Error) => {
			showToast(`Failed to create dataset and add span: ${error.message}`, 'error');
		},
	});

	const handleAddToDataset = () => {
		if (!selectedDatasetId) {
			showToast('Please select a dataset', 'error');
			return;
		}
		addToDatasetMutation.mutate(selectedDatasetId);
	};

	return (
		<div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9', minWidth: 0, maxWidth: '100%' }}>
			<div style={{ marginBottom: '15px' }}>
				<div><strong>Span ID:</strong> {spanId}</div>
				{span.name && <div><strong>Name:</strong> {span.name}</div>}
				{span.example && <div><strong>Example:</strong> {span.example}</div>}
				{span.experiment && <div><strong>Experiment:</strong> {span.experiment}</div>}
				<div><strong>Date:</strong> {getStartTime(span)?.toLocaleString() || 'N/A'}</div>
				<div><strong>Duration:</strong> {durationMs ? `${durationMs}ms` : 'N/A'}</div>
				{tokenCount !== null && <div><strong>Tokens:</strong> {tokenCount.toLocaleString()}</div>}
				{cost !== null && <div><strong>Cost:</strong> ${prettyNumber(cost)}</div>}
			</div>
			
			{organisationId && Array.isArray(datasets) && (
				<div style={{ marginTop: '15px', marginBottom: '15px', padding: '10px', backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '4px' }}>
					{datasets.length === 0 ? (
						<Button
							color="primary"
							onClick={() => createDatasetAndAddMutation.mutate()}
							disabled={createDatasetAndAddMutation.isPending || addToDatasetMutation.isPending}
						>
							{createDatasetAndAddMutation.isPending || addToDatasetMutation.isPending ? 'Creating...' : 'Add to a New Dataset'}
						</Button>
					) : datasets.length === 1 ? (
						<Button
							color="primary"
							onClick={() => {
								if (datasets[0].id) {
									addToDatasetMutation.mutate(datasets[0].id);
								}
							}}
							disabled={addToDatasetMutation.isPending || createDatasetAndAddMutation.isPending}
						>
							{addToDatasetMutation.isPending ? 'Adding...' : `Add to Dataset: ${datasets[0].name || datasets[0].id}`}
						</Button>
					) : (
						<FormGroup>
							<Label for="datasetSelect">Add to Dataset</Label>
							<div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
								<Input
									type="select"
									id="datasetSelect"
									value={selectedDatasetId}
									onChange={(e) => setSelectedDatasetId(e.target.value)}
									style={{ flex: 1 }}
								>
									<option value="">Select a dataset...</option>
									{datasets.map((dataset) => (
										<option key={dataset.id} value={dataset.id}>
											{dataset.name || dataset.id}
										</option>
									))}
								</Input>
								<Button
									color="primary"
									onClick={handleAddToDataset}
									disabled={!selectedDatasetId || addToDatasetMutation.isPending || createDatasetAndAddMutation.isPending}
								>
									{addToDatasetMutation.isPending ? 'Adding...' : 'Add to Dataset'}
								</Button>
							</div>
						</FormGroup>
					)}
				</div>
			)}

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
	delete attributes2['gen_ai.input.messages'];
	delete attributes2['gen_ai.output.messages'];
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

