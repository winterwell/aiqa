import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col } from 'reactstrap';
import { ColumnDef } from '@tanstack/react-table';
import { searchSpans } from '../api';
import { Span } from '../common/types';
import TableUsingAPI, { PageableData } from '../components/TableUsingAPI';

const getTraceId = (span: Span) => {
  return span.client_trace_id || (span as any).traceId || (span as any).spanContext?.()?.traceId || '';
};

const getStartTime = (span: Span) => {
  const startTime = (span as any).startTime;
  if (!startTime) return null;
  // Handle HrTime tuple [seconds, nanoseconds]
  if (Array.isArray(startTime) && startTime.length === 2) {
    return new Date(startTime[0] * 1000 + startTime[1] / 1000000);
  }
  // Handle if it's already a number (milliseconds)
  if (typeof startTime === 'number') {
    return new Date(startTime);
  }
  // Handle if it's already a Date
  if (startTime instanceof Date) {
    return startTime;
  }
  return null;
};

const getDuration = (span: Span): number | null => {
  const startTimeHr = (span as any).startTime;
  const endTimeHr = (span as any).endTime;
  
  // Calculate duration from HrTime tuples if available
  if (Array.isArray(startTimeHr) && Array.isArray(endTimeHr) && startTimeHr.length === 2 && endTimeHr.length === 2) {
    const startMs = startTimeHr[0] * 1000 + startTimeHr[1] / 1000000;
    const endMs = endTimeHr[0] * 1000 + endTimeHr[1] / 1000000;
    return endMs - startMs;
  } else if ((span as any).duration && Array.isArray((span as any).duration)) {
    // Duration as HrTime tuple
    const durHr = (span as any).duration;
    return durHr[0] * 1000 + durHr[1] / 1000000;
  }
  return null;
};

const TracesListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();

  const loadData = async (query: string): Promise<PageableData<Span>> => {
    const limit = 1000; // Fetch more traces for in-memory filtering
    const result = await searchSpans({ organisationId: organisationId!, query, isRoot: true, limit, offset: 0 });
    
    console.log('[TracesListPage] API Response:', {
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      hitsCount: result.hits?.length || 0,
    });
    
    if (result.hits && result.hits.length > 0) {
      console.log('[TracesListPage] First span sample:', result.hits[0]);
      console.log('[TracesListPage] First span keys:', Object.keys(result.hits[0]));
      console.log('[TracesListPage] First span properties:', {
        name: (result.hits[0] as any).name,
        traceId: (result.hits[0] as any).traceId,
        client_trace_id: result.hits[0].client_trace_id,
        startTime: (result.hits[0] as any).startTime,
        duration: (result.hits[0] as any).duration,
      });
    }
    
    return result;
  };

  const columns = useMemo<ColumnDef<Span>[]>(
    () => [
      {
        id: 'traceId',
        header: 'Trace ID',
        cell: ({ row }) => {
          const traceId = getTraceId(row.original);
          console.log('[TracesListPage] traceId cell render:', { traceId, span: row.original });
          if (!traceId) return <span>N/A</span>;
          return <code className="small">{traceId.length > 16 ? `${traceId.substring(0, 16)}...` : traceId}</code>;
        },
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => {
          const name = (row.original as any).name || 'Unknown';
          console.log('[TracesListPage] name cell render:', { name, span: row.original });
          return <span>{name}</span>;
        },
      },
      {
        id: 'startTime',
        header: 'Start Time',
        accessorFn: (row) => {
          const startTime = getStartTime(row);
          return startTime ? startTime.getTime() : null;
        },
        cell: ({ row }) => {
          const startTime = getStartTime(row.original);
          console.log('[TracesListPage] startTime cell render:', { startTime, span: row.original });
          return <span>{startTime ? startTime.toLocaleString() : 'N/A'}</span>;
        },
        enableSorting: true,
      },
      {
        id: 'duration',
        header: 'Duration',
        accessorFn: (row) => {
          const duration = getDuration(row);
          return duration !== null ? duration : null;
        },
        cell: ({ row }) => {
          const duration = getDuration(row.original);
          console.log('[TracesListPage] duration cell render:', { duration, span: row.original });
          return <span>{duration !== null ? `${Math.round(duration / 1000)}s` : ''}</span>;
        },
        enableSorting: true,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const traceId = getTraceId(row.original);
          return (
            <Link
              to={`/organisation/${organisationId}/traces/${traceId}`}
              className="btn btn-sm btn-primary"
            >
              View
            </Link>
          );
        },
      },
    ],
    [organisationId]
  );

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Traces</h1>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <TableUsingAPI
            loadData={loadData}
            columns={columns}
            searchPlaceholder="Search traces"
            searchDebounceMs={500}
            pageSize={50}
            enableInMemoryFiltering={true}
            initialSorting={[{ id: 'startTime', desc: true }]}
          />
        </Col>
      </Row>
    </Container>
  );
};

export default TracesListPage;

