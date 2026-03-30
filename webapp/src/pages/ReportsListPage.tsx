import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Row, Col, Table, Card, CardBody, CardTitle, CardText, Button, Label, Input, FormGroup, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listReports, listDatasets, createReport } from '../api';
import type Report from '../common/types/Report';
import type Dataset from '../common/types/Dataset';
import Page from '../components/generic/Page';
import Spinner from '../components/generic/Spinner';
import { useToast } from '../utils/toast';

function formatWhen(r: Report): string {
  const u = r.updated ?? r.created;
  if (!u) return '—';
  return new Date(u as unknown as string).toLocaleString();
}

const DRIFT_DESCRIPTION =
  'Track how span inputs or outputs cluster over time (monthly buckets). Uses embeddings and PCA for a compact view of behaviour drift.';

const COVERAGE_DESCRIPTION =
  'Compare dataset examples with live traces in embedding space to see how well your eval set reflects production traffic.';

const ReportsListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [coverageDatasetId, setCoverageDatasetId] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', organisationId],
    queryFn: () => listReports(organisationId!) as Promise<Report[]>,
    enabled: !!organisationId,
  });

  const { data: datasets } = useQuery({
    queryKey: ['datasets', organisationId],
    queryFn: () => listDatasets(organisationId!) as Promise<Dataset[]>,
    enabled: !!organisationId,
  });

  useEffect(() => {
    if (!coverageDatasetId && datasets?.length === 1) {
      setCoverageDatasetId(datasets[0].id);
    }
  }, [datasets, coverageDatasetId]);

  const createMutation = useMutation({
    mutationFn: (opts: { kind: 'drift' | 'coverage'; dataset?: string }) =>
      createReport(organisationId!, {
        kind: opts.kind,
        name: opts.kind === 'drift' ? `Drift — ${new Date().toLocaleString()}` : `Coverage — ${new Date().toLocaleString()}`,
        dataset: opts.dataset,
      }) as Promise<Report>,
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['reports', organisationId] });
      navigate(`/organisation/${organisationId}/reports/${report.id}`);
    },
    onError: (e: Error) => showToast(e.message || 'Could not create report', 'error'),
  });

  if (isLoading) {
    return (
      <Page header="Reports">
        <Spinner centered />
      </Page>
    );
  }

  if (error) {
    return (
      <Page header="Reports">
        <Alert color="danger">
          Failed to load reports: {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      </Page>
    );
  }

  const reports = Array.isArray(data) ? data : [];
  const datasetList = Array.isArray(datasets) ? datasets : [];

  return (
    <Page
      header="Reports"
      back={organisationId ? `/organisation/${organisationId}` : undefined}
      backLabel="Organisation"
    >
      <p className="text-muted small mb-4">Drift and coverage embedding reports for this organisation.</p>

      <Row className="g-3 mb-4">
        <Col md={6}>
          <Card className="h-100 border">
            <CardBody className="d-flex flex-column">
              <CardTitle tag="h5" className="h5">
                Drift report
              </CardTitle>
              <CardText className="text-muted small flex-grow-1">{DRIFT_DESCRIPTION}</CardText>
              <Button
                color="primary"
                size="sm"
                className="align-self-start"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate({ kind: 'drift' })}
              >
                Create new report
              </Button>
            </CardBody>
          </Card>
        </Col>
        <Col md={6}>
          <Card className="h-100 border">
            <CardBody className="d-flex flex-column">
              <CardTitle tag="h5" className="h5">
                Coverage report
              </CardTitle>
              <CardText className="text-muted small">{COVERAGE_DESCRIPTION}</CardText>
              {datasetList.length === 0 ? (
                <p className="small text-warning mb-2">Create a dataset first to run coverage.</p>
              ) : (
                <FormGroup className="mb-2">
                  <Label for="coverage-dataset" className="small">
                    Dataset
                  </Label>
                  <Input
                    id="coverage-dataset"
                    type="select"
                    bsSize="sm"
                    value={coverageDatasetId}
                    onChange={(e) => setCoverageDatasetId(e.target.value)}
                  >
                    <option value="">Select dataset…</option>
                    {datasetList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Input>
                </FormGroup>
              )}
              <Button
                color="primary"
                size="sm"
                className="align-self-start"
                disabled={createMutation.isPending || datasetList.length === 0 || !coverageDatasetId}
                onClick={() => createMutation.mutate({ kind: 'coverage', dataset: coverageDatasetId })}
              >
                Create new report
              </Button>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <h2 className="h6 text-muted mb-2">Existing reports</h2>
      {reports.length === 0 ? (
        <p className="text-muted">None yet — use a card above to create one.</p>
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
    </Page>
  );
};

export default ReportsListPage;
