import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, Input, Table, Pagination, PaginationItem, PaginationLink } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { searchSpans } from '../api';
import { Span } from '../common/types';

const TracesListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['spans', organisationId, searchQuery, limit, offset],
    queryFn: () => searchSpans(organisationId!, searchQuery || undefined, limit, offset),
    enabled: !!organisationId,
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setOffset(0);
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    window.scrollTo(0, 0);
  };

  const getTraceId = (span: Span) => {
    return span.client_trace_id || span.traceId;
  };

  const getSpanId = (span: Span) => {
    return span.client_span_id || span.spanContext().spanId;
  };

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
          <p>Failed to load traces: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  const spans = data?.hits || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  // Group spans by trace ID
  const tracesMap = new Map<string, Span[]>();
  spans.forEach((span) => {
    const traceId = getTraceId(span);
    if (traceId) {
      if (!tracesMap.has(traceId)) {
        tracesMap.set(traceId, []);
      }
      tracesMap.get(traceId)!.push(span);
    }
  });

  const traces = Array.from(tracesMap.entries());

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Traces</h1>
          <p className="text-muted">Organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Input
            type="text"
            placeholder="Search traces (Gmail-style syntax)"
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Card>
            <CardBody>
              {traces.length === 0 ? (
                <p className="text-muted">No traces found.</p>
              ) : (
                <>
                  <p className="text-muted">
                    Showing {offset + 1}-{Math.min(offset + limit, total)} of {total} traces
                  </p>
                  <Table hover>
                    <thead>
                      <tr>
                        <th>Trace ID</th>
                        <th>Spans</th>
                        <th>Name</th>
                        <th>Start Time</th>
                        <th>Duration</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traces.map(([traceId, traceSpans]) => {
                        const firstSpan = traceSpans[0];
                        const startTime = firstSpan.startTime
                          ? new Date(firstSpan.startTime[0] * 1000 + firstSpan.startTime[1] / 1000000)
                          : null;
                        const endTime = traceSpans.reduce((latest, span) => {
                          if (!span.endTime) return latest;
                          const spanEnd = new Date(span.endTime[0] * 1000 + span.endTime[1] / 1000000);
                          return !latest || spanEnd > latest ? spanEnd : latest;
                        }, null as Date | null);
                        const duration = startTime && endTime ? endTime.getTime() - startTime.getTime() : null;
                        const name = firstSpan.name || 'Unknown';

                        return (
                          <tr key={traceId}>
                            <td>
                              <code className="small">{traceId.substring(0, 16)}...</code>
                            </td>
                            <td>{traceSpans.length}</td>
                            <td>{name}</td>
                            <td>{startTime ? startTime.toLocaleString() : 'N/A'}</td>
                            <td>{duration !== null ? `${duration}ms` : 'N/A'}</td>
                            <td>
                              <Link
                                to={`/organisation/${organisationId}/traces/${traceId}`}
                                className="btn btn-sm btn-primary"
                              >
                                View
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>

                  {totalPages > 1 && (
                    <Pagination className="mt-3">
                      <PaginationItem disabled={currentPage === 1}>
                        <PaginationLink
                          previous
                          onClick={() => handlePageChange(Math.max(0, offset - limit))}
                        />
                      </PaginationItem>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                        if (
                          page === 1 ||
                          page === totalPages ||
                          (page >= currentPage - 2 && page <= currentPage + 2)
                        ) {
                          return (
                            <PaginationItem key={page} active={page === currentPage}>
                              <PaginationLink
                                onClick={() => handlePageChange((page - 1) * limit)}
                              >
                                {page}
                              </PaginationLink>
                            </PaginationItem>
                          );
                        } else if (
                          page === currentPage - 3 ||
                          page === currentPage + 3
                        ) {
                          return (
                            <PaginationItem key={page} disabled>
                              <PaginationLink>...</PaginationLink>
                            </PaginationItem>
                          );
                        }
                        return null;
                      })}
                      <PaginationItem disabled={currentPage === totalPages}>
                        <PaginationLink
                          next
                          onClick={() => handlePageChange(Math.min((totalPages - 1) * limit, offset + limit))}
                        />
                      </PaginationItem>
                    </Pagination>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default TracesListPage;

