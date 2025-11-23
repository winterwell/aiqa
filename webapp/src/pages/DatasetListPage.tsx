import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, Input, Table, Pagination, PaginationItem, PaginationLink } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { listDatasets } from '../api';
import { Dataset } from '../common/types';

const DatasetListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: datasets, isLoading, error } = useQuery({
    queryKey: ['datasets', organisationId, searchQuery],
    queryFn: () => listDatasets(searchQuery || undefined),
    enabled: !!organisationId,
    select: (data) => {
      // Filter by organisation_id on the client side since the API might not support it
      return data.filter((ds: Dataset) => ds.organisation_id === organisationId);
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
          <p>Failed to load datasets: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  const filteredDatasets = datasets || [];

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}`} className="btn btn-link mb-3">
            ← Back to Organisation
          </Link>
          <h1>Datasets</h1>
          <p className="text-muted">Organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Input
            type="text"
            placeholder="Search datasets (Gmail-style syntax)"
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Card>
            <CardBody>
              {filteredDatasets.length === 0 ? (
                <p className="text-muted">No datasets found.</p>
              ) : (
                <Table hover>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Description</th>
                      <th>Tags</th>
                      <th>Created</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDatasets.map((dataset: Dataset) => (
                      <tr key={dataset.id}>
                        <td>
                          <strong>{dataset.name}</strong>
                        </td>
                        <td>{dataset.description || <span className="text-muted">-</span>}</td>
                        <td>
                          {dataset.tags && dataset.tags.length > 0 ? (
                            <div>
                              {dataset.tags.map((tag, idx) => (
                                <span key={idx} className="badge bg-secondary me-1">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>{new Date(dataset.created).toLocaleString()}</td>
                        <td>{new Date(dataset.updated).toLocaleString()}</td>
                        <td>
                          <Link
                            to={`/organisation/${organisationId}/dataset/${dataset.id}`}
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

export default DatasetListPage;

