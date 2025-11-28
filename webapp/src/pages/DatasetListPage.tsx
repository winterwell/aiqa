import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Input, Table, Button, Form, FormGroup, Label, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listDatasets, createDataset } from '../api';
import { Dataset } from '../common/types';

const DatasetListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [datasetName, setDatasetName] = useState('');
  const [datasetDescription, setDatasetDescription] = useState('');

  const { data: datasets, isLoading, error } = useQuery({
    queryKey: ['datasets', organisationId],
    queryFn: () => listDatasets(organisationId),
    enabled: !!organisationId,
  });

  const createDatasetMutation = useMutation({
    mutationFn: async (datasetData: {
      organisation_id: string;
      name: string;
      description?: string;
    }) => {
      return createDataset(datasetData);
    },
    onSuccess: (newDataset) => {
      queryClient.invalidateQueries({ queryKey: ['datasets', organisationId] });
      setShowCreateForm(false);
      setDatasetName('');
      setDatasetDescription('');
      navigate(`/organisation/${organisationId}/dataset/${newDataset.id}`);
    },
  });

  const handleCreateDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organisationId || !datasetName.trim()) return;

    createDatasetMutation.mutate({
      organisation_id: organisationId,
      name: datasetName.trim(),
      description: datasetDescription.trim() || undefined,
    });
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
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h1>Datasets</h1>
            </div>
            <Button color="primary" onClick={() => setShowCreateForm(true)}>
              Create New Dataset
            </Button>
          </div>
        </Col>
      </Row>

      {showCreateForm && (
        <Row className="mb-4">
          <Col>
            <Card>
              <CardHeader>
                <h5>Create New Dataset</h5>
              </CardHeader>
              <CardBody>
                <Form onSubmit={handleCreateDataset}>
                  <FormGroup>
                    <Label for="datasetName">Dataset Name</Label>
                    <Input
                      type="text"
                      id="datasetName"
                      value={datasetName}
                      onChange={(e) => setDatasetName(e.target.value)}
                      placeholder="Enter dataset name"
                      required
                    />
                  </FormGroup>
                  <FormGroup>
                    <Label for="datasetDescription">Description (optional)</Label>
                    <Input
                      type="textarea"
                      id="datasetDescription"
                      value={datasetDescription}
                      onChange={(e) => setDatasetDescription(e.target.value)}
                      placeholder="Enter dataset description"
                      rows={3}
                    />
                  </FormGroup>
                  <div className="d-flex gap-2">
                    <Button color="primary" type="submit" disabled={createDatasetMutation.isPending}>
                      {createDatasetMutation.isPending ? 'Creating...' : 'Create Dataset'}
                    </Button>
                    <Button color="secondary" onClick={() => {
                      setShowCreateForm(false);
                      setDatasetName('');
                      setDatasetDescription('');
                    }}>
                      Cancel
                    </Button>
                  </div>
                  {createDatasetMutation.isError && (
                    <Alert color="danger" className="mt-3">
                      Failed to create dataset: {createDatasetMutation.error instanceof Error ? createDatasetMutation.error.message : 'Unknown error'}
                    </Alert>
                  )}
                </Form>
              </CardBody>
            </Card>
          </Col>
        </Row>
      )}

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

