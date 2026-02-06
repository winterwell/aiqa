import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button } from 'reactstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listExperiments, listDatasets, deleteExperiment } from '../api';
import type Experiment from '../common/types/Experiment';
import type { Metric } from '../common/types/Metric';
import ExperimentsListMetricsDashboard from '../components/ExperimentListMetricsDashboard';
import TableUsingAPI, { ExtendedColumnDef, PageableData } from '../components/generic/TableUsingAPI';
import A from '../components/generic/A';
import ConfirmDialog from '../components/generic/ConfirmDialog';
import { durationString, formatCost, prettyNumber } from '../utils/span-utils';
import { TrashIcon } from '@phosphor-icons/react';
import { COST_METRIC_ID, TOTAL_TOKENS_METRIC_ID, DURATION_METRIC_ID, SPECIFIC_METRIC_ID } from '../common/defaultSystemMetrics';

function getMetricMean(exp: Experiment, metricId: string): number | null {
  const summary = exp.summaries || {};
  const v = summary[metricId];
  if (v == null || typeof v !== 'object') {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  const n = v.mean;
  return n != null && isFinite(n) ? Number(n) : null;
}

const ExperimentsListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<Experiment[]>([]);

  const { data: experimentsForDashboard } = useQuery({
    queryKey: ['experiments', organisationId, 'dashboard'],
    queryFn: () => listExperiments(organisationId!, undefined),
    enabled: !!organisationId,
  });
  const { data: datasets } = useQuery({
    queryKey: ['datasets', organisationId],
    queryFn: () => listDatasets(organisationId!),
    enabled: !!organisationId,
  });
  const datasetNameById = useMemo(() => {
    if (!datasets || !Array.isArray(datasets)) return new Map<string, string>();
    return new Map(datasets.map((d: { id: string; name: string }) => [d.id, d.name]));
  }, [datasets]);

  // Union of metric ids from datasets referenced by experiments (first metric with each id gives display name)
  const metricsById = useMemo(() => {
    const refIds = new Set<string>(
      (Array.isArray(experimentsForDashboard) ? experimentsForDashboard : [])
        .map((e: Experiment) => e.dataset)
        .filter(Boolean)
    );
    const refDatasets = Array.isArray(datasets) ? datasets.filter((d: { id: string }) => refIds.has(d.id)) : [];
    const byId = new Map<string, Metric>();
    for (const d of refDatasets) {
      for (const m of d.metrics || []) {
        if (m?.id && !byId.has(m.id)) byId.set(m.id, m);
      }
    }
    return byId;
  }, [datasets, experimentsForDashboard]);

  const metricColumns = useMemo(() => {
    const priorityIds = [DURATION_METRIC_ID, COST_METRIC_ID, TOTAL_TOKENS_METRIC_ID];
    const priority: Metric[] = [];
    const rest: Metric[] = [];
    metricsById.forEach((m) => {
      if (priorityIds.includes(m.id)) priority.push(m);
      else rest.push(m);
    });
    const ordered = [...priority.sort((a, b) => priorityIds.indexOf(a.id) - priorityIds.indexOf(b.id)), ...rest];
    return ordered.map((metric) => {
      const displayName = metric.name || metric.id;
      const isDuration = metric.id === DURATION_METRIC_ID;
      const isCost = metric.id === COST_METRIC_ID;
      const isTokens = metric.id === TOTAL_TOKENS_METRIC_ID;
      const isSpecific = metric.id === SPECIFIC_METRIC_ID;
      return {
        id: metric.id,
        header: displayName,
        accessorFn: (row: Experiment) => getMetricMean(row, metric.id),
        cell: ({ row }: { row: { original: Experiment } }) => {
          const v = getMetricMean(row.original, metric.id);
          if (v == null) return '-';
          if (isDuration) return durationString(v);
          if (isCost) return formatCost(v);
          if (isTokens) return prettyNumber(v);
          if (isSpecific) return (100 * v).toFixed(1);
          return prettyNumber(v);
        },
        csvValue: (row: Experiment) => {
          const v = getMetricMean(row, metric.id);
          if (v == null) return '';
          if (isSpecific) return String(100 * v);
          return String(v);
        },
        enableSorting: true,
      };
    });
  }, [metricsById]);

  const loadData = async (query: string): Promise<PageableData<Experiment>> => {
    const hits = await listExperiments(organisationId!, query || undefined);
    return { hits: Array.isArray(hits) ? hits : [], total: Array.isArray(hits) ? hits.length : 0 };
  };

  const columns = useMemo<ExtendedColumnDef<Experiment>[]>(() => [
    {
      id: 'created',
      header: 'Created',
      accessorFn: (row) => new Date(row.created).getTime(),
      cell: ({ row }) => new Date(row.original.created).toLocaleString(),
      csvValue: (row) => new Date(row.created).toISOString(),
      enableSorting: true,
    },
    {
      id: 'id',
      header: 'ID',
      accessorKey: 'id',
      cell: ({ row }) => (
        <A href={`/organisation/${organisationId}/experiment/${row.original.id}`}>
          <strong>{row.original.id.substring(0, 8)}...</strong>
        </A>
      ),
      csvValue: (row) => row.id,
      enableSorting: true,
    },
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => row.original.name ?? '-',
      csvValue: (row) => row.name ?? '',
      enableSorting: true,
    },
    {
      id: 'dataset',
      header: 'Dataset',
      accessorKey: 'dataset',
      accessorFn: (experiment: Experiment) => {
        const name = datasetNameById.get(experiment.dataset);
        return name || experiment.dataset;
      },
      enableSorting: true,
    },
    {
      id: 'exampleCount',
      header: 'Examples',
      accessorFn: (row) => row.summaries?.duration?.count ?? 0,
      csvValue: (row) => String(row.summaries?.duration?.count ?? 0),
    },
    ...metricColumns,
  ], [organisationId, datasetNameById, metricColumns]);

  const handleBulkDelete = (ids: string[], rows: Experiment[]) => {
    setSelectedRowIds(ids);
    setSelectedRows(rows);
    setDeleteModalOpen(true);
  };

  const handleBulkDeleteConfirmed = async () => {
    if (selectedRows.length === 0) {
      setDeleteModalOpen(false);
      return;
    }
    try {
      await Promise.all(selectedRows.map((row) => deleteExperiment(row.id)));
      queryClient.invalidateQueries({ queryKey: ['experiments', organisationId] });
      setDeleteModalOpen(false);
      setSelectedRowIds([]);
      setSelectedRows([]);
    } catch (err) {
      console.error('Failed to delete experiments:', err);
    }
  };

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h1>Experiment Results</h1>
          </div>
        </Col>
      </Row>

      <ExperimentsListMetricsDashboard experiments={Array.isArray(experimentsForDashboard) ? experimentsForDashboard : []} />

      <Row className="mt-3">
        <Col>
          <TableUsingAPI<Experiment>
            loadData={loadData}
            columns={columns}
            queryKeyPrefix={['experiments', organisationId]}
            searchPlaceholder="Search experiments (Gmail-style syntax)"
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/organisation/${organisationId}/experiment/${row.id}`)}
            enableRowSelection={true}
            bulkActionsToolbar={(ids, rows) => (
              <Button color="danger" size="sm" onClick={() => handleBulkDelete(ids, rows)} title="Delete selected experiments">
                <TrashIcon size={16} className="me-1" />
                Delete
              </Button>
            )}
          />
          <ConfirmDialog
            isOpen={deleteModalOpen}
            toggle={() => setDeleteModalOpen(false)}
            header="Delete selected experiments"
            body={`Are you sure you want to delete ${selectedRows.length} experiment(s)?`}
            onConfirm={handleBulkDeleteConfirmed}
            confirmButtonText="Delete"
            confirmButtonColor="danger"
          />
        </Col>
      </Row>
    </Container>
  );
};

export default ExperimentsListPage;