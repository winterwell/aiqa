import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, Input, Table } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { listExperiments } from '../api';
import { Experiment } from '../common/types';

const ExperimentsListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: experiments, isLoading, error } = useQuery({
    queryKey: ['experiments', organisationId, searchQuery],
    queryFn: () => listExperiments(searchQuery || undefined),
    enabled: !!organisationId,
    select: (data) => {
      // Filter by organisation_id on the client side since the API might not support it
      return data.filter((exp: Experiment) => exp.organisation_id === organisationId);
    },
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
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
          <p>Failed to load experiments: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  const filteredExperiments = experiments || [];

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}`} className="btn btn-link mb-3">
            ← Back to Organisation
          </Link>
          <h1>Experiments</h1>
          <p className="text-muted">Organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Input
            type="text"
            placeholder="Search experiments (Gmail-style syntax)"
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Card>
            <CardBody>
              {filteredExperiments.length === 0 ? (
                <p className="text-muted">No experiments found.</p>
              ) : (
                <Table hover>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Dataset ID</th>
                      <th>Created</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExperiments.map((experiment: Experiment) => (
                      <tr key={experiment.id}>
                        <td>
                          <strong>{experiment.id.substring(0, 8)}...</strong>
                        </td>
                        <td>
                          <Link to={`/organisation/${organisationId}/dataset/${experiment.dataset_id}`}>
                            {experiment.dataset_id.substring(0, 8)}...
                          </Link>
                        </td>
                        <td>{new Date(experiment.created).toLocaleString()}</td>
                        <td>{new Date(experiment.updated).toLocaleString()}</td>
                        <td>
                          <Link
                            to={`/organisation/${organisationId}/dataset/${experiment.dataset_id}/experiment/${experiment.id}`}
                            className="btn btn-sm btn-primary"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
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

export default ExperimentsListPage;

