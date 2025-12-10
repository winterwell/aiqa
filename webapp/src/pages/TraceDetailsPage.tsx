import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Badge, Button } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { createExampleFromSpan, listDatasets, searchSpans } from '../api';
import { Span } from '../common/types';
import TableUsingAPI, { PageableData } from '../components/TableUsingAPI';
import { getSpanId, getStartTime, getEndTime, getDurationMs } from '../utils/span-utils';
import JsonObjectViewer from '../components/JsonObjectViewer';

interface SpanTree {
	span: Span;
	children: SpanTree[];
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

  const addToDataSet = async (span: Span) => {
	console.log('addToDataSet', span);
	if (!datasets?.length) {
		console.warn("No datasets?!", datasets, isLoadingDataSets);
		return;
	}
	const dataset = datasets[0]; // HACK
	// post to dataset examples
	const ok = await createExampleFromSpan({organisationId, datasetId:dataset.id, span});
	console.log(ok);
};


  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}/traces`} className="btn btn-link mb-3">
            ← Back to Traces
          </Link>
          <h1>Trace Details:</h1>
          <p className="text-muted">
            Trace ID: <code>{traceId}</code>
          </p>
        </Col>
      </Row>

	  <pre>
		{spanTree && <SpanTreeViewer spanTree={spanTree} addToDataSet={addToDataSet} />}
	  </pre>
    </Container>
  );
};

function SpanTreeViewer({ spanTree, addToDataSet }: { spanTree: SpanTree }) {
	let span = spanTree.span;
	let children = spanTree.children;

	return (
		<div>
			{span.name} <Timestamp timestamp={getStartTime(span)} /> Duration: {getDurationMs(span)}
			<Button onClick={() => addToDataSet(span)}>Add to DataSet</Button>
			<pre>{JSON.stringify(span, null, 2)}</pre>
			{children?.map(kid => <SpanTreeViewer key={kid.span.id} spanTree={kid} addToDataSet={addToDataSet} />)}			
		</div>
	);
}

function Timestamp({ timestamp }: { timestamp: Date|string }) {
	if (typeof timestamp === 'string') {
		timestamp = new Date(timestamp);
	}
	return <span className="text-muted">{timestamp.toLocaleString()}</span>;
}

export default TraceDetailsPage;

