import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Badge } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { getDataset, listExperiments, searchInputs } from '../api';
import { Dataset, Experiment, Span } from '../common/types';
import TableUsingAPI, { PageableData } from '../components/TableUsingAPI';

const DatasetDetailsPage: React.FC = () => {
  const { organisationId, datasetId } = useParams<{ organisationId: string; datasetId: string }>();

  const { data: dataset, isLoading, error } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  const { data: experiments } = useQuery({
    queryKey: ['experiments', organisationId, datasetId],
    queryFn: () => listExperiments(organisationId!),
    enabled: !!datasetId && !!organisationId,
    select: (data) => {
      // Filter by dataset_id
      return data.filter((exp: Experiment) => exp.dataset_id === datasetId);
    },
  });

  const loadSpansData = async (query: string): Promise<PageableData<Span>> => {
    const result = await searchInputs(organisationId!, datasetId, query || undefined, 1000, 0);
    return {
      hits: result.hits || [],
      offset: result.offset || 0,
      limit: result.limit || 1000,
      total: result.total,
    };
  };

  const getSpanId = (span: Span) => {
    return (span as any).span?.id || (span as any).client_span_id || 'N/A';
  };

  const getTraceId = (span: Span) => {
    return (span as any).trace?.id || (span as any).client_trace_id || 'N/A';
  };

  const getStartTime = (span: Span) => {
    if (!(span as any).startTime) return null;
    return new Date((span as any).startTime[0] * 1000 + (span as any).startTime[1] / 1000000);
  };

  const getDuration = (span: Span) => {
    if (!(span as any).startTime || !(span as any).endTime) return null;
    const start = (span as any).startTime[0] * 1000 + (span as any).startTime[1] / 1000000;
    const end = (span as any).endTime[0] * 1000 + (span as any).endTime[1] / 1000000;
    return end - start;
  };

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
        id: 'traceId',
        header: 'Trace ID',
        cell: ({ row }) => (
          <code className="small">{getTraceId(row.original).substring(0, 16)}...</code>
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

  if (isLoading) {
    return (
      <Container className="mt-4">
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </Container>
    );
  }

  if (error || !dataset) {
    return (
      <Container className="mt-4">
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load dataset: {error instanceof Error ? error.message : 'Unknown error'}</p>
          <Link to={`/organisation/${organisationId}/dataset`} className="btn btn-primary">
            Back to Datasets
          </Link>
        </div>
      </Container>
    );
  }

  const datasetExperiments = experiments || [];

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}/dataset`} className="btn btn-link mb-3">
            ← Back to Datasets
          </Link>
          <h1>{dataset.name}</h1>
          <p className="text-muted">Dataset ID: {dataset.id}</p>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col md={6}>
          <Card>
            <CardHeader>
              <h5>Dataset Details</h5>
            </CardHeader>
            <CardBody>
              <ListGroup flush>
                <ListGroupItem>
                  <strong>Description:</strong>{' '}
                  {dataset.description || <span className="text-muted">Not provided</span>}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Tags:</strong>{' '}
                  {dataset.tags && dataset.tags.length > 0 ? (
                    <div className="mt-1">
                      {dataset.tags.map((tag, idx) => (
                        <Badge key={idx} color="secondary" className="me-1">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted">None</span>
                  )}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Created:</strong> {new Date(dataset.created).toLocaleString()}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Updated:</strong> {new Date(dataset.updated).toLocaleString()}
                </ListGroupItem>
              </ListGroup>
            </CardBody>
          </Card>
        </Col>

      </Row>

      {dataset.metrics && (
        <Row className="mt-3">
          <Col>
            <Card>
              <CardHeader>
                <h5>Metrics</h5>
              </CardHeader>
              <CardBody>
                <pre className="bg-light p-3">
                  {JSON.stringify(dataset.metrics, null, 2)}
                </pre>
              </CardBody>
            </Card>
          </Col>
        </Row>
      )}

      <Row className="mt-3">
        <Col>
          <TableUsingAPI
            loadData={loadSpansData}
            columns={columns}
            searchPlaceholder="Search spans..."
            searchDebounceMs={500}
            pageSize={50}
            enableInMemoryFiltering={true}
          />
        </Col>
      </Row>

    </Container>
  );
};

export default DatasetDetailsPage;

