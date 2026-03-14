import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Table, Badge, Button, Input, Modal, ModalHeader, ModalBody, ModalFooter, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDataset, listExperiments, getExample, updateExample } from '../api';
import Metric from '../common/types/Metric';
import type Experiment from '../common/types/Experiment';
import { useToast } from '../utils/toast';
import Page from '../components/generic/Page';
import { asArray } from '../common/utils/miscutils';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';

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
  const [scoringActive, setScoringActive] = useState(false);
  const [currentScoringIndex, setCurrentScoringIndex] = useState<number | null>(null);
  const [currentUserScore, setCurrentUserScore] = useState<number | null>(null);
  const [scoringError, setScoringError] = useState<string | null>(null);
  const [savingScore, setSavingScore] = useState(false);

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
          const key = result.example;
          if (!traces.has(key)) {
            traces.set(key, {
              traceId: '', // Will be filled from example
              exampleId: result.example,
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
      let humanScore: number | undefined;

      // Pull any existing human judgement for this metric from annotations
      if (example?.annotations && metricName) {
        const rawScore = example.annotations[metricName];
        if (rawScore !== undefined && rawScore !== null) {
          const numeric = typeof rawScore === 'number' ? rawScore : parseFloat(String(rawScore));
          if (!Number.isNaN(numeric)) {
            humanScore = numeric;
          }
        }
      }

      return {
        ...trace,
        traceId: example?.trace ?? '',
        groundTruth: humanScore ?? trace.groundTruth,
      };
    });
  }, [tracesWithMetric, examplesData, metricName]);

  const isLLMMetric = metric?.type === 'llm';
  const traceCount = tracesWithTraceIds.length;

  // For confusion matrix: analyze metric values vs human judgements in 5 buckets over [0,1]
  const confusionMatrixData = useMemo(() => {
    if (!isLLMMetric || tracesWithTraceIds.length === 0) return null;

    const bucketLabels = ['0.0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1.0'];
    const matrix: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
    const rowTotals = Array(5).fill(0);
    const colTotals = Array(5).fill(0);
    let total = 0;

    const clamp01 = (v: number) => {
      if (Number.isNaN(v)) return NaN;
      if (v < 0) return 0;
      if (v > 1) return 1;
      return v;
    };

    const toBucketIndex = (v: number) => {
      const clamped = clamp01(v);
      if (Number.isNaN(clamped)) return null;
      // Map [0,1] -> 5 buckets, inclusive of 1.0 in last bucket
      const idx = Math.floor(clamped * 5);
      return Math.min(4, Math.max(0, idx));
    };

    tracesWithTraceIds.forEach(trace => {
      const modelValRaw = typeof trace.metricValue === 'number'
        ? trace.metricValue
        : parseFloat(String(trace.metricValue));
      const humanValRaw = trace.groundTruth !== undefined
        ? (typeof trace.groundTruth === 'number' ? trace.groundTruth : parseFloat(String(trace.groundTruth)))
        : NaN;

      const modelIdx = toBucketIndex(modelValRaw);
      const humanIdx = toBucketIndex(humanValRaw);

      if (modelIdx === null || humanIdx === null) return;

      matrix[humanIdx][modelIdx] += 1;
      rowTotals[humanIdx] += 1;
      colTotals[modelIdx] += 1;
      total += 1;
    });

    if (total === 0) return null;

    return {
      type: 'buckets' as const,
      bucketLabels,
      matrix,
      rowTotals,
      colTotals,
      total,
    };
  }, [isLLMMetric, tracesWithTraceIds]);

  const tracesNeedingScore = useMemo(
    () =>
      tracesWithTraceIds.filter(
        (t) => t.traceId && (t.groundTruth === undefined || t.groundTruth === null)
      ),
    [tracesWithTraceIds]
  );

  const currentScoringTrace =
    scoringActive && currentScoringIndex !== null
      ? tracesNeedingScore[currentScoringIndex] ?? null
      : null;

  const currentScoringExample = useMemo(() => {
    if (!currentScoringTrace || !examplesData) return null;
    return examplesData.find((e: any) => e?.id === currentScoringTrace.exampleId) ?? null;
  }, [currentScoringTrace, examplesData]);

  const saveHumanScoreMutation = useMutation({
    mutationFn: async ({ exampleId, score }: { exampleId: string; score: number }) => {
      const example = examplesData?.find((e: any) => e?.id === exampleId);
      const existingAnnotations =
        example?.annotations && typeof example.annotations === 'object'
          ? example.annotations
          : {};
      const updatedAnnotations = {
        ...existingAnnotations,
        [metricName!]: score,
      };
      return updateExample(organisationId!, exampleId, { annotations: updatedAnnotations } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['examples-for-metric'] });
      showToast('Human score saved', 'success');
    },
    onError: (error: any) => {
      console.error(error);
      showToast('Failed to save human score', 'error');
    },
  });

  const startScoring = () => {
    if (tracesNeedingScore.length === 0) {
      setScoringError('No traces available that need human scores.');
      return;
    }
    setScoringActive(true);
    setCurrentScoringIndex(0);
    setCurrentUserScore(null);
    setScoringError(null);
  };

  const stopScoring = () => {
    setScoringActive(false);
    setCurrentScoringIndex(null);
    setCurrentUserScore(null);
    setScoringError(null);
  };

  const goToNextTrace = () => {
    setCurrentUserScore(null);
    setScoringError(null);
    setCurrentScoringIndex((prev) => {
      if (prev === null) return 0;
      const next = prev + 1;
      if (next >= tracesNeedingScore.length) {
        return null;
      }
      return next;
    });
  };

  const handleSaveScore = () => {
    if (!currentScoringTrace) {
      setScoringError('No active trace to score. You broke physics.');
      return;
    }
    if (currentUserScore === null) {
      setScoringError('Please select a score from 1 to 5.');
      return;
    }
    // Map 1–5 to [0,1] in 5 buckets
    const normalisedScore = (currentUserScore - 1) / 4;
    setScoringError(null);
    setSavingScore(true);
    saveHumanScoreMutation.mutate(
      { exampleId: currentScoringTrace.exampleId, score: normalisedScore },
      {
        onSuccess: () => {
          goToNextTrace();
        },
        onSettled: () => {
          setSavingScore(false);
        },
      }
    );
  };

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
                    <h6>Confusion Matrix (Model vs Human)</h6>
                    <p className="small text-muted mb-2">
                      Metric values and human judgements bucketed over [0,1] into 5 bands.
                    </p>
                    {confusionMatrixData.type === 'buckets' && (
                      <Table bordered size="sm" className="mt-2">
                        <thead>
                          <tr>
                            <th>Human ↓ / Model →</th>
                            {confusionMatrixData.bucketLabels.map((label, i) => (
                              <th key={i} className="small">{label}</th>
                            ))}
                            <th className="small">Row total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {confusionMatrixData.matrix.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                              <th className="small">{confusionMatrixData.bucketLabels[rowIdx]}</th>
                              {row.map((count, colIdx) => (
                                <td key={colIdx} className={rowIdx === colIdx ? 'table-success' : ''}>
                                  {count}
                                </td>
                              ))}
                              <td className="fw-bold">{confusionMatrixData.rowTotals[rowIdx]}</td>
                            </tr>
                          ))}
                          <tr className="table-light">
                            <th className="fw-bold">Column total</th>
                            {confusionMatrixData.colTotals.map((total, idx) => (
                              <td key={idx} className="fw-bold">
                                {total}
                              </td>
                            ))}
                            <td className="fw-bold">{confusionMatrixData.total}</td>
                          </tr>
                        </tbody>
                      </Table>
                    )}
                  </Col>
                </Row>
              )}

              {isLLMMetric && (
                <Row className="mt-4">
                  <Col>
                    <h6>Human scoring activity</h6>
                    <p className="small text-muted">
                      Step through traces for this metric, rate them yourself, and we&apos;ll log the scores
                      as annotations on the underlying examples.
                    </p>
                    {!scoringActive && (
                      <div className="d-flex align-items-center gap-2">
                        <Button
                          color="primary"
                          size="sm"
                          onClick={startScoring}
                          disabled={tracesNeedingScore.length === 0}
                        >
                          Start scoring
                        </Button>
                        <span className="text-muted small">
                          {tracesNeedingScore.length === 0
                            ? 'No traces currently need a human score.'
                            : `${tracesNeedingScore.length} trace(s) need a human score.`}
                        </span>
                      </div>
                    )}
                    {scoringActive && (
                      <Card className="mt-3">
                        <CardBody>
                          {currentScoringTrace && currentScoringExample ? (
                            <>
                              <div className="d-flex justify-content-between align-items-center mb-2">
                                <div>
                                  <div className="small text-muted">Trace</div>
                                  {currentScoringTrace.traceId ? (
                                    <Link
                                      to={`/organisation/${organisationId}/traces/${currentScoringTrace.traceId}`}
                                    >
                                      <code className="small">
                                        {currentScoringTrace.traceId.substring(0, 16)}...
                                      </code>
                                    </Link>
                                  ) : (
                                    <span className="text-muted small">Unknown trace</span>
                                  )}
                                </div>
                                <div>
                                  <div className="small text-muted">Metric score</div>
                                  <span className="fw-bold">{currentScoringTrace.metricValue}</span>
                                </div>
                                <div>
                                  <div className="small text-muted">Example</div>
                                  <Link
                                    to={`/organisation/${organisationId}/example/${currentScoringTrace.exampleId}`}
                                  >
                                    <code className="small">
                                      {currentScoringTrace.exampleId.substring(0, 16)}...
                                    </code>
                                  </Link>
                                </div>
                              </div>

                              <Row className="mt-3">
                                <Col md={6}>
                                  <h6 className="small text-uppercase text-muted">Input</h6>
                                  <div className="border rounded p-2" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                                    <TextWithStructureViewer
                                      text={
                                        typeof currentScoringExample.input === 'string'
                                          ? currentScoringExample.input
                                          : JSON.stringify(currentScoringExample.input ?? {}, null, 2)
                                      }
                                    />
                                  </div>
                                </Col>
                                <Col md={6} className="mt-3 mt-md-0">
                                  <h6 className="small text-uppercase text-muted">Output</h6>
                                  <div className="border rounded p-2" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                                    <TextWithStructureViewer
                                      text={
                                        typeof currentScoringExample.outputs?.good === 'string'
                                          ? currentScoringExample.outputs.good
                                          : JSON.stringify(currentScoringExample.outputs ?? {}, null, 2)
                                      }
                                    />
                                  </div>
                                </Col>
                              </Row>

                              <Row className="mt-3">
                                <Col>
                                  <div className="mb-2">
                                    <span className="fw-bold me-2">Your score</span>
                                    <span className="small text-muted">
                                      1 = very poor, 5 = excellent. Saved as a normalised score in [0,1].
                                    </span>
                                  </div>
                                  <div className="d-flex flex-wrap gap-2 mb-2">
                                    {[1, 2, 3, 4, 5].map((score) => (
                                      <Button
                                        key={score}
                                        color={currentUserScore === score ? 'primary' : 'secondary'}
                                        outline={currentUserScore !== score}
                                        size="sm"
                                        onClick={() => setCurrentUserScore(score)}
                                      >
                                        {score}
                                      </Button>
                                    ))}
                                  </div>
                                  {scoringError && (
                                    <div className="text-danger small mb-2">{scoringError}</div>
                                  )}
                                  <div className="d-flex gap-2">
                                    <Button
                                      color="primary"
                                      size="sm"
                                      onClick={handleSaveScore}
                                      disabled={savingScore}
                                    >
                                      {savingScore ? 'Saving...' : 'Save score'}
                                    </Button>
                                    <Button
                                      color="secondary"
                                      size="sm"
                                      onClick={goToNextTrace}
                                      disabled={tracesNeedingScore.length === 0}
                                    >
                                      Skip
                                    </Button>
                                    <Button
                                      color="link"
                                      size="sm"
                                      onClick={stopScoring}
                                    >
                                      Stop
                                    </Button>
                                  </div>
                                </Col>
                              </Row>
                            </>
                          ) : (
                            <div>
                              <p className="mb-2">
                                No more traces need a human score. Either you&apos;re done, or the models unionised.
                              </p>
                              <Button color="secondary" size="sm" onClick={stopScoring}>
                                Close activity
                              </Button>
                            </div>
                          )}
                        </CardBody>
                      </Card>
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

