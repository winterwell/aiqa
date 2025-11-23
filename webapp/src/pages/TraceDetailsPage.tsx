import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Table, Badge } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { searchSpans } from '../api';
import { Span } from '../common/types';

const TraceDetailsPage: React.FC = () => {
  const { organisationId, traceId } = useParams<{ organisationId: string; traceId: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['trace', organisationId, traceId],
    queryFn: async () => {
      // Search for spans with this trace ID
      const result = await searchSpans(organisationId!, `trace_id:${traceId}`, 1000, 0);
      return result.hits.filter((span) => {
        const spanTraceId = span.client_trace_id || span.traceId;
        return spanTraceId === traceId;
      });
    },
    enabled: !!organisationId && !!traceId,
  });

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

  if (error) {
    return (
      <Container className="mt-4">
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load trace: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  const spans = data || [];

  if (spans.length === 0) {
    return (
      <Container className="mt-4">
        <div className="alert alert-warning">
          <h4>Trace Not Found</h4>
          <p>No spans found for trace ID: {traceId}</p>
          <Link to={`/organisation/${organisationId}/traces`} className="btn btn-primary">
            Back to Traces
          </Link>
        </div>
      </Container>
    );
  }

  // Sort spans by start time
  const sortedSpans = [...spans].sort((a, b) => {
    const aTime = a.startTime ? a.startTime[0] * 1000 + a.startTime[1] / 1000000 : 0;
    const bTime = b.startTime ? b.startTime[0] * 1000 + b.startTime[1] / 1000000 : 0;
    return aTime - bTime;
  });

  const getSpanId = (span: Span) => {
    return span.client_span_id || span.spanContext().spanId;
  };

  const getStartTime = (span: Span) => {
    if (!span.startTime) return null;
    return new Date(span.startTime[0] * 1000 + span.startTime[1] / 1000000);
  };

  const getEndTime = (span: Span) => {
    if (!span.endTime) return null;
    return new Date(span.endTime[0] * 1000 + span.endTime[1] / 1000000);
  };

  const getDuration = (span: Span) => {
    const start = getStartTime(span);
    const end = getEndTime(span);
    if (!start || !end) return null;
    return end.getTime() - start.getTime();
  };

  const firstSpan = sortedSpans[0];
  const lastSpan = sortedSpans[sortedSpans.length - 1];
  const traceStart = getStartTime(firstSpan);
  const traceEnd = getEndTime(lastSpan);
  const traceDuration = traceStart && traceEnd ? traceEnd.getTime() - traceStart.getTime() : null;

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}/traces`} className="btn btn-link mb-3">
            ← Back to Traces
          </Link>
          <h1>Trace Details</h1>
          <p className="text-muted">
            <code>{traceId}</code>
          </p>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col md={4}>
          <Card>
            <CardHeader>
              <h5>Trace Summary</h5>
            </CardHeader>
            <CardBody>
              <p>
                <strong>Spans:</strong> {spans.length}
              </p>
              {traceStart && (
                <p>
                  <strong>Start Time:</strong> {traceStart.toLocaleString()}
                </p>
              )}
              {traceEnd && (
                <p>
                  <strong>End Time:</strong> {traceEnd.toLocaleString()}
                </p>
              )}
              {traceDuration !== null && (
                <p>
                  <strong>Duration:</strong> {traceDuration}ms
                </p>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Card>
            <CardHeader>
              <h5>Spans</h5>
            </CardHeader>
            <CardBody>
              <Table hover>
                <thead>
                  <tr>
                    <th>Span ID</th>
                    <th>Name</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Start Time</th>
                    <th>Duration</th>
                    <th>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSpans.map((span) => {
                    const startTime = getStartTime(span);
                    const duration = getDuration(span);
                    const status = span.status?.code === 1 ? 'Error' : 'OK';
                    const kind = span.kind || 'UNSPECIFIED';

                    return (
                      <tr key={getSpanId(span)}>
                        <td>
                          <code className="small">{getSpanId(span).substring(0, 16)}...</code>
                        </td>
                        <td>{span.name || 'Unknown'}</td>
                        <td>
                          <Badge color="secondary">{kind}</Badge>
                        </td>
                        <td>
                          <Badge color={status === 'Error' ? 'danger' : 'success'}>
                            {status}
                          </Badge>
                        </td>
                        <td>{startTime ? startTime.toLocaleString() : 'N/A'}</td>
                        <td>{duration !== null ? `${duration}ms` : 'N/A'}</td>
                        <td>
                          {span.tags && Object.keys(span.tags).length > 0 ? (
                            <small>
                              {Object.entries(span.tags)
                                .slice(0, 3)
                                .map(([key, value]) => `${key}=${value}`)
                                .join(', ')}
                              {Object.keys(span.tags).length > 3 && '...'}
                            </small>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default TraceDetailsPage;

