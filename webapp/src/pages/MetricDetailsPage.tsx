import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Table, Badge, Button, Input, Modal, ModalHeader, ModalBody, ModalFooter, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDataset, listExperiments, getExample } from '../api';
import { Metric } from '../common/types/Metric';
import type Experiment from '../common/types/Experiment';
import { useToast } from '../utils/toast';
import Page from '../components/generic/Page';
import { asArray } from '../common/utils/miscutils';

interface TraceWithMetric {
  traceId: string;
  exampleId: string;
  metricValue: number | string;
  experimentId: string;
  experimentName?: string;
  groundTruth?: number | string;
}

const MetricDetailsPage: React.FC = () => {
  const { organisationId, metricName } = useParams<{ organisationId: string; metricName: string }>();
  const [searchParams] = useSearchParams();
  const datasetId = searchParams.get('datasetId');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [groundTruthModalOpen, setGroundTruthModalOpen] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<TraceWithMetric | null>(null);
  const [groundTruthValue, setGroundTruthValue] = useState<string>('');

  const { data: dataset, isLoading: datasetLoading } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  const { data: experiments, isLoading: experimentsLoading } = useQuery({
    queryKey: ['experiments', organisationId, datasetId],
    queryFn: () => listExperiments(organisationId!),
    enabled: !!organisationId,
    select: (data) => {
      // Filter by dataset if provided
      if (datasetId) {
        return data.filter((exp: Experiment) => exp.dataset === datasetId);
      }
      return data;
    },
  });

  // Find the metric definition
  const metric: Metric | undefined = useMemo(() => {
    if (!dataset?.metrics) return undefined;
    return (asArray(dataset.metrics) as Metric[]).find(m => m.name === metricName);
  }, [dataset, metricName]);

  // Collect all traces with this metric
  const tracesWithMetric: TraceWithMetric[] = useMemo(() => {
    if (!experiments || !metricName) return [];
    
    const traces: Map<string, TraceWithMetric> = new Map();
    
    experiments.forEach((experiment: Experiment) => {
      if (!experiment.results) return;
      
      experiment.results.forEach(result => {
        const metricValue = result.scores?.[metricName];
        if (metricValue !== undefined && metricValue !== null) {
          const key = result.exampleId;
          if (!traces.has(key)) {
            traces.set(key, {
              traceId: '', // Will be filled from example
              exampleId: result.exampleId,
              metricValue,
              experimentId: experiment.id,
              experimentName: experiment.name,
            });
          }
        }
      });
    });
    
    return Array.from(traces.values());
  }, [experiments, metricName]);

  // Get trace IDs from examples
  const { data: examplesData } = useQuery({
    queryKey: ['examples-for-metric', tracesWithMetric.map(t => t.exampleId)],
    queryFn: async () => {
      const examples = await Promise.all(
        tracesWithMetric.map(trace => 
          getExample(organisationId!, trace.exampleId).catch(() => null)
        )
      );
      return examples.filter(e => e !== null);
    },
    enabled: tracesWithMetric.length > 0,
  });

  // Update traces with trace IDs
  const tracesWithTraceIds = useMemo(() => {
    if (!examplesData) return tracesWithMetric;
    
    return tracesWithMetric.map(trace => {
      const example = examplesData.find((e: any) => e?.id === trace.exampleId);
      return {
        ...trace,
        traceId: example?.traceId || '',
      };
    });
  }, [tracesWithMetric, examplesData]);

  const isLLMMetric = metric?.type === 'llm';
  const traceCount = tracesWithTraceIds.length;

  // For confusion matrix: analyze metric values
  const confusionMatrixData = useMemo(() => {
    if (!isLLMMetric || tracesWithTraceIds.length === 0) return null;
    
    const values = tracesWithTraceIds.map(t => {
      const val = typeof t.metricValue === 'number' ? t.metricValue : parseFloat(String(t.metricValue));
      return isNaN(val) ? null : val;
    }).filter((v): v is number => v !== null);
    
    if (values.length === 0) return null;
    
    // Check if values can be treated as binary (only 2 distinct values)
    const uniqueValues = new Set(values);
    const isBinary = uniqueValues.size === 2;
    
    if (isBinary) {
      const [val1, val2] = Array.from(uniqueValues).sort((a, b) => a - b);
      const groundTruths = tracesWithTraceIds
        .filter(t => t.groundTruth !== undefined)
        .map(t => {
          const gt = typeof t.groundTruth === 'number' ? t.groundTruth : parseFloat(String(t.groundTruth));
          return isNaN(gt) ? null : gt;
        })
        .filter((v): v is number => v !== null);
      
      if (groundTruths.length === 0) return null;
      
      const uniqueGT = new Set(groundTruths);
      if (uniqueGT.size !== 2) return null;
      
      const [gt1, gt2] = Array.from(uniqueGT).sort((a, b) => a - b);
      
      // Build confusion matrix
      let tp = 0, fp = 0, fn = 0, tn = 0;
      
      tracesWithTraceIds.forEach(trace => {
        const val = typeof trace.metricValue === 'number' ? trace.metricValue : parseFloat(String(trace.metricValue));
        const gt = trace.groundTruth !== undefined 
          ? (typeof trace.groundTruth === 'number' ? trace.groundTruth : parseFloat(String(trace.groundTruth)))
          : null;
        
        if (isNaN(val) || gt === null || isNaN(gt)) return;
        
        const predictedHigh = val === val2;
        const actualHigh = gt === gt2;
        
        if (predictedHigh && actualHigh) tp++;
        else if (predictedHigh && !actualHigh) fp++;
        else if (!predictedHigh && actualHigh) fn++;
        else tn++;
      });
      
      return { type: 'binary', tp, fp, fn, tn, val1, val2, gt1, gt2 };
    } else {
      // Use 5 bands
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min;
      const bandSize = range / 5;
      
      const bands = Array.from({ length: 5 }, (_, i) => ({
        min: min + i * bandSize,
        max: min + (i + 1) * bandSize,
        label: `${(min + i * bandSize).toFixed(1)}-${(min + (i + 1) * bandSize).toFixed(1)}`,
      }));
      
      // Count ground truths
      const groundTruths = tracesWithTraceIds
        .filter(t => t.groundTruth !== undefined)
        .map(t => {
          const gt = typeof t.groundTruth === 'number' ? t.groundTruth : parseFloat(String(t.groundTruth));
          return isNaN(gt) ? null : gt;
        })
        .filter((v): v is number => v !== null);
      
      if (groundTruths.length === 0) return { type: 'bands', bands, matrix: null };
      
      // Build confusion matrix for bands
      const matrix: number[][] = Array(5).fill(null).map(() => Array(5).fill(0));
      
      tracesWithTraceIds.forEach(trace => {
        const val = typeof trace.metricValue === 'number' ? trace.metricValue : parseFloat(String(trace.metricValue));
        const gt = trace.groundTruth !== undefined 
          ? (typeof trace.groundTruth === 'number' ? trace.groundTruth : parseFloat(String(trace.groundTruth)))
          : null;
        
        if (isNaN(val) || gt === null || isNaN(gt)) return;
        
        const predictedBand = Math.min(4, Math.floor((val - min) / bandSize));
        const actualBand = Math.min(4, Math.floor((gt - min) / bandSize));
        
        matrix[actualBand][predictedBand]++;
      });
      
      return { type: 'bands', bands, matrix };
    }
  }, [isLLMMetric, tracesWithTraceIds]);

  const handleConfirm = (trace: TraceWithMetric) => {
    setSelectedTrace(trace);
    setGroundTruthValue(String(trace.metricValue));
    setConfirmModalOpen(true);
  };

  const handleEnterGroundTruth = (trace: TraceWithMetric) => {
    setSelectedTrace(trace);
    setGroundTruthValue('');
    setGroundTruthModalOpen(true);
  };

  const saveGroundTruth = () => {
    if (!selectedTrace) return;
    
    // TODO: Implement API call to save ground truth
    // For now, just show a toast
    showToast('Ground truth saved (API integration pending)', 'success');
    setGroundTruthModalOpen(false);
    setConfirmModalOpen(false);
    setSelectedTrace(null);
    setGroundTruthValue('');
  };

  if (datasetLoading || experimentsLoading) {
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

  if (!metric) {
    return (
      <Container>
        <Alert color="danger">
          <h4>Metric Not Found</h4>
          <p>Metric "{metricName}" not found in dataset.</p>
          <Link to={`/organisation/${organisationId}/metrics`} className="btn btn-primary">
            Back to Metrics
          </Link>
        </Alert>
      </Container>
    );
  }

  return (
    <Page
      header={`Metric: ${metric.name}`}
      back={`/organisation/${organisationId}/metrics`}
      backLabel="Metrics"
    >
      {metric.description && (
        <Row className="mt-2">
          <Col>
            <p className="text-muted">{metric.description}</p>
          </Col>
        </Row>
      )}

      {/* Metric Details */}
      <Row className="mt-3">
        <Col>
          <Card>
            <CardHeader>
              <h5>Metric Details</h5>
            </CardHeader>
            <CardBody>
              <dl className="row mb-0">
                <dt className="col-sm-3">Name:</dt>
                <dd className="col-sm-9">{metric.name}</dd>
                {metric.description && (
                  <>
                    <dt className="col-sm-3">Description:</dt>
                    <dd className="col-sm-9">{metric.description}</dd>
                  </>
                )}
                <dt className="col-sm-3">Type:</dt>
                <dd className="col-sm-9"><Badge color="info">{metric.type}</Badge></dd>
                {metric.unit && (
                  <>
                    <dt className="col-sm-3">Unit:</dt>
                    <dd className="col-sm-9">{metric.unit}</dd>
                  </>
                )}
                {metric.parameters && Object.keys(metric.parameters).length > 0 && (
                  <>
                    <dt className="col-sm-3">Parameters:</dt>
                    <dd className="col-sm-9">
                      <pre className="small bg-light p-2 mb-0">
                        {JSON.stringify(metric.parameters, null, 2)}
                      </pre>
                    </dd>
                  </>
                )}
              </dl>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Dashboard */}
      <Row className="mt-3">
        <Col>
          <Card>
            <CardHeader>
              <h5>Dashboard</h5>
            </CardHeader>
            <CardBody>
              <Row>
                <Col md={4}>
                  <div className="text-center">
                    <h3>{traceCount}</h3>
                    <p className="text-muted mb-0">Traces with Metric</p>
                  </div>
                </Col>
              </Row>

              {isLLMMetric && confusionMatrixData && (
                <Row className="mt-4">
                  <Col>
                    <h6>Confusion Matrix</h6>
                    {confusionMatrixData.type === 'binary' ? (
                      <Table bordered size="sm" className="mt-2">
                        <thead>
                          <tr>
                            <th></th>
                            <th>Predicted: {confusionMatrixData.val1}</th>
                            <th>Predicted: {confusionMatrixData.val2}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <th>Actual: {confusionMatrixData.gt1}</th>
                            <td>{confusionMatrixData.tn}</td>
                            <td>{confusionMatrixData.fp}</td>
                          </tr>
                          <tr>
                            <th>Actual: {confusionMatrixData.gt2}</th>
                            <td>{confusionMatrixData.fn}</td>
                            <td>{confusionMatrixData.tp}</td>
                          </tr>
                        </tbody>
                      </Table>
                    ) : (
                      <div className="mt-2">
                        <p className="small text-muted">Using 5 bands for numerical scores</p>
                        {confusionMatrixData.matrix && (
                          <Table bordered size="sm">
                            <thead>
                              <tr>
                                <th></th>
                                {confusionMatrixData.bands.map((band, i) => (
                                  <th key={i} className="small">{band.label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {confusionMatrixData.matrix.map((row, i) => (
                                <tr key={i}>
                                  <th className="small">{confusionMatrixData.bands[i].label}</th>
                                  {row.map((count, j) => (
                                    <td key={j} className={i === j ? 'table-success' : ''}>
                                      {count}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        )}
                      </div>
                    )}
                  </Col>
                </Row>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Traces List */}
      <Row className="mt-3">
        <Col>
          <Card>
            <CardHeader>
              <h5>Traces with Metric Output</h5>
            </CardHeader>
            <CardBody>
              {tracesWithTraceIds.length === 0 ? (
                <p className="text-muted">No traces found with this metric.</p>
              ) : (
                <Table hover>
                  <thead>
                    <tr>
                      <th>Trace ID</th>
                      <th>Example ID</th>
                      <th>Experiment</th>
                      <th>Metric Value</th>
                      {isLLMMetric && <th>Ground Truth</th>}
                      {isLLMMetric && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {tracesWithTraceIds.map((trace, idx) => (
                      <tr key={idx}>
                        <td>
                          {trace.traceId ? (
                            <Link to={`/organisation/${organisationId}/traces/${trace.traceId}`}>
                              <code className="small">{trace.traceId.substring(0, 16)}...</code>
                            </Link>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          <Link to={`/organisation/${organisationId}/example/${trace.exampleId}`}>
                            <code className="small">{trace.exampleId.substring(0, 16)}...</code>
                          </Link>
                        </td>
                        <td>
                          <Link to={`/organisation/${organisationId}/experiment/${trace.experimentId}`}>
                            {trace.experimentName || trace.experimentId.substring(0, 16)}...
                          </Link>
                        </td>
                        <td>{trace.metricValue}</td>
                        {isLLMMetric && (
                          <>
                            <td>{trace.groundTruth !== undefined ? trace.groundTruth : <span className="text-muted">-</span>}</td>
                            <td>
                              <div className="d-flex gap-1">
                                <Button
                                  color="success"
                                  size="sm"
                                  onClick={() => handleConfirm(trace)}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  color="primary"
                                  size="sm"
                                  onClick={() => handleEnterGroundTruth(trace)}
                                >
                                  Enter GT
                                </Button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Confirm Modal */}
      <Modal isOpen={confirmModalOpen} toggle={() => setConfirmModalOpen(false)}>
        <ModalHeader toggle={() => setConfirmModalOpen(false)}>
          Confirm Ground Truth
        </ModalHeader>
        <ModalBody>
          <p>Confirm that the metric value <strong>{selectedTrace?.metricValue}</strong> is the ground truth?</p>
        </ModalBody>
        <ModalFooter>
          <Button color="primary" onClick={saveGroundTruth}>
            Confirm
          </Button>
          <Button color="secondary" onClick={() => setConfirmModalOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      {/* Enter Ground Truth Modal */}
      <Modal isOpen={groundTruthModalOpen} toggle={() => setGroundTruthModalOpen(false)}>
        <ModalHeader toggle={() => setGroundTruthModalOpen(false)}>
          Enter Ground Truth
        </ModalHeader>
        <ModalBody>
          <p>Metric value: <strong>{selectedTrace?.metricValue}</strong></p>
          <label>
            Ground Truth Value:
            <Input
              type="text"
              value={groundTruthValue}
              onChange={(e) => setGroundTruthValue(e.target.value)}
              placeholder="Enter ground truth value"
              className="mt-2"
            />
          </label>
        </ModalBody>
        <ModalFooter>
          <Button color="primary" onClick={saveGroundTruth}>
            Save
          </Button>
          <Button color="secondary" onClick={() => setGroundTruthModalOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </Page>
  );
};

export default MetricDetailsPage;

