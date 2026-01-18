import React, { useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Table, Badge } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { listDatasets } from '../api';
import Dataset, { Metric } from '../common/types/Dataset';
import Spinner from '../components/generic/Spinner';

interface MetricWithSource {
  metric: Metric;
  datasetId?: string;
  datasetName?: string;
}

const MetricsListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();

  const { data: datasets, isLoading, error } = useQuery({
    queryKey: ['datasets', organisationId],
    queryFn: () => listDatasets(organisationId!),
    enabled: !!organisationId,
  });

  // Basic metrics that are always available
  const basicMetrics: MetricWithSource[] = useMemo(() => [
    { metric: { name: 'duration', description: 'Duration of the trace', unit: 'ms', type: 'number' } },
    { metric: { name: 'token_count', description: 'Total number of tokens used', unit: 'tokens', type: 'number' } },
    { metric: { name: 'token_cost', description: 'Estimated cost of tokens', unit: 'USD', type: 'number' } },
  ], []);

  // Custom metrics from datasets
  const customMetrics: MetricWithSource[] = useMemo(() => {
    if (!datasets || datasets.length === 0) return [];
    
    const metrics: MetricWithSource[] = [];
    datasets.forEach((dataset: Dataset) => {
      if (dataset.metrics && dataset.metrics.length > 0) {
        dataset.metrics.forEach((metric: Metric) => {
          metrics.push({
            metric,
            datasetId: dataset.id,
            datasetName: dataset.name,
          });
        });
      }
    });
    return metrics;
  }, [datasets]);

  const allMetrics = useMemo(() => [...basicMetrics, ...customMetrics], [basicMetrics, customMetrics]);
  const hasMultipleDatasets = useMemo(() => (datasets?.length || 0) > 1, [datasets]);

  const handleMetricClick = (metric: MetricWithSource) => {
    // Only custom metrics are clickable
    if (metric.datasetId) {
      navigate(`/organisation/${organisationId}/metric/${encodeURIComponent(metric.metric.name)}?datasetId=${metric.datasetId}`);
    }
  };

  if (isLoading) {
    return (
      <Container>
        <Spinner centered />
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load metrics: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}`} className="btn btn-link mb-3">
            ← Back to Organisation
          </Link>
          <h1>Metrics</h1>
          <p className="text-muted">View all metrics for organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Card>
            <CardHeader>
              <h5>All Metrics</h5>
            </CardHeader>
            <CardBody>
              {allMetrics.length === 0 ? (
                <p className="text-muted">No metrics found.</p>
              ) : (
                <Table hover>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th>Unit</th>
                      {hasMultipleDatasets && <th>Dataset</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {allMetrics.map((metricWithSource, index) => {
                      const { metric, datasetName } = metricWithSource;
                      const isClickable = !!metricWithSource.datasetId;
                      return (
                        <tr
                          key={`${metric.name}-${metricWithSource.datasetId || 'basic'}-${index}`}
                          onClick={() => isClickable && handleMetricClick(metricWithSource)}
                          style={{ cursor: isClickable ? 'pointer' : 'default' }}
                        >
                          <td>
                            <strong>{metric.name}</strong>
                            {isClickable && <span className="ms-2 text-muted">→</span>}
                          </td>
                          <td>{metric.description || <span className="text-muted">-</span>}</td>
                          <td>
                            <Badge color="info">{metric.type}</Badge>
                          </td>
                          <td>{metric.unit || <span className="text-muted">-</span>}</td>
                          {hasMultipleDatasets && (
                            <td>{datasetName || <span className="text-muted">System</span>}</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default MetricsListPage;






















