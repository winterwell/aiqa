import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Badge } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { searchSpans } from '../api';
import { Span } from '../common/types';
import TableUsingAPI, { PageableData } from '../components/TableUsingAPI';
import { getSpanId, getStartTime, getEndTime, getDuration } from '../utils/span-utils';

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

  const columns = useMemo<ColumnDef<Span>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (row.original as any).name || 'N/A',
      },
      {
        id: 'spanId',
        header: 'Span ID',
        cell: ({ row }) => (
          <code className="small">{getSpanId(row.original).substring(0, 16)}...</code>
        ),
      },
      {
        id: 'startTime',
        header: 'Start Time',
        cell: ({ row }) => {
          const startTime = getStartTime(row.original);
          return startTime ? startTime.toLocaleString() : 'N/A';
        },
      },
      {
        id: 'duration',
        header: 'Duration',
        cell: ({ row }) => {
          const duration = getDuration(row.original);
          return duration !== null ? `${duration.toFixed(2)}ms` : 'N/A';
        },
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = (row.original as any).status;
          if (!status) return 'N/A';
          const code = status.code === 1 ? 'OK' : status.code === 2 ? 'ERROR' : 'UNSET';
          return <Badge color={code === 'ERROR' ? 'danger' : code === 'OK' ? 'success' : 'secondary'}>{code}</Badge>;
        },
      },
    ],
    []
  );

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
		{JSON.stringify(traceSpans, null, 2)}
	  </pre>
    </Container>
  );
};

export default TraceDetailsPage;

