import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Row, Col, Card, CardBody, CardHeader, Input, Button, Form, FormGroup, Label, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listDatasets, createDataset, getDatasetStats, deleteDataset } from '../api';
import type { DatasetStatsMap } from '../api';
import type { Dataset } from '../common/types';
import TableUsingAPI, { ExtendedColumnDef, PageableData } from '../components/generic/TableUsingAPI';
import ConfirmDialog from '../components/generic/ConfirmDialog';
import Page from '../components/generic/Page';
import { populateDatasetFromRecentTraces, type TraceSampleWindow } from '../datasetPopulateFromTraces';
import { useToast } from '../utils/toast';
import { TrashIcon } from '@phosphor-icons/react';
import A from '../components/generic/A';

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
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Dataset[]>([]);

  const {
    data: statsByDataset,
    isLoading: statsLoading,
    isError: statsError,
  } = useQuery({
    queryKey: ['dataset-stats', organisationId],
    queryFn: () => getDatasetStats(organisationId!),
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
      queryClient.invalidateQueries({ queryKey: ['dataset-stats', organisationId] });
      queryClient.invalidateQueries({ queryKey: ['table-data', 'datasets', organisationId] });
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

  const loadData = async (query: string): Promise<PageableData<Dataset>> => {
    const hits = await listDatasets(organisationId!, query || undefined);
    const list = Array.isArray(hits) ? hits : [];
    return { hits: list, total: list.length };
  };

  const stat = (datasetId: string, key: 'examples' | 'experiments', map: DatasetStatsMap | undefined) => {
    if (statsError) return '—';
    if (statsLoading) return '…';
    return map?.[datasetId]?.[key] ?? 0;
  };

  const columns = useMemo<ExtendedColumnDef<Dataset>[]>(() => {
    const map = statsByDataset;
    return [
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        cell: ({ row }) => (
          <A href={`/organisation/${organisationId}/dataset/${row.original.id}`}>
            <strong>{row.original.name}</strong>
          </A>
        ),
        csvValue: (row) => row.name ?? '',
        enableSorting: true,
      },
      {
        id: 'description',
        header: 'Description',
        accessorFn: (row) => row.description ?? '',
        cell: ({ row }) => row.original.description || <span className="text-muted">-</span>,
        csvValue: (row) => row.description ?? '',
        enableSorting: true,
      },
      {
        id: 'tags',
        header: 'Tags',
        accessorFn: (row) => (row.tags && row.tags.length ? row.tags.join(', ') : ''),
        cell: ({ row }) =>
          row.original.tags && row.original.tags.length > 0 ? (
            <div>
              {row.original.tags.map((tag, idx) => (
                <span key={idx} className="badge bg-secondary me-1">
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-muted">-</span>
          ),
        csvValue: (row) => (row.tags && row.tags.length ? row.tags.join('; ') : ''),
        enableSorting: true,
      },
      {
        id: 'examples',
        header: 'Examples',
        accessorFn: (row) => map?.[row.id]?.examples ?? 0,
        cell: ({ row }) => (
          <span className={statsLoading && !statsError ? 'text-muted' : undefined}>
            {stat(row.original.id, 'examples', map)}
          </span>
        ),
        csvValue: (row) => String(map?.[row.id]?.examples ?? ''),
        enableSorting: true,
      },
      {
        id: 'experiments',
        header: 'Experiments',
        accessorFn: (row) => map?.[row.id]?.experiments ?? 0,
        cell: ({ row }) => (
          <span className={statsLoading && !statsError ? 'text-muted' : undefined}>
            {stat(row.original.id, 'experiments', map)}
          </span>
        ),
        csvValue: (row) => String(map?.[row.id]?.experiments ?? ''),
        enableSorting: true,
      },
      {
        id: 'created',
        header: 'Created',
        accessorFn: (row) => new Date(row.created).getTime(),
        cell: ({ row }) => new Date(row.original.created).toLocaleString(),
        csvValue: (row) => new Date(row.created).toISOString(),
        enableSorting: true,
      },
      {
        id: 'updated',
        header: 'Updated',
        accessorFn: (row) => new Date(row.updated).getTime(),
        cell: ({ row }) => new Date(row.original.updated).toLocaleString(),
        csvValue: (row) => new Date(row.updated).toISOString(),
        enableSorting: true,
      },
    ];
  }, [organisationId, statsByDataset, statsLoading, statsError]);

  const openBulkDelete = (_ids: string[], rows: Dataset[]) => {
    setSelectedRows(rows);
    setDeleteModalOpen(true);
  };

  const confirmBulkDelete = async () => {
    const toDelete = selectedRows;
    if (toDelete.length === 0) {
      setDeleteModalOpen(false);
      return;
    }
    try {
      await Promise.all(toDelete.map((r) => deleteDataset(r.id)));
      queryClient.invalidateQueries({ queryKey: ['datasets', organisationId] });
      queryClient.invalidateQueries({ queryKey: ['dataset-stats', organisationId] });
      queryClient.invalidateQueries({ queryKey: ['table-data', 'datasets', organisationId] });
      queryClient.invalidateQueries({ queryKey: ['experiments', organisationId] });
      setDeleteModalOpen(false);
      setSelectedRows([]);
      showToast(`Deleted ${toDelete.length} dataset(s).`, 'success');
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  return (
    <Page fluid header="Datasets" back={`/organisation/${organisationId}`} backLabel="Organisation">
      <Row>
        <Col className="d-flex justify-content-end mb-3">
          <Button color="primary" onClick={() => setShowCreateForm(true)}>
            Create New Dataset
          </Button>
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
                    <Button
                      color="secondary"
                      onClick={() => {
                        setShowCreateForm(false);
                        setDatasetName('');
                        setDatasetDescription('');
                        setPopulateExampleCount(20);
                        setTraceSampleWindow('1d');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  {createDatasetMutation.isError && (
                    <Alert color="danger" className="mt-3">
                      Failed to create dataset:{' '}
                      {createDatasetMutation.error instanceof Error
                        ? createDatasetMutation.error.message
                        : 'Unknown error'}
                    </Alert>
                  )}
                </Form>
              </CardBody>
            </Card>
          </Col>
        </Row>
      )}

      <Row className="mt-1">
        <Col>
          <TableUsingAPI<Dataset>
            loadData={loadData}
            columns={columns}
            queryKeyPrefix={['datasets', organisationId]}
            searchPlaceholder="Search datasets (Gmail-style syntax)"
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/organisation/${organisationId}/dataset/${row.id}`)}
            enableRowSelection
            bulkActionsToolbar={(_ids, rows) => (
              <>
                <Button
                  color="primary"
                  size="sm"
                  disabled={rows.length !== 2}
                  onClick={() =>
                    navigate(
                      `/organisation/${organisationId}/dataset/compare/${rows[0].id}/v/${rows[1].id}`
                    )
                  }
                  title={
                    rows.length === 2
                      ? 'Compare selected datasets'
                      : 'Select exactly two datasets to compare'
                  }
                >
                  Compare
                </Button>
                <Button color="danger" size="sm" onClick={() => openBulkDelete(_ids, rows)} title="Delete selected datasets">
                  <TrashIcon size={16} className="me-1" />
                  Delete
                </Button>
              </>
            )}
          />
          <ConfirmDialog
            isOpen={deleteModalOpen}
            toggle={() => setDeleteModalOpen(false)}
            header="Delete selected datasets"
            body={`Delete ${selectedRows.length} dataset(s)? Experiments that use them are removed (cascade). This cannot be undone.`}
            onConfirm={confirmBulkDelete}
            confirmButtonText="Delete"
            confirmButtonColor="danger"
          />
        </Col>
      </Row>
    </Page>
  );
};

export default DatasetListPage;
