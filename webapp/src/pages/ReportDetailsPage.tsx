import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Row, Col, Button, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getReport, runReport } from '../api';
import type Report from '../common/types/Report';
import Page from '../components/generic/Page';
import Spinner from '../components/generic/Spinner';
import { useToast } from '../utils/toast';

function ReportsBackLink({ organisationId }: { organisationId: string }) {
  return (
    <Link to={`/organisation/${organisationId}/reports`} className="btn btn-link mb-3 ps-0">
      ← Reports
    </Link>
  );
}

const ReportDetailsPage: React.FC = () => {
  const { organisationId, reportId } = useParams<{ organisationId: string; reportId: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: report, isLoading, error } = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => getReport(reportId!) as Promise<Report>,
    enabled: !!reportId,
  });

  const runMutation = useMutation({
    mutationFn: () => runReport(reportId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report', reportId] });
      queryClient.invalidateQueries({ queryKey: ['reports', organisationId] });
      showToast('Report run finished', 'success');
    },
    onError: (e: Error) => showToast(e.message || 'Run failed', 'error'),
  });

  const back = organisationId ? <ReportsBackLink organisationId={organisationId} /> : undefined;

  if (isLoading) {
    return (
      <Page header="Report" back={back}>
        <Spinner centered />
      </Page>
    );
  }

  if (error || !report) {
    return (
      <Page header="Report" back={back}>
        <Alert color="danger">{error instanceof Error ? error.message : 'Report not found'}</Alert>
      </Page>
    );
  }

  return (
    <Page
      back={back}
      header={
        <span className="d-flex flex-wrap align-items-center gap-2">
          <span className="h3 mb-0">{report.name || 'Report'}</span>
          <Button color="primary" size="sm" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            {runMutation.isPending ? 'Running…' : 'Run analysis'}
          </Button>
        </span>
      }
    >
      <Row>
        <Col>
          <dl className="row small mb-3">
            <dt className="col-sm-2">ID</dt>
            <dd className="col-sm-10">
              <code>{report.id}</code>
            </dd>
            <dt className="col-sm-2">Kind</dt>
            <dd className="col-sm-10">{report.kind}</dd>
            <dt className="col-sm-2">Status</dt>
            <dd className="col-sm-10">{report.status ?? '—'}</dd>
            {report.dataset && (
              <>
                <dt className="col-sm-2">Dataset</dt>
                <dd className="col-sm-10">
                  <Link to={`/organisation/${organisationId}/dataset/${report.dataset}`}>{report.dataset}</Link>
                </dd>
              </>
            )}
            <dt className="col-sm-2">Updated</dt>
            <dd className="col-sm-10">{report.updated ? new Date(report.updated as unknown as string).toLocaleString() : '—'}</dd>
          </dl>
          <h2 className="h6">Summary</h2>
          <pre className="small bg-light border rounded p-2 overflow-auto" style={{ maxHeight: 240 }}>
            {JSON.stringify(report.summary ?? {}, null, 2)}
          </pre>
          <h2 className="h6 mt-3">Results</h2>
          <pre className="small bg-light border rounded p-2 overflow-auto" style={{ maxHeight: 480 }}>
            {JSON.stringify(report.results ?? {}, null, 2)}
          </pre>
        </Col>
      </Row>
    </Page>
  );
};

export default ReportDetailsPage;
