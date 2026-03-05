import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Row, Col, Card, CardBody, CardHeader, Badge, Button, Input } from 'reactstrap';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getExample, updateExample, getDataset, deleteExample } from '../api';
import { useToast } from '../utils/toast';
import type { Example, Span } from '../common/types';
import type Dataset from '../common/types/Dataset';
import Metric from '../common/types/Metric';
import JsonObjectViewer from '../components/generic/JsonObjectViewer';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import Tags from '../components/generic/Tags';
import MetricModal, { addOrEditMetric, deleteMetric } from '../components/MetricModal';
import Page from '../components/generic/Page';
import { getStartTime, formatMetricValue, getSpanMetricValue } from '../utils/span-utils';
import { DEFAULT_SYSTEM_METRICS, SPECIFIC_METRIC_ID } from '../common/defaultSystemMetrics';
import { getMetrics } from '../utils/metric-utils';
import { searchSpans } from '../api';
import { asArray } from '../common/utils/miscutils';
import { getExampleInput, getFirstSpan, getExampleTraceId } from '../utils/example-utils';
import { space } from '../common/utils/miscutils';

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
  const inputThing = getExampleInput(example);
  const usesInput = example.input !== undefined && example.input !== null;

  const handleEdit = () => {
    // Initialize edit value: if string, use as-is; otherwise stringify
    if (typeof inputThing === 'string') {
      setEditValue(inputThing);
    } else {
      setEditValue(JSON.stringify(inputThing, null, 2));
    }
    setIsEditing(true);
  };

  const handleSave = () => {
    try {
      // Try to parse as JSON first, fall back to string if it fails
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(editValue);
      } catch {
        // If JSON parsing fails, use as string
        parsedValue = editValue;
      }
      onUpdateInput(parsedValue);
      setIsEditing(false);
    } catch (error) {
      // This shouldn't happen, but handle gracefully
      console.error('Error saving input:', error);
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  return (
    <Card className="mb-3">
      <CardHeader className="d-flex justify-content-between align-items-center">
        <h5>Input</h5>
        {usesInput && !isEditing && (
          <Button color="primary" size="sm" onClick={handleEdit}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {isEditing ? (
          <div>
            <Input
              type="textarea"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={10}
              style={{ fontFamily: 'monospace' }}
            />
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
              <TextWithStructureViewer text={inputThing} />
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
  // All dataset metrics (system + custom), excluding example-specific which is not per-span.
  // When no dataset, fall back to system metrics so we still show duration, tokens, cost, spans.
  const datasetMetrics = useMemo(() => {
    const all = dataset ? getMetrics(dataset) : DEFAULT_SYSTEM_METRICS;
    return all.filter((m) => (m.id || m.name) !== SPECIFIC_METRIC_ID);
  }, [dataset]);

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

