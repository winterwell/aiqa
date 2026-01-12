import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Input, Table, Button, Form, FormGroup, Label, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listExperiments, createExperiment, listDatasets } from '../api';
import { Experiment } from '../common/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import ExperimentsListMetricsDashboard from '../components/ExperimentListMetricsDashboard';
import A from '../components/generic/A';

const ExperimentsListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: experiments, isLoading, error } = useQuery({
    queryKey: ['experiments', organisationId, searchQuery],
    queryFn: () => listExperiments(organisationId!, searchQuery || undefined),
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
      <Container>
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
      <Container>
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
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h1>Experiment Results</h1>
            </div>
          </div>
        </Col>
      </Row>

      <ExperimentsListMetricsDashboard experiments={filteredExperiments} />

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
      {filteredExperiments.length > 0 && hasAnyMetrics && 
	   <ExperimentsListMetricsDashboard experiments={filteredExperiments} />}

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
                      <th>Overall Score</th>
                      <th>Created</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExperiments.map((experiment: Experiment) => {
                      const summary = experiment.summary_results || {};
                      const overallScore = summary['Overall Score'];
                      const overallScoreMean = overallScore?.mean ?? overallScore?.avg ?? overallScore?.average ?? null;
                      const overallScoreValue = overallScoreMean !== null && isFinite(overallScoreMean) 
                        ? overallScoreMean.toFixed(2) 
                        : '-';
                      
                      return (
                        <tr 
                          key={experiment.id}
                          onClick={() => navigate(`/organisation/${organisationId}/experiment/${experiment.id}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <A href={`/organisation/${organisationId}/experiment/${experiment.id}`}><strong>{experiment.id.substring(0, 8)}...</strong></A>
                          </td>
                          <td>                          
                              {experiment.dataset.substring(0, 8)}...
                          </td>
                          <td>{overallScoreValue}</td>
                          <td>{new Date(experiment.created).toLocaleString()}</td>
                          <td>{new Date(experiment.updated).toLocaleString()}</td>
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

export default ExperimentsListPage;