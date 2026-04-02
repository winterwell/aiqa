import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Row, Col, Card, CardBody, CardHeader, Badge, Button, Input } from 'reactstrap';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getExample, updateExample, getDataset, deleteExample, listExperiments, getExperiment } from '../api';
import { useToast } from '../utils/toast';
import type { Example, Span } from '../common/types';
import type Dataset from '../common/types/Dataset';
import Metric from '../common/types/Metric';
import type Experiment from '../common/types/Experiment';
import type { Result as ExperimentResult } from '../common/types/Experiment';
import JsonObjectViewer from '../components/generic/JsonObjectViewer';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import Tags from '../components/generic/Tags';
import MetricModal, { addOrEditMetric, deleteMetric } from '../components/MetricModal';
import Page from '../components/generic/Page';
import { getStartTime, formatMetricValue, getSpanMetricValue } from '../utils/span-utils';
import { DEFAULT_SYSTEM_METRICS, SPECIFIC_METRIC, SPECIFIC_METRIC_ID } from '../common/defaultSystemMetrics';
import { getMetrics } from '../utils/metric-utils';
import { searchSpans } from '../api';
import { asArray } from '../common/utils/miscutils';
import { getExampleInput, getFirstSpan, getExampleTraceId } from '../utils/example-utils';
import MultiTurnExampleInputEditor from '../components/MultiTurnExampleInputEditor';
import {
  isMultiTurnTaggedInputString,
  parseMultiTurnTaggedInput,
  serializeMultiTurnTaggedInput,
  type MultiTurnTurn,
} from '../utils/multiTurnExampleInput';

function MultiTurnInputView({ text }: { text: string }) {
  const turns = parseMultiTurnTaggedInput(text);
  if (!turns) return <TextWithStructureViewer text={text} />;
  return (
    <div>
      {turns.map((turn, i) => (
        <div key={i} className="mb-2">
          <div className="small text-muted mb-1">{turn.role === 'user' ? 'User' : 'Assistant'}</div>
          <div className="border rounded p-2 bg-light small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {turn.content}
          </div>
        </div>
      ))}
    </div>
  );
}

// InputCard component
function InputCard({ 
  example, 
  onUpdateInput 
}: { 
  example: Example; 
  onUpdateInput: (input: any) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  /** When set, input is edited as multi-turn tagged segments; otherwise single textarea (`editValue`). */
  const [multiTurnDraft, setMultiTurnDraft] = useState<MultiTurnTurn[] | null>(null);
  const inputThing = getExampleInput(example);
  const usesInput = example.input !== undefined && example.input !== null;
  const stringIsMultiTurn =
    typeof inputThing === 'string' && isMultiTurnTaggedInputString(inputThing);

  const handleEdit = () => {
    if (typeof inputThing === 'string') {
      const parsed = parseMultiTurnTaggedInput(inputThing);
      if (parsed) {
        setMultiTurnDraft(parsed);
        setEditValue('');
      } else {
        setMultiTurnDraft(null);
        setEditValue(inputThing);
      }
    } else {
      setMultiTurnDraft(null);
      setEditValue(JSON.stringify(inputThing, null, 2));
    }
    setIsEditing(true);
  };

  const handleSave = () => {
    try {
      if (multiTurnDraft) {
        onUpdateInput(serializeMultiTurnTaggedInput(multiTurnDraft));
      } else {
        let parsedValue: any;
        try {
          parsedValue = JSON.parse(editValue);
        } catch {
          parsedValue = editValue;
        }
        onUpdateInput(parsedValue);
      }
      setIsEditing(false);
      setMultiTurnDraft(null);
      setEditValue('');
    } catch (error) {
      console.error('Error saving input:', error);
      setIsEditing(false);
      setMultiTurnDraft(null);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
    setMultiTurnDraft(null);
  };

  const switchMultiToRawText = () => {
    if (!multiTurnDraft) return;
    setEditValue(serializeMultiTurnTaggedInput(multiTurnDraft));
    setMultiTurnDraft(null);
  };

  return (
    <Card className="mb-3">
      <CardHeader className="d-flex justify-content-between align-items-center">
        <h5 className="mb-0">
          Input
          {stringIsMultiTurn && !isEditing && (
            <span className="ms-2 small text-muted fw-normal">(multi-turn)</span>
          )}
        </h5>
        {usesInput && !isEditing && (
          <Button color="primary" size="sm" onClick={handleEdit}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {isEditing ? (
          <div>
            {multiTurnDraft ? (
              <>
                <MultiTurnExampleInputEditor turns={multiTurnDraft} onChange={setMultiTurnDraft} />
                <Button color="link" size="sm" className="ps-0 mb-2" onClick={switchMultiToRawText}>
                  Edit as raw text
                </Button>
              </>
            ) : (
              <Input
                type="textarea"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={10}
                style={{ fontFamily: 'monospace' }}
              />
            )}
            <div className="mt-2 d-flex gap-2">
              <Button color="success" size="sm" onClick={handleSave}>
                Save
              </Button>
              <Button color="secondary" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {typeof inputThing === 'string' ? (
              <MultiTurnInputView text={inputThing} />
            ) : (
              <JsonObjectViewer json={inputThing} textComponent={TextWithStructureViewer} />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// MetricCardItem component - reusable card for displaying a single metric
function MetricCardItem({
  metric,
  example,
  onEdit,
  onDelete,
}: {
  metric: Metric;
  /** If set, this is an example-specific metric on an example */
  example?: Example;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  return (
    <Card className="mb-2">
      <CardBody>
        <div className="d-flex justify-content-between align-items-start mb-2">
          <h6 className="mb-0">{metric.name || metric.id}</h6>
          <div className="d-flex gap-1">
            <Button color="primary" size="sm" onClick={onEdit}>
              Edit
            </Button>
            {onDelete && <Button color="danger" size="sm" onClick={onDelete}>
              ×
            </Button>}
          </div>
        </div>
        {metric.description && (
          <p className="text-muted small mb-1">{metric.description}</p>
        )}
        <div className="d-flex gap-2 flex-wrap mb-2">
          <Badge color="info">{metric.type}</Badge>
          {metric.unit && <Badge color="secondary">{metric.unit}</Badge>}
        </div>
        {metric.type === 'llm' && (metric.prompt || metric.promptCriteria) && (
          <div className="mt-2">
            <strong className="small d-block mb-1">Prompt:</strong>
            <pre className="small bg-light p-2 mb-0" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {metric.prompt || metric.promptCriteria}
            </pre>
          </div>
        )}
        {metric.type === 'javascript' && metric.code && (
          <div className="mt-2">
            <strong className="small d-block mb-1">Code:</strong>
            <pre className="small bg-light p-2 mb-0" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {metric.code}
            </pre>
          </div>
        )}
        {metric.parameters && Object.keys(metric.parameters).length > 0 && (
          <details className="mt-2">
            <summary className="small text-muted" style={{ cursor: 'pointer' }}>
              Parameters
            </summary>
            <pre className="small bg-light p-2 mt-1 mb-0">
              {JSON.stringify(metric.parameters, null, 2)}
            </pre>
          </details>
        )}
      </CardBody>
    </Card>
  );
} // end: MetricCardItem

// MetricsCard component
function MetricsCard({
  example,
  datasetMetrics,
  // onAddMetric,
  onEditMetric,
  // onDeleteMetric,
}: {
  example: Example;
  datasetMetrics: Metric[] | null | undefined;
  // onAddMetric: () => void;
  onEditMetric: (index: number, metric: Partial<Metric>, example?: Example) => void;
  // onDeleteMetric: (index: number) => void;
}) {
  // Combine system metrics with dataset metrics
  const allDatasetMetrics = useMemo(() => {
    const metricMap = new Map<string, Metric>();
    // Add system metrics first
    DEFAULT_SYSTEM_METRICS.forEach(metric => {
      metricMap.set(metric.id || metric.name || '', metric);
    });
    // Add dataset metrics (they override system metrics if same id/name)
    // Ensure datasetMetrics is always an array - defensive check
    const safeDatasetMetrics: Metric[] = Array.isArray(datasetMetrics) ? datasetMetrics : [];
    safeDatasetMetrics.forEach(metric => {
      metricMap.set(metric.id || metric.name || '', metric);
    });
    return Array.from(metricMap.values());
  }, [datasetMetrics]);

  // specific metrics - Keep the Example ones, copy in blanks from allDatasetMetrics
  const specificMetrics = useMemo(() => {
    const metricsArray = example.metrics ? asArray(example.metrics) as Metric[] : [];
    // copy in non-duplicate dataset metrics
    allDatasetMetrics.forEach(metric => {
      if (metric.id === 'specific' || metric.specific) {
        if (!metricsArray.find(m => m.id === metric.id)) {
          metricsArray.push({...metric});
        }
      }
    });
    return metricsArray.filter(m => m.id === 'specific' || m.specific) || [];
  }, [example.metrics, allDatasetMetrics]);

  const datasetMetricsText = allDatasetMetrics.filter(m => !m.specific).map(m => m.name || m.id || 'Unknown').join(', ');

  return (
    <Card>
      <CardHeader className="d-flex justify-content-between align-items-center">
        <h5>Metrics</h5>
        {/* <Button color="primary" size="sm" onClick={onAddMetric}>
          + Add Metric
        </Button> */}
      </CardHeader>
      <CardBody>
        {allDatasetMetrics.length > 0 && (
          <div className="mb-3">
            <strong>General metrics:</strong> <span className="text-muted">{datasetMetricsText}</span>
          </div>
        )}
          <strong className="mb-2 d-block">Example specific criteria:</strong>
        {specificMetrics.map(specificMetric => (
          <div className="mb-2">
            <MetricCardItem
              metric={specificMetric}
              onEdit={() => {
                onEditMetric(allDatasetMetrics.findIndex(m => m.id === specificMetric.id), {
                  ...specificMetric,
                  name: specificMetric.name || 'Example Specific',
                }, example);
              }}
              // onDelete={() => onDeleteMetric(specificMetricIndex)}
            />
          </div>)
        )}
      </CardBody>
    </Card>
  );
}

/** Outputs: load the last 5 spans with span.example = example.id. Show a card per span, 
 * with span time, span.attributes.output, and all dataset metrics (system + custom). 
 * System metrics come from span.stats; custom metrics show "—" (computed during experiments).
 * */
function OutputsCard({ example, dataset }: { example: Example; dataset: Dataset | null | undefined }) {
  const { organisationId } = useParams<{ organisationId: string }>();
  
  const { data: spansResult, isLoading } = useQuery({
    queryKey: ['example-outputs', example.id, organisationId],
    queryFn: async () => {
      if (!organisationId || !example.id) return { hits: [] };
      return await searchSpans({
        organisationId,
        query: `attributes.aiqa.example:${example.id}`,
        limit: 5,
        offset: 0,
        fields: '*',
      });
    },
    enabled: !!organisationId && !!example.id,
  });

  const spans = spansResult?.hits || [];

  const { data: recentExperimentsWithResults } = useQuery({
    queryKey: ['example-recent-experiments', organisationId, example.dataset],
    queryFn: async () => {
      if (!organisationId || !example.dataset) return [] as Experiment[];
      // Query language is "Gmail-style"; dataset:<id> is supported elsewhere in the app.
      const list = await listExperiments(organisationId, `dataset:${example.dataset}`);
      const experiments = Array.isArray(list) ? (list as Experiment[]) : [];
      const sorted = [...experiments].sort((a, b) => {
        const ta = new Date((a as any).created).getTime() || 0;
        const tb = new Date((b as any).created).getTime() || 0;
        return tb - ta;
      });
      // Keep this small to avoid N+1 pain; we only need "most recent experiments".
      const top = sorted.slice(0, 5);
      const full = await Promise.all(
        top.map(async (e) => {
          try {
            return await getExperiment(e.id);
          } catch (err) {
            console.warn('Failed to load experiment details', e?.id, err);
            return null;
          }
        })
      );
      return full.filter(Boolean) as Experiment[];
    },
    enabled: !!organisationId && !!example?.dataset,
    staleTime: 30_000,
  });

  const findMostRecentExperimentResultForTrace = (traceId: string | undefined | null) => {
    const exps = Array.isArray(recentExperimentsWithResults) ? recentExperimentsWithResults : [];
    for (const exp of exps) {
      const results = Array.isArray(exp.results) ? exp.results : [];
      const r = traceId ? results.find((x) => x?.trace === traceId) : undefined;
      if (r) return { experiment: exp, result: r };
    }
    // Fallback: if results don't have trace IDs, still show the most recent score for this example.
    for (const exp of exps) {
      const results = Array.isArray(exp.results) ? exp.results : [];
      const r = results.find((x) => x?.example === example.id);
      if (r) return { experiment: exp, result: r };
    }
    return null;
  };

  // All dataset metrics (system + custom), excluding example-specific which is not per-span.
  // When no dataset, fall back to system metrics so we still show duration, tokens, cost, spans.
  const datasetMetrics = useMemo(() => {
    const all = dataset ? getMetrics(dataset) : DEFAULT_SYSTEM_METRICS;
    return all.filter((m) => (m.id || m.name) !== SPECIFIC_METRIC_ID);
  }, [dataset]);

  // Metrics that are scored by experiments (custom + specific). We display these with optional messages.
  const experimentScoredMetrics = useMemo(() => {
    const all = dataset ? getMetrics(dataset) : [];
    const nonSystem = all.filter((m) => m.type !== 'system');
    const hasSpecific = nonSystem.some((m) => (m.id || m.name) === SPECIFIC_METRIC_ID);
    return hasSpecific ? nonSystem : [...nonSystem, SPECIFIC_METRIC];
  }, [dataset]);

  const formatExperimentScore = (metric: Metric, value: number | null | undefined) => {
    if (value === null || value === undefined) return '—';
    const id = metric.id || metric.name;
    if (id === SPECIFIC_METRIC_ID) {
      // Historically rendered as percentage elsewhere in the app.
      return (100 * value).toFixed(1) + '%';
    }
    return formatMetricValue(metric, value);
  };

  // Sort by start time (most recent first) and take last 5
  const sortedSpans = [...spans]
    .sort((a, b) => {
      const timeA = getStartTime(a)?.getTime() || 0;
      const timeB = getStartTime(b)?.getTime() || 0;
      return timeB - timeA; // Most recent first
    })
    .slice(0, 5);

  return (
    <Card className="mb-3">
      <CardHeader>
        <h5>Outputs</h5>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="text-center">
            <div className="spinner-border spinner-border-sm" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : sortedSpans.length === 0 ? (
          <p className="text-muted">No output spans found for this example.</p>
        ) : (
          <div>
            {sortedSpans.map((span, index) => {
              const spanAny = span as any;
              const output = spanAny.attributes?.output;
              const startTime = getStartTime(span);
              const expMatch = findMostRecentExperimentResultForTrace(span.trace);

              return (
                <Card key={index} className="mb-3">
                  <CardBody>
                    <div className="mb-2 d-flex justify-content-between align-items-center">
                      <small>Trace: <Link to={`/organisation/${organisationId}/traces/${span.trace}`}>{span.trace}</Link></small>
                      <small className="text-muted">
                        <strong>Time:</strong> {startTime ? startTime.toLocaleString() : 'N/A'}
                      </small>
                    </div>
                    {output !== undefined && output !== null && (
                      <div className="mb-2">
                        {typeof output === 'string' ? (
                          <TextWithStructureViewer text={output} />
                        ) : (
                          <JsonObjectViewer json={output} textComponent={TextWithStructureViewer} />
                        )}
                      </div>
                    )}
                    <div className="d-flex gap-3 flex-wrap">
                      {datasetMetrics.map((metric) => {
                        const value = getSpanMetricValue(span, metric);
                        const display = formatMetricValue(metric, value);
                        return (
                          <Badge
                            key={metric.id || metric.name || 'unknown'}
                            color={value != null ? 'info' : 'secondary'}
                            className="text-nowrap"
                          >
                            {metric.name || metric.id}: {display}
                          </Badge>
                        );
                      })}
                    </div>

                    {experimentScoredMetrics.length > 0 && (
                      <div className="mt-3">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <small className="text-muted">
                            <strong>Experiment scores</strong>
                          </small>
                          {expMatch ? (
                            <small className="text-muted text-nowrap" title={expMatch.experiment.id}>
                              {expMatch.experiment.name ? `${expMatch.experiment.name} • ` : ''}
                              {expMatch.experiment.created ? new Date((expMatch.experiment as any).created).toLocaleString() : ''}
                            </small>
                          ) : (
                            <small className="text-muted">No matching experiment result for this trace.</small>
                          )}
                        </div>
                        <div className="d-flex gap-2 flex-wrap">
                          {experimentScoredMetrics.map((metric) => {
                            const id = metric.id || metric.name || 'unknown';
                            const score = expMatch?.result?.scores?.[id];
                            const message = expMatch?.result?.messages?.[id];
                            const display = formatExperimentScore(metric, score);
                            return (
                              <Badge
                                key={id}
                                color={score != null ? 'primary' : 'secondary'}
                                className="text-nowrap"
                                title={message || undefined}
                              >
                                {metric.name || metric.id}: {display}
                                {message ? ' ⓘ' : ''}
                              </Badge>
                            );
                          })}
                        </div>
                        {expMatch && (
                          <div className="mt-2">
                            {experimentScoredMetrics
                              .map((m) => m.id || m.name)
                              .filter(Boolean)
                              .map((id) => {
                                const message = id ? expMatch.result.messages?.[id] : undefined;
                                if (!message) return null;
                                return (
                                  <div key={id} className="small text-muted mb-1">
                                    <strong>{id}:</strong> {message}
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
An Example + editing tools
 */
const ExampleDetailsPage: React.FC = () => {
  const { organisationId, exampleId } = useParams<{ organisationId: string; exampleId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [isMetricModalOpen, setIsMetricModalOpen] = useState(false);
  const [editingMetricIndex, setEditingMetricIndex] = useState<number | null>(null);
  const [editingMetric, setEditingMetric] = useState<Partial<Metric> | undefined>(undefined);
 
  const { data: example, isLoading, error } = useQuery({
    queryKey: ['example', exampleId],
    queryFn: () => getExample(organisationId!, exampleId!),
    enabled: !!exampleId && !!organisationId,
  });

  const { data: dataset } = useQuery({
    queryKey: ['dataset', example?.dataset],
    queryFn: () => getDataset(example!.dataset),
    enabled: !!example?.dataset,
  });

  const updateExampleMutation = useMutation({
    mutationFn: (updates: Partial<Example>) =>
      updateExample(organisationId!, exampleId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['example', exampleId] });
    },
  });

  const deleteExampleMutation = useMutation({
    mutationFn: () => deleteExample(organisationId!, exampleId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-data'] });
      queryClient.invalidateQueries({ queryKey: ['dataset-examples', organisationId, example?.dataset] });
      showToast('Example deleted successfully', 'success');
      // Navigate back to dataset page
      if (example?.dataset) {
        navigate(`/organisation/${organisationId}/dataset/${example.dataset}`);
      } else {
        navigate(`/organisation/${organisationId}/dataset`);
      }
    },
    onError: (error: Error) => {
      showToast(`Failed to delete example: ${error.message}`, 'error');
      throw error; // Re-throw so Page component can handle it
    },
  });

  const handleSaveMetric = (metric: Partial<Metric>) => {
    // Ensure the metric has id "specific" if we're editing the specific metric
    if (editingMetricIndex !== null && example?.metrics) {
      const metricsArray = asArray(example.metrics) as Metric[];
      const existingMetric = metricsArray[editingMetricIndex];
      if (existingMetric?.id === 'specific') {
        metric.id = 'specific';
      }
    }
    const metricsArray = asArray(example?.metrics) as Metric[];
    const updatedMetrics = addOrEditMetric(metric, metricsArray);
    updateExampleMutation.mutate({ metrics: updatedMetrics });
    setIsMetricModalOpen(false);
    setEditingMetricIndex(null);
    setEditingMetric(undefined);
  };

  if (isLoading) {
    return (
      <Page header="Example Details">
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </Page>
    );
  }

  if (error || !example) {
    return (
      <Page header="Example Details">
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load example: {error instanceof Error ? error.message : 'Unknown error'}</p>
          {organisationId && (
            <Link to={`/organisation/${organisationId}/dataset`} className="btn btn-primary">
              Back to Datasets
            </Link>
          )}
        </div>
      </Page>
    );
  }

  const firstSpan = getFirstSpan(example);
  const traceId = getExampleTraceId(example);
  const hasSpan = firstSpan !== null;

  const backUrl = example.dataset 
    ? `/organisation/${organisationId}/dataset/${example.dataset}`
    : undefined;

  return (
    <Page
      header="Example Details"
      back={backUrl}
      backLabel="Dataset"
      item={example}
      itemType="Example"
      onDelete={() => deleteExampleMutation.mutateAsync()}
      onUpdate={updates => updateExampleMutation.mutate(updates as Partial<Example>)}
      showEditorFor={['name', 'notes', 'tags']}
    >
      <Row>
        <Col>
          <Tags
            tags={example.tags || []}
            setTags={(tags) => updateExampleMutation.mutate({ tags })}
          />
          {hasSpan && traceId && (
            <p className="mt-3">
              <Link 
                to={`/organisation/${organisationId}/traces/${traceId}`}
                className="btn btn-link"
              >
                View Trace Details
              </Link>
            </p>
          )}
        </Col>
      </Row>

      <Row className="mt-3">
        <Col md={6}>
          <InputCard 
            example={example} 
            onUpdateInput={(input) => updateExampleMutation.mutate({ input })}
          />
          <MetricsCard
            example={example}
            datasetMetrics={dataset?.metrics || []}
            onEditMetric={(index, metric) => {
              setEditingMetricIndex(index);
              setEditingMetric(metric);
              setIsMetricModalOpen(true);
            }}
          />
        </Col>
        <Col md={6}>
          <OutputsCard example={example} dataset={dataset} />
        </Col>
      </Row>

      <MetricModal
        isOpen={isMetricModalOpen}
        example={example}
        toggle={() => {
          setIsMetricModalOpen(false);
          setEditingMetricIndex(null);
          setEditingMetric(undefined);
        }}
        onSave={handleSaveMetric}
        initialMetric={editingMetric}
        isEditing={editingMetricIndex !== null}
        organisationId={organisationId}
      />
    </Page>
  );
};

export default ExampleDetailsPage;

