import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Input, Table, Button, Form, FormGroup, Label, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listExperiments, createExperiment, listDatasets } from '../api';
import { Experiment } from '../common/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';


const ExperimentsListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');

  const { data: experiments, isLoading, error } = useQuery({
    queryKey: ['experiments', organisationId, searchQuery],
    queryFn: () => listExperiments(organisationId!, searchQuery || undefined),
    enabled: !!organisationId,
  });

  const { data: datasets } = useQuery({
    queryKey: ['datasets', organisationId],
    queryFn: () => listDatasets(organisationId!),
    enabled: !!organisationId,
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Extract metrics from experiments for charting
  const chartData = useMemo(() => {
    if (!experiments || experiments.length === 0) return [];
    
    // Sort experiments by created date
    const sortedExperiments = [...experiments].sort(
      (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
    );
    
    return sortedExperiments.map((exp: Experiment, index: number) => {
      const date = new Date(exp.created);
      // Use consistent date format with time to distinguish between experiments on same day
      const dateLabel = date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      const summary = exp.summary_results || {};
      
      // Extract common metrics from summary_results
      // Handle various possible structures
      return {
        name: dateLabel,
        latency: summary.latency || summary.avg_latency || summary.mean_latency || null,
        cost: summary.cost || summary.avg_cost || summary.total_cost || null,
        quality: summary.quality || summary.quality_score || summary.avg_quality || null,
        experimentId: exp.id,
        created: exp.created
      };
    });
  }, [experiments]);

  // Check if we have any metrics to display
  const hasLatency = chartData.some(d => d.latency !== null && d.latency !== undefined);
  const hasCost = chartData.some(d => d.cost !== null && d.cost !== undefined);
  const hasQuality = chartData.some(d => d.quality !== null && d.quality !== undefined);
  const hasAnyMetrics = hasLatency || hasCost || hasQuality;

  // Calculate column width based on number of metrics displayed
  const getChartColumnWidth = () => {
    const metricsCount = [hasLatency, hasCost, hasQuality].filter(Boolean).length;
    if (metricsCount <= 1) return 12;
    if (metricsCount === 2) return 6;
    return 4; // 3 metrics
  };
  const chartColWidth = getChartColumnWidth();

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
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h1>Experiment Results</h1>
            </div>
          </div>
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

      {/* Performance Charts */}
      {filteredExperiments.length > 0 && hasAnyMetrics && (
        <Row className="mt-4">
          <Col>
            <Card>
              <CardHeader>
                <h5>Performance Over Time</h5>
              </CardHeader>
              <CardBody>
                <Row>
                  {hasLatency && (
                    <Col md={chartColWidth} className="mb-4">
                      <h6 className="text-center">Latency</h6>
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="latency" 
                            stroke="#8884d8" 
                            name="Latency (ms)"
                            strokeWidth={2}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </Col>
                  )}
                  {hasCost && (
                    <Col md={chartColWidth} className="mb-4">
                      <h6 className="text-center">Cost</h6>
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="cost" 
                            stroke="#82ca9d" 
                            name="Cost (USD)"
                            strokeWidth={2}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </Col>
                  )}
                  {hasQuality && (
                    <Col md={chartColWidth} className="mb-4">
                      <h6 className="text-center">Quality Score</h6>
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="quality" 
                            stroke="#ffc658" 
                            name="Quality"
                            strokeWidth={2}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </Col>
                  )}
                </Row>
              </CardBody>
            </Card>
          </Col>
        </Row>
      )}

      {/* Experiments List */}
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
                          <Link to={`/organisation/${organisationId}/dataset/${experiment.dataset}`}>
                            {experiment.dataset.substring(0, 8)}...
                          </Link>
                        </td>
                        <td>{new Date(experiment.created).toLocaleString()}</td>
                        <td>{new Date(experiment.updated).toLocaleString()}</td>
                        <td>
                          <Link
                            to={`/organisation/${organisationId}/dataset/${experiment.dataset}/experiment/${experiment.id}`}
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