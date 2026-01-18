import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Badge, Button } from 'reactstrap';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getExample, updateExample, getDataset } from '../api';
import type { Example, Span } from '../common/types';
import { Metric } from '../common/types/Dataset';
import JsonObjectViewer from '../components/generic/JsonObjectViewer';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import Tags from '../components/generic/Tags';
import MetricModal from '../components/MetricModal';
import { getTraceId } from '../utils/span-utils';
import { DEFAULT_SYSTEM_METRICS } from '../common/defaultSystemMetrics';

// Helper to get the first span from an Example
function getFirstSpan(example: Example): Span | null {
  if (example.spans && example.spans.length > 0) {
    return example.spans[0] as Span;
  }
  // If no spans array, check if example itself has span-like fields (for backward compatibility)
  if ((example as any).name || (example as any).spanId) {
    return example as any as Span;
  }
  return null;
}

const getExampleTraceId = (example: Example): string | null => {
  const span = getFirstSpan(example);
  if (span) {
    const traceId = getTraceId(span);
    if (traceId) return traceId;
    // Fallback to other possible trace ID locations
    return (span as any).trace?.id || (span as any).client_trace_id || (span as any).traceId || example.traceId || null;
  }
  return example.traceId || null;
};

// InputCard component
function InputCard({ example }: { example: Example }) {
  const hasInput = example.input !== undefined && example.input !== null;
  const hasSpans = example.spans && example.spans.length > 0;
  let inputThing = example.input || (example.spans?.length === 1 ? example.spans[0] : example.spans);  
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

  // Get custom example metrics (not in dataset)
  const customExampleMetrics = useMemo(() => {
    if (!example.metrics || example.metrics.length === 0) return [];
    const datasetMetricIds = new Set(allDatasetMetrics.map(m => m.id || m.name || ''));
    return example.metrics.filter(m => !datasetMetricIds.has(m.id || m.name || ''));
  }, [example.metrics, allDatasetMetrics]);

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
        {customExampleMetrics.length > 0 && (
          <div>
            <strong className="mb-2 d-block">Custom metrics on this example:</strong>
            {customExampleMetrics.map((metric, index) => {
              // Find the actual index in example.metrics array
              const actualIndex = example.metrics!.findIndex(m => 
                (m.id || m.name) === (metric.id || metric.name)
              );
              return (
                <Card key={index} className="mb-2">
                  <CardBody>
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <h6 className="mb-0">{metric.name}</h6>
                      <div className="d-flex gap-1">
                        <Button
                          color="primary"
                          size="sm"
                          onClick={() => {
                            onEditMetric(actualIndex, {
                              name: metric.name,
                              description: metric.description || '',
                              unit: metric.unit || '',
                              type: metric.type,
                              parameters: metric.parameters || {},
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          color="danger"
                          size="sm"
                          onClick={() => onDeleteMetric(actualIndex)}
                        >
                          ×
                        </Button>
                      </div>
                    </div>
                    {metric.description && (
                      <p className="text-muted small mb-1">{metric.description}</p>
                    )}
                    <div className="d-flex gap-2 flex-wrap">
                      <Badge color="info">{metric.type}</Badge>
                      {metric.unit && <Badge color="secondary">{metric.unit}</Badge>}
                    </div>
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
            })}
          </div>
        )}
        {customExampleMetrics.length === 0 && allDatasetMetrics.length === 0 && (
          <p className="text-muted">No metrics defined. Click "Add Metric" to create one.</p>
        )}
      </CardBody>
    </Card>
  );
}

// TBDCard component
function TBDCard() {
  return (
    <Card>
      <CardHeader>
        <h5>TBD</h5>
      </CardHeader>
      <CardBody>
        <p className="text-muted">To be determined</p>
      </CardBody>
    </Card>
  );
}

/**
An Example + editing tools
 */
const ExampleDetailsPage: React.FC = () => {
  const { organisationId, exampleId } = useParams<{ organisationId: string; exampleId: string }>();
  const queryClient = useQueryClient();
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

  if (error || !example) {
    return (
      <Container>
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load example: {error instanceof Error ? error.message : 'Unknown error'}</p>
          {organisationId && (
            <Link to={`/organisation/${organisationId}/dataset`} className="btn btn-primary">
              Back to Datasets
            </Link>
          )}
        </div>
      </Container>
    );
  }

  const firstSpan = getFirstSpan(example);
  const traceId = getExampleTraceId(example);
  const hasSpan = firstSpan !== null;

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <div className="mb-3">
            {example.dataset && (
              <Link 
                to={`/organisation/${organisationId}/dataset/${example.dataset}`}
                className="btn btn-link"
              >
                ← Back to Dataset
              </Link>
            )}
          </div>
          <h1>Example Details</h1>
          {example.id && (
            <p className="text-muted">
              <strong>Example ID:</strong> <code>{example.id}</code>
            </p>
          )}
          {example.created && (
            <p className="text-muted">
              <strong>Created:</strong> {new Date(example.created).toLocaleString()}
            </p>
          )}
          <Tags
            tags={example.tags || []}
            setTags={(tags) => updateExampleMutation.mutate({ tags })}
          />
          {hasSpan && traceId && (
            <p>
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
              const updatedMetrics = example.metrics!.filter((_, i) => i !== index);
              updateExampleMutation.mutate({ metrics: updatedMetrics });
            }}
          />
        </Col>
        <Col md={6}>
          <TBDCard />
        </Col>
      </Row>

      <MetricModal
        isOpen={isMetricModalOpen}
        toggle={() => {
          setIsMetricModalOpen(false);
          setEditingMetricIndex(null);
          setEditingMetric(undefined);
        }}
        onSave={(metric) => {
          let updatedMetrics: Metric[];
          if (editingMetricIndex !== null && example) {
            // Edit existing metric
            updatedMetrics = [...(example.metrics || [])];
            updatedMetrics[editingMetricIndex] = metric;
          } else {
            // Add new metric
            updatedMetrics = [...(example?.metrics || []), metric];
          }
          updateExampleMutation.mutate({ metrics: updatedMetrics });
          setIsMetricModalOpen(false);
          setEditingMetricIndex(null);
          setEditingMetric(undefined);
        }}
        initialMetric={editingMetric}
        isEditing={editingMetricIndex !== null}
      />
    </Container>
  );
};

export default ExampleDetailsPage;

