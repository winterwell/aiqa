import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { getExperiment, getDataset } from '../api';
import { Experiment, Dataset } from '../common/types';
import TableUsingAPI from '../components/generic/TableUsingAPI';
import CopyButton from '../components/generic/CopyButton';
import { useToast } from '../utils/toast';
import ExperimentDetailsDashboard from '../components/ExperimentDetailsDashboard';
import PropInput from '../components/generic/PropInput';

const ExperimentDetailsPage: React.FC = () => {
  const { organisationId, datasetId, experimentId } = useParams<{
    organisationId: string;
    datasetId: string;
    experimentId: string;
  }>();

  const { showToast } = useToast();

  const { data: experiment, isLoading, error } = useQuery({
    queryKey: ['experiment', experimentId],
    queryFn: () => getExperiment(experimentId!),
    enabled: !!experimentId,
  });

  const { data: dataset } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  // columns: result id, errors, ...metrics
  // Get the metrics from the dataset
  // This must be computed before any early returns to satisfy Rules of Hooks
  const columns = useMemo(() => {
    const metrics = dataset?.metrics || [];
    // add any missing metrics - scores used in examples
    if (experiment?.results) {
      for (const result of experiment.results) {
        for (const metricName in result.scores || []) {
          if (!metrics.find(metric => metric.name === metricName)) {
            metrics.push({ name: metricName, type: 'number' });
          }
        }
      }
    }
    return [
      {
        header: 'Example ID',
        accessorKey: 'exampleId',
      },
	//   {
	// 	header: 'json',
	// 	accessorFn: (row) => JSON.stringify(row),
	//   },
      ...metrics.map(metric => ({
        header: metric.name,
		accessorFn: (row) => row.scores?.[metric.name] || row.errors?.[metric.name],
      })),
	  {
        header: 'Errors',
        accessorKey: 'errors',
		accessorFn: (row) => row.errors ? JSON.stringify(row.errors) : "",
      },
    ];
  }, [dataset?.metrics, experiment?.results]);

  if (isLoading) {
    return (
      <Container>
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </Container>
    );
  }

  if (error || !experiment) {
    return (
      <Container>
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load experiment: {error instanceof Error ? error.message : 'Unknown error'}</p>
          <Link to={`/organisation/${organisationId}/experiments`} className="btn btn-primary">
            Back to Experiments List
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link
            to={`/organisation/${organisationId}/dataset/${datasetId}`}
            className="btn btn-link mb-3"
          >
            ← Back to Dataset
          </Link>
		  {experiment.name || experiment.id}
          <h1>Experiment: <PropInput item={experiment} prop="name" label="" inline /></h1>
          <p className="text-muted">
            Experiment ID: <code>{experiment.id}</code> <CopyButton content={experiment.id} showToast={showToast} />
          </p>
          {dataset && (
            <p className="text-muted">
              Dataset: <Link to={`/organisation/${organisationId}/dataset/${datasetId}`}>{dataset.name || datasetId}</Link>
            </p>
          )}
		            <p>
                <strong>Created:</strong> {new Date(experiment.created).toLocaleString()}
              </p>
    
        </Col>
      </Row>

	<ExperimentDetailsDashboard experiment={experiment} />

		<TableUsingAPI 
			data={{ hits: experiment.results || [] }} 
			columns={columns}
			queryKeyPrefix={['experiment-results', organisationId, experimentId]}
		/>
    </Container>
  );
};

export default ExperimentDetailsPage;

