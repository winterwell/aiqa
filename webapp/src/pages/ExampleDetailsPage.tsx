import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Row, Col, Card, CardBody, CardHeader, Badge, Button } from 'reactstrap';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getExample, updateExample, getDataset, deleteExample } from '../api';
import { useToast } from '../utils/toast';
import type { Example, Span } from '../common/types';
import Metric from '../common/types/Metric';
import JsonObjectViewer from '../components/generic/JsonObjectViewer';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import Tags from '../components/generic/Tags';
import MetricModal, { addOrEditMetric, deleteMetric } from '../components/MetricModal';
import Page from '../components/generic/Page';
import { getStartTime, getDurationMs, durationString, prettyNumber, formatCost } from '../utils/span-utils';
import { DEFAULT_SYSTEM_METRICS } from '../common/defaultSystemMetrics';
import { searchSpans } from '../api';
import { asArray } from '../common/utils/miscutils';
import { getExampleInput, getFirstSpan, getExampleTraceId } from '../utils/example-utils';

// InputCard component
function InputCard({ example }: { example: Example }) {
  const inputThing = getExampleInput(example);
  return (
    <Card className="mb-3">
      <CardHeader>
        <h5>Input</h5>
      </CardHeader>
      <CardBody>
       
          <div>
            {typeof inputThing === 'string' ? (
              <TextWithStructureViewer text={inputThing} />
            ) : (
              <JsonObjectViewer json={inputThing} textComponent={TextWithStructureViewer} />
            )}
          </div>
  
      </CardBody>
    </Card>
  );
}

// MetricCardItem component - reusable card for displaying a single metric
function MetricCardItem({
  metric,
  onEdit,
  onDelete,
}: {
  metric: Metric;
  onEdit: () => void;
  onDelete: () => void;
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
            <Button color="danger" size="sm" onClick={onDelete}>
              ×
            </Button>
          </div>
        </div>
        {metric.description && (
          <p className="text-muted small mb-1">{metric.description}</p>
        )}
        <div className="d-flex gap-2 flex-wrap mb-2">
          <Badge color="info">{metric.type}</Badge>
          {metric.unit && <Badge color="secondary">{metric.unit}</Badge>}
        </div>
        {metric.type === 'llm' && metric.prompt && (
          <div className="mt-2">
            <strong className="small d-block mb-1">Prompt:</strong>
            <pre className="small bg-light p-2 mb-0" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {metric.prompt}
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
}

// MetricsCard component
function MetricsCard({
  example,
  datasetMetrics,
  onAddMetric,
  onEditMetric,
  onDeleteMetric,
}: {
  example: Example;
  datasetMetrics: Metric[] | null | undefined;
  onAddMetric: () => void;
  onEditMetric: (index: number, metric: Partial<Metric>) => void;
  onDeleteMetric: (index: number) => void;
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

  // Get custom example metrics (not in dataset, and not the "specific" metric which is shown separately)
  const customExampleMetrics = useMemo(() => {
    if (!example.metrics) return [];
    const metricsArray = asArray(example.metrics) as Metric[];
    if (metricsArray.length === 0) return [];
    const datasetMetricIds = new Set(allDatasetMetrics.map(m => m.id || m.name || ''));
    return metricsArray.filter(m => 
      m.id !== 'specific' && !datasetMetricIds.has(m.id || m.name || '')
    );
  }, [example.metrics, allDatasetMetrics]);

  // Get the "specific" metric separately
  const specificMetric = useMemo(() => {
    if (!example.metrics) return null;
    const metricsArray = asArray(example.metrics) as Metric[];
    return metricsArray.find(m => m.id === 'specific') || null;
  }, [example.metrics]);

  // Get the index of the specific metric in example.metrics
  const specificMetricIndex = useMemo(() => {
    if (!example.metrics || !specificMetric) return -1;
    const metricsArray = asArray(example.metrics) as Metric[];
    return metricsArray.findIndex(m => m.id === 'specific');
  }, [example.metrics, specificMetric]);

  const datasetMetricsText = allDatasetMetrics.map(m => m.name || m.id || 'Unknown').join(', ');

  return (
    <Card>
      <CardHeader className="d-flex justify-content-between align-items-center">
        <h5>Metrics</h5>
        <Button color="primary" size="sm" onClick={onAddMetric}>
          + Add Metric
        </Button>
      </CardHeader>
      <CardBody>
        {allDatasetMetrics.length > 0 && (
          <div className="mb-3">
            <strong>Dataset metrics:</strong> <span className="text-muted">{datasetMetricsText}</span>
          </div>
        )}
        {specificMetric && (
          <div className="mb-3">
            <strong className="mb-2 d-block">Example Specific:</strong>
            <MetricCardItem
              metric={specificMetric}
              onEdit={() => {
                onEditMetric(specificMetricIndex, {
                  ...specificMetric,
                  name: specificMetric.name || 'Example Specific',
                });
              }}
              onDelete={() => onDeleteMetric(specificMetricIndex)}
            />
          </div>
        )}
        {customExampleMetrics.length > 0 && (
          <div>
            <strong className="mb-2 d-block">Custom metrics on this example:</strong>
            {customExampleMetrics.map((metric, index) => {
              // Find the actual index in example.metrics array
              const actualIndex = example.metrics!.findIndex(m => 
                (m.id || m.name) === (metric.id || metric.name)
              );
              return (
                <MetricCardItem
                  key={index}
                  metric={metric}
                  onEdit={() => {
                    onEditMetric(actualIndex, {
                      ...metric,
                    });
                  }}
                  onDelete={() => onDeleteMetric(actualIndex)}
                />
              );
            })}
          </div>
        )}
        {customExampleMetrics.length === 0 && allDatasetMetrics.length === 0 && !specificMetric && (
          <p className="text-muted">No metrics defined. Click "Add Metric" to create one.</p>
        )}
      </CardBody>
    </Card>
  );
}

/** Outputs: load the last 5 spans with span.example = example.id. Show a card per span, 
 * with span time, span.attributes.output, span stats (duration, tokens, cost) 
 * */
function OutputsCard({ example }: { example: Example }) {
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
              const durationMs = getDurationMs(span);
              const tokenCount = span.stats?.totalTokens || 0;
              const cost = span.stats?.cost || 0;

              return (
                <Card key={index} className="mb-3">
                  <CardBody>
                    <div className="mb-2">
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
                      {durationMs !== null && (
                        <Badge color="info">
                          Duration: {durationString(durationMs)}
                        </Badge>
                      )}
                      {tokenCount !== null && (
                        <Badge color="secondary">
                          Tokens: {prettyNumber(tokenCount)}
                        </Badge>
                      )}
                      {cost !== null && (
                        <Badge color="success">
                          Cost: {formatCost(cost)}
                        </Badge>
                      )}
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
    mutationFn: (updates: Partial<{ tags?: string[]; metrics?: Metric[] }>) =>
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
          <InputCard example={example} />
          <MetricsCard
            example={example}
            datasetMetrics={dataset?.metrics || []}
            onAddMetric={() => {
              setEditingMetricIndex(null);
              setEditingMetric(undefined);
              setIsMetricModalOpen(true);
            }}
            onEditMetric={(index, metric) => {
              setEditingMetricIndex(index);
              setEditingMetric(metric);
              setIsMetricModalOpen(true);
            }}
            onDeleteMetric={(index) => {
              const metricsArray = asArray(example.metrics) as Metric[];
              if (index >= 0 && index < metricsArray.length) {
                const metricToDelete = metricsArray[index];
                const updatedMetrics = deleteMetric(metricToDelete, metricsArray);
                updateExampleMutation.mutate({ metrics: updatedMetrics });
              }
            }}
          />
        </Col>
        <Col md={6}>
          <OutputsCard example={example} />
        </Col>
      </Row>

      <MetricModal
        isOpen={isMetricModalOpen}
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

