import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Badge } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { getDataset, listExperiments } from '../api';
import { Dataset, Experiment } from '../common/types';

const DatasetDetailsPage: React.FC = () => {
  const { organisationId, datasetId } = useParams<{ organisationId: string; datasetId: string }>();

  const { data: dataset, isLoading, error } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  const { data: experiments } = useQuery({
    queryKey: ['experiments', datasetId],
    queryFn: () => listExperiments(),
    enabled: !!datasetId,
    select: (data) => {
      // Filter by dataset_id
      return data.filter((exp: Experiment) => exp.dataset_id === datasetId);
    },
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

        <Col md={6}>
          <Card>
            <CardHeader>
              <h5>Schemas</h5>
            </CardHeader>
            <CardBody>
              <div className="mb-3">
                <strong>Input Schema:</strong>
                {dataset.input_schema ? (
                  <pre className="bg-light p-2 mt-2 small">
                    {JSON.stringify(dataset.input_schema, null, 2)}
                  </pre>
                ) : (
                  <p className="text-muted">Not defined</p>
                )}
              </div>
              <div>
                <strong>Output Schema:</strong>
                {dataset.output_schema ? (
                  <pre className="bg-light p-2 mt-2 small">
                    {JSON.stringify(dataset.output_schema, null, 2)}
                  </pre>
                ) : (
                  <p className="text-muted">Not defined</p>
                )}
              </div>
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
          <Card>
            <CardHeader>
              <h5>Experiments ({datasetExperiments.length})</h5>
            </CardHeader>
            <CardBody>
              {datasetExperiments.length === 0 ? (
                <p className="text-muted">No experiments found for this dataset.</p>
              ) : (
                <div className="list-group">
                  {datasetExperiments.map((experiment: Experiment) => (
                    <Link
                      key={experiment.id}
                      to={`/organisation/${organisationId}/dataset/${datasetId}/experiment/${experiment.id}`}
                      className="list-group-item list-group-item-action"
                    >
                      <div className="d-flex w-100 justify-content-between">
                        <h6 className="mb-1">Experiment {experiment.id.substring(0, 8)}...</h6>
                        <small>{new Date(experiment.created).toLocaleString()}</small>
                      </div>
                      <p className="mb-1 text-muted small">
                        Updated: {new Date(experiment.updated).toLocaleString()}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default DatasetDetailsPage;

