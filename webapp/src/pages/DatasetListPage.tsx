import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Input, Table, Button, Form, FormGroup, Label, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listDatasets, createDataset } from '../api';
import { Dataset } from '../common/types';
import Spinner from '../components/generic/Spinner';
import { populateDatasetFromRecentTraces, type TraceSampleWindow } from '../datasetPopulateFromTraces';
import { useToast } from '../utils/toast';

const DatasetListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [datasetName, setDatasetName] = useState('');
  const [datasetDescription, setDatasetDescription] = useState('');
  const [populateExampleCount, setPopulateExampleCount] = useState(20);
  const [traceSampleWindow, setTraceSampleWindow] = useState<TraceSampleWindow>('1d');

  const { data: datasets, isLoading, error } = useQuery({
    queryKey: ['datasets', organisationId],
    queryFn: () => listDatasets(organisationId),
    enabled: !!organisationId,
  });

  const createDatasetMutation = useMutation({
    mutationFn: async (datasetData: {
      organisation: string;
      name: string;
      description?: string;
      populateExampleCount: number;
      traceSampleWindow: TraceSampleWindow;
    }) => {
      const { populateExampleCount: n, traceSampleWindow: tw, ...createPayload } = datasetData;
      const newDataset = await createDataset(createPayload);
      if (n > 0) {
        const { created, failed } = await populateDatasetFromRecentTraces({
          organisationId: datasetData.organisation,
          datasetId: newDataset.id,
          count: n,
          window: tw,
        });
        return { newDataset, populate: { requested: n, created, failed } as const };
      }
      return { newDataset, populate: null };
    },
    onSuccess: ({ newDataset, populate }) => {
      queryClient.invalidateQueries({ queryKey: ['datasets', organisationId] });
      queryClient.invalidateQueries({ queryKey: ['examples'] });
      queryClient.invalidateQueries({ queryKey: ['dataset-examples', organisationId, newDataset.id] });
      setShowCreateForm(false);
      setDatasetName('');
      setDatasetDescription('');
      setPopulateExampleCount(20);
      setTraceSampleWindow('1d');
      if (populate) {
        const { requested, created, failed } = populate;
        if (requested > 0 && created === 0) {
          showToast(
            `Dataset created, but no examples were added from traces (${failed} failed or no traces in window).`,
            'warning'
          );
        } else if (failed > 0 || created < requested) {
          showToast(
            `Dataset created with ${created} example(s) from traces (requested ${requested}${failed ? `, ${failed} skipped` : ''}).`,
            'info'
          );
        } else {
          showToast(`Dataset created with ${created} example(s) from recent traces.`, 'success');
        }
      }
      navigate(`/organisation/${organisationId}/dataset/${newDataset.id}`);
    },
  });

  const handleCreateDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organisationId || !datasetName.trim()) return;

    createDatasetMutation.mutate({
      organisation: organisationId,
      name: datasetName.trim(),
      description: datasetDescription.trim() || undefined,
      populateExampleCount: Math.max(0, Math.floor(Number(populateExampleCount)) || 0),
      traceSampleWindow,
    });
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
                  <FormGroup>
                    <Label for="populateExamples">Examples from recent traces (optional)</Label>
                    <div className="d-flex flex-wrap align-items-end gap-3">
                      <div>
                        <Input
                          id="populateExamples"
                          type="number"
                          min={0}
                          max={500}
                          value={populateExampleCount}
                          onChange={(e) => setPopulateExampleCount(Number(e.target.value))}
                          className="text-end"
                          style={{ maxWidth: '6rem' }}
                        />
                        <small className="text-muted d-block mt-1">Random sample count (0 = none)</small>
                      </div>
                      <div>
                        <Input
                          type="select"
                          value={traceSampleWindow}
                          onChange={(e) => setTraceSampleWindow(e.target.value as TraceSampleWindow)}
                          style={{ minWidth: '10rem' }}
                        >
                          <option value="1h">Last 1 hour</option>
                          <option value="1d">Last 1 day</option>
                          <option value="1w">Last 1 week</option>
                        </Input>
                        <small className="text-muted d-block mt-1">Trace time window</small>
                      </div>
                    </div>
                  </FormGroup>
                  <div className="d-flex gap-2">
                    <Button color="primary" type="submit" disabled={createDatasetMutation.isPending}>
                      {createDatasetMutation.isPending ? 'Creating...' : 'Create Dataset'}
                    </Button>
                    <Button color="secondary" onClick={() => {
                      setShowCreateForm(false);
                      setDatasetName('');
                      setDatasetDescription('');
                      setPopulateExampleCount(20);
                      setTraceSampleWindow('1d');
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
                      {/* TODO - wants load-stats to avoid loading all examples <th>Examples</th> */}
                      <th>Created</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDatasets.map((dataset: Dataset) => (
                      <tr 
                        key={dataset.id}
                        onClick={() => navigate(`/organisation/${organisationId}/dataset/${dataset.id}`)}
                        style={{ cursor: 'pointer' }}
                      >
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

