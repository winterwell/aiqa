import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { createExampleFromSpans, listDatasets, searchSpans } from '../api';
import { Span } from '../common/types';
import { getSpanId, getStartTime, getEndTime, getDurationMs } from '../utils/span-utils';
import TextWithStructureViewer from '../components/TextWithStructureViewer';

interface SpanTree {
	span: Span;
	children: SpanTree[];
}

function collectSpansFromTree(spanTree: SpanTree): Span[] {
	const spans: Span[] = [];
	spans.push(spanTree.span);
	spanTree.children.forEach(child => {
		spans.push(...collectSpansFromTree(child));
	});
	return spans;
}

function organiseSpansIntoTree(spans: Span[], parent: Span | null): SpanTree | null {
	if ( ! parent) {
		const roots = spans.filter(span => {
			const parentSpanId = (span as any).parentSpanId || (span as any).span?.parent?.id;
			return !parentSpanId;
		});
		if ( ! roots.length) {
			return null;
		}
		return organiseSpansIntoTree(spans, roots[0]);
	}
	const parentId = getSpanId(parent);
    const childSpans = spans.filter(span => {
		const spanParentId = (span as any).parentSpanId || (span as any).span?.parent?.id;
		return spanParentId === parentId;
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
  const { data: traceSpans } = useQuery({
    queryKey: ['spans', organisationId, traceId],
    queryFn: async () => {
      const result = await searchSpans({ organisationId: organisationId!, query: `traceId:${traceId}`, limit: 1000, offset: 0 });
	  return result.hits;
    },
    enabled: !!organisationId && !!traceId,
  });
  // organise the traceSpans into a tree of spans, with the root span at the top
  const spanTree = traceSpans ? organiseSpansIntoTree(traceSpans, null) : null;

  const {data:datasets, isLoading:isLoadingDataSets} = useQuery({
     queryKey: ['datasets'],
	 queryFn: async () => {
		const result = await listDatasets(organisationId);
		return result;
	 },
	 enabled: !!organisationId
  });

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


  const topSpan = spanTree?.span;

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}/traces`} className="btn btn-link mb-3">
            ← Back to Traces
          </Link>
          {topSpan && (
            <>
              <h1>{(topSpan as any).name || 'Unnamed Span'}</h1>
              <div className="mb-3">
                <div>
                  <strong>Date:</strong> {getStartTime(topSpan)?.toLocaleString() || 'N/A'}
                </div>
                <div>
                  <strong>Duration:</strong> {getDurationMs(topSpan) ? `${getDurationMs(topSpan)}ms` : 'N/A'}
                </div>
                <div>
                  <strong>Trace ID:</strong> <code>{traceId}</code>
                </div>
              </div>
            </>
          )}
          {spanTree && <SpanTreeViewer spanTree={spanTree} addToDataSet={addToDataSet} />}
        </Col>
      </Row>
    </Container>
  );
};

function SpanTreeViewer({ spanTree, addToDataSet }: { spanTree: SpanTree, addToDataSet: (spanTree: SpanTree) => Promise<void> }) {
	const [expanded, setExpanded] = useState(true);
	const span = spanTree.span;
	const children = spanTree.children;
	const spanId = getSpanId(span);
	const input = (span as any).attributes?.input;
	const output = (span as any).attributes?.output;

	// Convert input/output to string for TextWithStructureViewer
	const inputText = input !== undefined && input !== null 
		? (typeof input === 'string' ? input : JSON.stringify(input, null, 2))
		: null;
	const outputText = output !== undefined && output !== null
		? (typeof output === 'string' ? output : JSON.stringify(output, null, 2))
		: null;

	return (
		<div style={{ marginLeft: '20px', marginTop: '10px', borderLeft: '2px solid #ccc', paddingLeft: '10px' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
				{children.length > 0 && (
					<button 
						onClick={() => setExpanded(!expanded)}
						style={{ 
							background: 'none', 
							border: 'none', 
							cursor: 'pointer',
							fontSize: '14px',
							padding: '2px 5px'
						}}
					>
						{expanded ? '▼' : '▶'}
					</button>
				)}
				{children.length === 0 && <span style={{ width: '20px' }}></span>}
				<div style={{ flex: 1 }}>
					<div><strong>Span ID:</strong> {spanId}</div>
					<div><strong>Name:</strong> {(span as any).name || 'Unnamed'}</div>
					{inputText && (
						<div style={{ marginTop: '10px' }}>
							<strong>Input:</strong>
							<div style={{ marginLeft: '10px', marginTop: '5px' }}>
								<TextWithStructureViewer text={inputText} />
							</div>
						</div>
					)}
					{outputText && (
						<div style={{ marginTop: '10px' }}>
							<strong>Output:</strong>
							<div style={{ marginLeft: '10px', marginTop: '5px' }}>
								<TextWithStructureViewer text={outputText} />
							</div>
						</div>
					)}
				</div>
			</div>
			{expanded && children.length > 0 && (
				<div>
					{children.map(kid => (
						<SpanTreeViewer 
							key={getSpanId(kid.span)} 
							spanTree={kid} 
							addToDataSet={addToDataSet} 
						/>
					))}
				</div>
			)}
		</div>
	);
}

export default TraceDetailsPage;

