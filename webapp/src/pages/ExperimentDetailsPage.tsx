import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { getExperiment, getDataset } from '../api';
import { Experiment, Dataset } from '../common/types';

const ExperimentDetailsPage: React.FC = () => {
  const { organisationId, datasetId, experimentId } = useParams<{
    organisationId: string;
    datasetId: string;
    experimentId: string;
  }>();

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

  if (error || !experiment) {
    return (
      <Container className="mt-4">
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load experiment: {error instanceof Error ? error.message : 'Unknown error'}</p>
          <Link to={`/organisation/${organisationId}/dataset/${datasetId}`} className="btn btn-primary">
            Back to Dataset
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
          <h1>Experiment Details</h1>
          <p className="text-muted">
            Experiment ID: <code>{experiment.id}</code>
          </p>
          {dataset && (
            <p className="text-muted">
              Dataset: <Link to={`/organisation/${organisationId}/dataset/${datasetId}`}>{dataset.name}</Link>
            </p>
          )}
        </Col>
      </Row>

      <Row className="mt-3">
        <Col md={6}>
          <Card>
            <CardHeader>
              <h5>Experiment Information</h5>
            </CardHeader>
            <CardBody>
              <p>
                <strong>ID:</strong> <code>{experiment.id}</code>
              </p>
              <p>
                <strong>Dataset ID:</strong> <code>{experiment.dataset_id}</code>
              </p>
              <p>
                <strong>Organisation ID:</strong> <code>{experiment.organisation_id}</code>
              </p>
              <p>
                <strong>Created:</strong> {new Date(experiment.created).toLocaleString()}
              </p>
              <p>
                <strong>Updated:</strong> {new Date(experiment.updated).toLocaleString()}
              </p>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Card>
            <CardHeader>
              <h5>Summary Results</h5>
            </CardHeader>
            <CardBody>
              {experiment.summary_results ? (
                <pre className="bg-light p-3" style={{ maxHeight: '600px', overflow: 'auto' }}>
                  {JSON.stringify(experiment.summary_results, null, 2)}
                </pre>
              ) : (
                <p className="text-muted">No summary results available.</p>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default ExperimentDetailsPage;

