import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Badge, Button, Modal, ModalHeader, ModalBody, ModalFooter } from 'reactstrap';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { getDataset, listExperiments, searchExamples, updateDataset, createExampleFromInput, updateExample, deleteExample } from '../api';
import type { Dataset, Example, Span } from '../common/types';
import type Experiment from '../common/types/Experiment';
import { Metric } from '../common/types/Metric';
import { getSpanId } from '../common/types';
import { getStartTime, getEndTime, getDurationMs } from '../utils/span-utils';
import { useToast } from '../utils/toast';

import TableUsingAPI, { PageableData } from '../components/generic/TableUsingAPI';
import MetricModal, { addOrEditMetric } from '../components/MetricModal';
import AddExampleModal from '../components/AddExampleModal';
import PropInput from '../components/generic/PropInput';
import Tags from '../components/generic/Tags';
import NameAndDeleteHeader from '../components/generic/NameAndDeleteHeader';
import Page from '../components/generic/Page';
import Spinner from '../components/generic/Spinner';
import MetricCard from '../components/dashboard/MetricCard';
import { DEFAULT_SYSTEM_METRICS } from '../common/defaultSystemMetrics';
import { asArray, truncate } from '../common/utils/miscutils';
import { Trash } from '@phosphor-icons/react';
import { getExampleInputString, getFirstSpan, getExampleSpecificMetricText, getExampleMetricDisplayText } from '../utils/example-utils';

const DatasetDetailsPage: React.FC = () => {
  const { organisationId, datasetId } = useParams<{ organisationId: string; datasetId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [isAddExampleModalOpen, setIsAddExampleModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [exampleToDelete, setExampleToDelete] = useState<Example | null>(null);
  const [isMetricModalOpen, setIsMetricModalOpen] = useState(false);
  const [editingMetricIndex, setEditingMetricIndex] = useState<number | null>(null);
  const [editingMetric, setEditingMetric] = useState<Partial<Metric> | undefined>(undefined);

  const { data: dataset, isLoading, error } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  const updateDatasetMutation = useMutation({
    mutationFn: (updates: Partial<Dataset>) => updateDataset(datasetId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataset', datasetId] });
    },
  });

  const deleteExampleMutation = useMutation({
    mutationFn: (exampleId: string) => deleteExample(organisationId!, exampleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-data'] });
      queryClient.invalidateQueries({ queryKey: ['dataset-examples', organisationId, datasetId] });
      setDeleteModalOpen(false);
      setExampleToDelete(null);
      showToast('Example deleted successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to delete example: ${error.message}`, 'error');
    },
  });

  const { data: experiments } = useQuery({
    queryKey: ['experiments', organisationId, datasetId],
    queryFn: () => listExperiments(organisationId!),
    enabled: !!datasetId && !!organisationId,
    select: (data) => {
      // Filter by dataset
      return data.filter((exp: Experiment) => exp.dataset === datasetId);
    },
  });

  const loadExamplesData = async (query: string): Promise<PageableData<Example>> => {
    const result = await searchExamples({
      organisationId: organisationId!,
      datasetId,
      query: query || undefined,
      limit: 1000,
      offset: 0,
    });
    return {
      hits: result.hits || [],
      offset: result.offset || 0,
      limit: result.limit || 1000,
      total: result.total,
    };
  };
  const columns = useMemo<ColumnDef<Example>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'ID',
        cell: ({ row }) => (
          <code className="small">{row.original.id?.substring(0, 16)}...</code>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (example: Example) => {
          if (example.name) return example.name;
          if (example.input) return truncate(example.input, 100);
          const span = getFirstSpan(example);
          if (span?.name) return truncate(span.name, 100);
          return;
         },
      },
      // One column per dataset metric
      ...(dataset?.metrics ? asArray(dataset.metrics).map((metric: Metric) => ({
        id: `metric-${metric.id}`,
        header: metric.name || metric.id,
        cell: ({ row }: { row: { original: Example } }) => {
          const text = getExampleMetricDisplayText(row.original, metric.id || metric.name || '');
          if (!text) return <span className="text-muted">—</span>;
          const truncated = getExampleInputString(text, 80);
          return (
            <span className="small" title={text}>
              {truncated}
            </span>
          );
        },
      })) : []),
      {
        id: 'specific',
        header: 'Specific',
        cell: ({ row }) => {
          const specificText = getExampleSpecificMetricText(row.original);
          if (!specificText) {
            return <span className="text-muted">—</span>;
          }
          const truncated = getExampleInputString(specificText, 100);
          return (
            <span className="small" title={specificText}>
              {truncated}
            </span>
          );
        },
      },
      {
        id: 'created',
        header: 'Created',
        accessorFn: (row) => (row.created ? new Date(row.created).getTime() : 0),
        cell: ({ row }) => row.original.created
          ? new Date(row.original.created).toLocaleString()
          : <span className="text-muted">—</span>,
        enableSorting: true,
      },
      {
        id: 'tags',
        header: 'Tags',
        accessorFn: (row) => {
          // Sort by first tag alphabetically, or empty string if no tags
          if (!row.tags || !Array.isArray(row.tags) || row.tags.length === 0) {
            return '';
          }
          return row.tags[0] || '';
        },
        cell: ({ row }) => {
          const example = row.original;
          return (
            <Tags
              compact={true}
              tags={example.tags}
              setTags={async (newTags) => {
                try {
                  if (example.id && organisationId) {
                    await updateExample(organisationId, example.id, {
                      tags: newTags,
                    });
                    queryClient.invalidateQueries({ queryKey: ['table-data'] });
                  }
                } catch (error) {
                  console.error('Failed to update example tags:', error);
                  showToast(`Failed to update tags: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
                }
              }}
            />
          );
        },
        enableSorting: true,
      },
      {
        id: 'delete',
        header: 'Delete',
        cell: ({ row }) => {
          const example = row.original;
          return (
            <Button
              color="danger"
              size="sm"
              onClick={(e) => {
                e.stopPropagation(); // Prevent row click navigation
                setExampleToDelete(example);
                setDeleteModalOpen(true);
              }}
              disabled={deleteExampleMutation.isPending}
            >
              <Trash size={16} />
            </Button>
          );
        },
        enableSorting: false,
      },
    ],
    [organisationId, queryClient, showToast, deleteExampleMutation.isPending, dataset]
  ); // end columns

  const handleSaveMetric = (metric: Partial<Metric>) => {
    dataset.metrics = addOrEditMetric(metric, asArray(dataset?.metrics) as Metric[]);
    updateDatasetMutation.mutate({ metrics: dataset.metrics });
    setIsMetricModalOpen(false);
    setEditingMetricIndex(null);
    setEditingMetric(undefined);
  };

  if (isLoading) {
    return (
      <Container>
        <Spinner centered />
      </Container>
    );
  }

  if (error || !dataset) {
    return (
      <Container>
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load dataset: {error instanceof Error ? error.message : 'Unknown error'}</p>
          <Link to={`/organisation/${organisationId}/dataset`} className="btn btn-primary">
            Back to Datasets
          </Link>
        </div>
      </Container>
    );
  }

  const datasetExperiments = experiments || [];

  return (
    <Page
      header={
        <NameAndDeleteHeader
          label="Dataset"
          item={dataset}
          handleNameChange={() => updateDatasetMutation.mutate({ name: dataset.name })}
        />
      }
      back={`/organisation/${organisationId}/dataset`}
      backLabel="Datasets"
      item={dataset}
    >
      {/* TODO but not yet <Row className="">
        <Col>
          <ListGroup flush>
            <ListGroupItem>
              <PropInput 
                item={dataset} 
                prop="description" 
                type="text"
                onChange={() => {
                  updateDatasetMutation.mutate({ description: dataset.description });
                }}
              />
            </ListGroupItem>
            <ListGroupItem>
              <Tags
                tags={dataset.tags || []}
                setTags={(tags) => updateDatasetMutation.mutate({ tags })}
              />
            </ListGroupItem>
          </ListGroup>
        </Col>
      </Row> */}

      <Row className="mt-3">
        <Col>
          <Card>
            <CardHeader className="d-flex justify-content-between align-items-center">
              <h5>Metrics</h5>
              <Button color="primary" size="sm" onClick={() => {
                setEditingMetricIndex(null);
                setEditingMetric(undefined);
                setIsMetricModalOpen(true);
              }}>
                + Add Metric
              </Button>
            </CardHeader>
            <CardBody>
              <Row>
                {/* Default system metrics - always shown, no edit buttons */}
                {DEFAULT_SYSTEM_METRICS.map((metric, index) => (
                  <Col md={6} lg={4} key={`system-${index}`} className="mb-3">
                    <Card>
                      <CardBody>
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <h6 className="mb-0">{metric.name}</h6>
                        </div>
                        {metric.description && (
                          <p className="text-muted small mb-1">{metric.description}</p>
                        )}
                        <div className="d-flex gap-2 flex-wrap">
                          <Badge color="info">{metric.type}</Badge>
                          {metric.unit && <Badge color="secondary">{metric.unit}</Badge>}
                        </div>
                      </CardBody>
                    </Card>
                  </Col>
                ))}
                {/* User-defined metrics - with edit buttons */}
                {(() => {
                  const userMetrics = asArray(dataset.metrics) as Metric[];
                  return userMetrics.length > 0 && userMetrics.map((metric, index) => (
                  <Col md={6} lg={4} key={`user-${index}`} className="mb-3">
                    <Card>
                      <CardBody>
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <h6 className="mb-0">{metric.name}</h6>
                          <div className="d-flex gap-1">
                            <Button
                              color="primary"
                              size="sm"
                              onClick={() => {
                                setEditingMetricIndex(index);
                                setEditingMetric(metric);
                                setIsMetricModalOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              color="danger"
                              size="sm"
                              onClick={() => {
                                const currentMetrics = asArray(dataset.metrics) as Metric[];
                                const updatedMetrics = currentMetrics.filter((_, i) => i !== index);
                                updateDatasetMutation.mutate({ metrics: updatedMetrics });
                              }}
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
                  </Col>
                  ));
                })()}
              </Row>
              {(() => {
                const userMetrics = asArray(dataset.metrics) as Metric[];
                return userMetrics.length === 0 && (
                  <p className="text-muted mt-3">Custom metrics can be used to score e.g. accuracy, helpfulness, or length of response. Click "Add Metric" to create one.</p>
                );
              })()}
            </CardBody>
          </Card>
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

      <Row className="mt-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5>Examples</h5>
            <Button 
              color="primary" 
              size="sm" 
              onClick={() => setIsAddExampleModalOpen(true)}
            >
              + Add Simple Example
            </Button>
          </div>
          <TableUsingAPI
            loadData={loadExamplesData}
            showSearch={true}
            columns={columns}
            searchPlaceholder="Search examples..."
            searchDebounceMs={500}
            pageSize={50}
            enableInMemoryFiltering={true}
            queryKeyPrefix={['dataset-examples', organisationId, datasetId]}
            onRowClick={(example) => {
              if (example.id && organisationId) {
                navigate(`/organisation/${organisationId}/example/${example.id}`);
              }
            }}
          />
        </Col>
      </Row>

      <AddExampleModal
        isOpen={isAddExampleModalOpen}
        toggle={() => setIsAddExampleModalOpen(false)}
        onSave={async (input, tags) => {
          try {
            await createExampleFromInput({
              organisationId: organisationId!,
              datasetId: datasetId!,
              input: input,
              tags: tags.length > 0 ? tags : undefined,
            });
            queryClient.invalidateQueries({ queryKey: ['table-data'] });
            setIsAddExampleModalOpen(false);
            showToast('Example added successfully!', 'success');
          } catch (error) {
            showToast(`Failed to add example: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
          }
        }}
      />

      {/* Delete Confirmation Modal */}
      <Modal isOpen={deleteModalOpen} toggle={() => setDeleteModalOpen(false)}>
        <ModalHeader toggle={() => setDeleteModalOpen(false)}>
          Delete Example
        </ModalHeader>
        <ModalBody>
          <p>Are you sure you want to delete this example?</p>
          <p className="text-danger">This action cannot be undone.</p>
        </ModalBody>
        <ModalFooter>
          <Button 
            color="danger" 
            onClick={() => {
              if (exampleToDelete?.id) {
                deleteExampleMutation.mutate(exampleToDelete.id);
              }
            }}
            disabled={deleteExampleMutation.isPending}
          >
            {deleteExampleMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
          <Button color="secondary" onClick={() => setDeleteModalOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </Page>
  );
};

export default DatasetDetailsPage;

