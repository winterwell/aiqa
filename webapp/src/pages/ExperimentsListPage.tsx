import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Row, Col } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { listExperiments, listDatasets } from '../api';
import type Experiment from '../common/types/Experiment';
import ExperimentsListMetricsDashboard from '../components/ExperimentListMetricsDashboard';
import TableUsingAPI, { ExtendedColumnDef, PageableData } from '../components/generic/TableUsingAPI';
import A from '../components/generic/A';
import { durationString, formatCost, prettyNumber } from '../utils/span-utils';

function getMetricMean(exp: Experiment, metricId: string): number | null {
  const summary = exp.summaries || {};
  const v = summary[metricId];
  if (v == null || typeof v !== 'object') return typeof v === 'number' && isFinite(v) ? v : null;
  const n = v.mean ?? v.avg ?? v.average ?? v.median;
  return n != null && isFinite(n) ? Number(n) : null;
}

function getOverallScore(exp: Experiment): number | null {
  const summary = exp.summaries || {};
  const overallScore = summary['Overall Score'];
  return overallScore?.mean ?? overallScore?.avg ?? overallScore?.average ?? null;
}

const ExperimentsListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();

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
      cell: ({ row }) => {
        const id = row.original.dataset;
        const name = datasetNameById.get(id);
        return name ? `${name} | ${id}` : id;
      },
      csvValue: (row) => {
        const id = row.dataset;
        const name = datasetNameById.get(id);
        return name ? `${name} | ${id}` : id;
      },
      enableSorting: true,
    },
    {
      id: 'exampleCount',
      header: 'Examples',
      accessorFn: (row) => row.summaries?.duration?.count ?? 0,
      csvValue: (row) => {
        return row.summaries?.duration?.count ?? 0;
      },
    },
    // { TODO
    //   id: 'errors',
    //   header: 'Errors',
    //   accessorFn: (row) => getMetricMean(row, 'errors'),
    //   cell: ({ row }) => {
    //     const v = getMetricMean(row.original, 'errors');
    //     return v != null ? prettyNumber(v) : '-';
    //   },
    //   csvValue: (row) => {
    //     const v = getMetricMean(row, 'errors');
    //     return v != null ? String(v) : '';
    //   },
    //   enableSorting: true,
    // },
    // {
    //   id: 'overallScore',
    //   header: 'Overall Score',
    //   accessorFn: (row) => getOverallScore(row),
    //   cell: ({ row }) => {
    //     const v = getOverallScore(row.original);
    //     return v !== null && isFinite(v) ? v.toFixed(2) : '-';
    //   },
    //   csvValue: (row) => {
    //     const v = getOverallScore(row);
    //     return v !== null && isFinite(v) ? String(v) : '';
    //   },
    //   enableSorting: true,
    // },
    {
      id: 'specific',
      header: 'Specific Evals',
      accessorFn: (row) => getMetricMean(row, 'specific'),
      cell: ({ row }) => {
        const v = getMetricMean(row.original, 'specific');
        return v != null ? (100*v).toFixed(1) : '-';
      },
      csvValue: (row) => {
        const v = getMetricMean(row, 'specific');
        return v != null ? String(100*v) : '';
      },
      enableSorting: true,
    },
    {
      id: 'duration',
      header: 'Duration (avg)',
      accessorFn: (row) => getMetricMean(row, 'duration'),
      cell: ({ row }) => {
        const ms = getMetricMean(row.original, 'duration');
        return ms != null ? durationString(ms) : '-';
      },
      csvValue: (row) => {
        const ms = getMetricMean(row, 'duration');
        return ms != null ? String(ms) : '';
      },
      enableSorting: true,
    },
    {
      id: 'tokensPerExample',
      header: 'Tokens (avg)',
      accessorFn: (row) => getMetricMean(row, 'gen_ai.usage.total_tokens'),
      cell: ({ row }) => {
        const v = getMetricMean(row.original, 'gen_ai.usage.total_tokens');
        return v != null ? prettyNumber(v) : '-';
      },
      csvValue: (row) => {
        const v = getMetricMean(row, 'gen_ai.usage.total_tokens');
        return v != null ? String(v) : '';
      },
      enableSorting: true,
    },
    {
      id: 'costPerExample',
      header: 'Cost (avg)',
      accessorFn: (row) => getMetricMean(row, 'gen_ai.cost.usd'),
      cell: ({ row }) => {
        const v = getMetricMean(row.original, 'gen_ai.cost.usd');
        return v != null ? formatCost(v) : '-';
      },
      csvValue: (row) => {
        const v = getMetricMean(row, 'gen_ai.cost.usd');
        return v != null ? String(v) : '';
      },
      enableSorting: true,
    },
  ], [organisationId, datasetNameById]);

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
            onRowClick={(row) => navigate(`/organisation/${organisationId}/experiment/${row.id}`)}
          />
        </Col>
      </Row>
    </Container>
  );
};

export default ExperimentsListPage;