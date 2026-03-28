import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Table } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { listReports } from '../api';
import type Report from '../common/types/Report';
import Spinner from '../components/generic/Spinner';

function formatWhen(r: Report): string {
  const u = r.updated ?? r.created;
  if (!u) return '—';
  return new Date(u as unknown as string).toLocaleString();
}

const ReportsListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', organisationId],
    queryFn: () => listReports(organisationId!) as Promise<Report[]>,
    enabled: !!organisationId,
  });

  if (isLoading) {
    return (
      <Container>
        <Spinner centered />
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="mt-4">
        <div className="alert alert-danger">Failed to load reports: {error instanceof Error ? error.message : 'Unknown error'}</div>
      </Container>
    );
  }

  const reports = Array.isArray(data) ? data : [];

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}`} className="btn btn-link mb-3 ps-0">
            ← Back to Organisation
          </Link>
          <h1 className="h3 mb-3">Reports</h1>
          <p className="text-muted small">Drift and coverage embedding reports for this organisation.</p>
          {reports.length === 0 ? (
            <p className="text-muted">No reports yet.</p>
          ) : (
            <Table responsive striped hover size="sm" className="bg-white">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/organisation/${organisationId}/reports/${r.id}`}>{r.name || r.id.slice(0, 8)}</Link>
                    </td>
                    <td>{r.kind}</td>
                    <td>{r.status ?? '—'}</td>
                    <td>{formatWhen(r)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default ReportsListPage;
