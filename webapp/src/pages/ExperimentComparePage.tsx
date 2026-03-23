import React, { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DeviceRotateIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Row, Col, Card, CardHeader, CardBody } from 'reactstrap';
import { getExperiment, getDataset, searchExamples } from '../api';
import type { Result } from '../common/types/Experiment';
import TableUsingAPI from '../components/generic/TableUsingAPI';
import type { ExtendedColumnDef } from '../components/generic/TableUsingAPI';
import LinkId from '../components/LinkId';
import Page from '../components/generic/Page';
import Spinner from '../components/generic/Spinner';
import { getExampleInput, getTruncatedDisplayString } from '../utils/example-utils';
import { durationString, formatMetricValue, prettyNumber } from '../utils/span-utils';
import { extractMetricValues, getMetricValue, getMetrics } from '../utils/metric-utils';
import type Metric from '../common/types/Metric';
import type Experiment from '../common/types/Experiment';

type CompareRow = {
  id: string;
  exampleId?: string;
  traceAId?: string;
  traceBId?: string;
  resultA?: Result;
  resultB?: Result;
};

const EXAMPLE_MAX_LEN = 100;

function getResultByExampleId(results?: Result[]): Record<string, Result> {
  const out: Record<string, Result> = {};
  for (const result of results || []) {
    if (result.example) out[result.example] = result;
  }
  return out;
}

function meanOfValues(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Relative % change of B vs baseline A: ((B - A) / A) * 100.
 * Returns null when either mean is missing, or when |A| is negligible vs scale (avoids div-by-zero).
 */
function percentDifferenceBVsA(meanA: number | null, meanB: number | null): number | null {
  if (meanA === null || meanB === null) return null;
  const scale = Math.max(Math.abs(meanA), Math.abs(meanB), Number.EPSILON);
  if (Math.abs(meanA) < 1e-12 * scale) return null;
  return ((meanB - meanA) / meanA) * 100;
}

function formatPercentDiff(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

type MetricOverviewRow = {
  metric: Metric;
  meanA: number | null;
  meanB: number | null;
};

const ExperimentComparePage: React.FC = () => {
  const { organisationId, experimentAId, experimentBId } = useParams<{
    organisationId: string;
    experimentAId: string;
    experimentBId: string;
  }>();

  const { data: experimentA, isLoading: isLoadingA, error: errorA } = useQuery({
    queryKey: ['experiment-compare', 'a', experimentAId],
    queryFn: () => getExperiment(experimentAId!),
    enabled: !!experimentAId,
  });
  const { data: experimentB, isLoading: isLoadingB, error: errorB } = useQuery({
    queryKey: ['experiment-compare', 'b', experimentBId],
    queryFn: () => getExperiment(experimentBId!),
    enabled: !!experimentBId,
  });

  const { data: datasetA } = useQuery({
    queryKey: ['dataset', experimentA?.dataset],
    queryFn: () => getDataset(experimentA!.dataset),
    enabled: !!experimentA?.dataset,
  });
  const { data: datasetB } = useQuery({
    queryKey: ['dataset', experimentB?.dataset],
    queryFn: () => getDataset(experimentB!.dataset),
    enabled: !!experimentB?.dataset,
  });

  const exampleIdsByDataset = useMemo(() => {
    const out: Record<string, string[]> = {};
    const addIds = (datasetId: string | undefined, results?: Result[]) => {
      if (!datasetId) return;
      const ids = (results || []).map((r) => r.example).filter(Boolean) as string[];
      if (ids.length === 0) return;
      out[datasetId] = [...new Set([...(out[datasetId] || []), ...ids])];
    };
    addIds(experimentA?.dataset, experimentA?.results);
    addIds(experimentB?.dataset, experimentB?.results);
    return out;
  }, [experimentA?.dataset, experimentA?.results, experimentB?.dataset, experimentB?.results]);

  const { data: examplesById } = useQuery({
    queryKey: ['compare-examples-by-id', organisationId, exampleIdsByDataset],
    queryFn: async () => {
      const byId: Record<string, any> = {};
      if (!organisationId) return byId;
      for (const [datasetId, exampleIds] of Object.entries(exampleIdsByDataset)) {
        if (!datasetId || exampleIds.length === 0) continue;
        const result = await searchExamples({
          organisationId,
          datasetId,
          query: `id:${exampleIds.join(' OR id:')}`,
          limit: Math.max(1000, exampleIds.length + 10),
          offset: 0,
        });
        for (const example of result.hits || []) byId[example.id] = example;
      }
      return byId;
    },
    enabled: !!organisationId && Object.values(exampleIdsByDataset).some((ids) => ids.length > 0),
  });

  const rows = useMemo<CompareRow[]>(() => {
    const resultsA = getResultByExampleId(experimentA?.results);
    const resultsB = getResultByExampleId(experimentB?.results);
    const allIds = [...new Set([...Object.keys(resultsA), ...Object.keys(resultsB)])].sort();
    return allIds.map((id) => ({
      id,
      exampleId: resultsA[id] ? id : resultsB[id] ? id : undefined,
      traceAId: resultsA[id] ? resultsA[id].trace : undefined,
      traceBId: resultsB[id] ? resultsB[id].trace : undefined,
      resultA: resultsA[id],
      resultB: resultsB[id],
    }));
  }, [experimentA?.results, experimentB?.results]);

  const metricById = useMemo(() => {
    const merged = [...getMetrics(datasetA as any), ...getMetrics(datasetB as any)];
    const byId: Record<string, any> = {};
    for (const m of merged) {
      if (!m?.id) continue;
      if (!byId[m.id]) byId[m.id] = m;
    }
    return byId;
  }, [datasetA, datasetB]);

  const metricColumns = useMemo<ExtendedColumnDef<CompareRow>[]>(() => {
    return Object.values(metricById).map((metric: any) => ({
      id: `metric-${metric.id}`,
      header: `Δ${metric.name || metric.id}`,
      accessorFn: (row: CompareRow) => {
        const a = row.resultA ? getMetricValue(row.resultA, metric) : null;
        const b = row.resultB ? getMetricValue(row.resultB, metric) : null;
        if (a === null || b === null) return null;
        return b - a;
      },
      cell: ({ row }: any) => {
        const a = row.original.resultA ? getMetricValue(row.original.resultA, metric) : null;
        const b = row.original.resultB ? getMetricValue(row.original.resultB, metric) : null;
        if (a === null || b === null) return <span className="text-muted">—</span>;
        if (metric.unit === 'ms') return <span>{durationString(b - a)}</span>;
        if (metric.unit === 's') return <span>{durationString(1000 * (b - a))}</span>;
        return <span>{prettyNumber(b - a)}</span>;
      },
      csvValue: (row: CompareRow) => {
        const a = row.resultA ? getMetricValue(row.resultA, metric) : null;
        const b = row.resultB ? getMetricValue(row.resultB, metric) : null;
        if (a === null || b === null) return '';
        return String(b - a);
      },
    }));
  }, [metricById]);

  const metricOverviewRows = useMemo<MetricOverviewRow[]>(() => {
    const list = Object.values(metricById) as Metric[];
    list.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    return list.map((metric) => ({
      metric,
      meanA: meanOfValues(extractMetricValues(metric, experimentA?.results)),
      meanB: meanOfValues(extractMetricValues(metric, experimentB?.results)),
    }));
  }, [metricById, experimentA?.results, experimentB?.results]);

  const columns = useMemo<ExtendedColumnDef<CompareRow>[]>(() => {
    const notTooBigStyle: React.CSSProperties = {
      maxWidth: '220px',
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      wordBreak: 'break-all',
      overflowWrap: 'anywhere',
    };
    const smallIdStyle: React.CSSProperties = {
      fontSize: '0.8rem',
      maxWidth: '150px',
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      wordBreak: 'break-all',
      overflowWrap: 'anywhere',
    };
    return [
      {
        id: 'example',
        header: 'Example',
        accessorFn: (row) => row.exampleId || '',
        cell: ({ row }) => {
          const eid = row.original.exampleId;
          if (!eid) return <span className="text-muted">—</span>;
          return <LinkId to={`/organisation/${organisationId}/example/${eid}`} id={eid} />;
        },
      },
      {
        id: 'trace-a',
        header: 'Trace A',
        accessorFn: (row) => row.traceAId || '',
        cell: ({ row }) => {
          const traceId = row.original.traceAId;
          if (!traceId) return <span className="text-muted">—</span>;
          return <LinkId to={`/organisation/${organisationId}/traces/${traceId}`} id={traceId} />;
        },
        style: smallIdStyle,
      },
      {
        id: 'trace-b',
        header: 'Trace B',
        accessorFn: (row) => row.traceBId || '',
        cell: ({ row }) => {
          const traceId = row.original.traceBId;
          if (!traceId) return <span className="text-muted">—</span>;
          return <LinkId to={`/organisation/${organisationId}/traces/${traceId}`} id={traceId} />;
        },
        style: smallIdStyle,
      },
      {
        id: 'input',
        header: 'Input',
        style: notTooBigStyle,
        accessorFn: (row) => {
          const eid = row.exampleId;
          return getTruncatedDisplayString(getExampleInput(eid ? examplesById?.[eid] : null), EXAMPLE_MAX_LEN);
        },
      },
      ...metricColumns,
    ];
  }, [examplesById, metricColumns, organisationId]);

  if (isLoadingA || isLoadingB) {
    return <Spinner centered />;
  }

  if (!experimentA || !experimentB || errorA || errorB) {
    return (
      <Page
        fluid={true}
        header="Compare Experiments"
        back={`/organisation/${organisationId}/experiment`}
        backLabel="Experiments List"
      >
        <div className="alert alert-danger mt-3">
          Failed to load experiments for comparison.
        </div>
      </Page>
    );
  }

  return (
    <Page
      fluid={true}
      header="Compare Experiments"
      back={`/organisation/${organisationId}/experiment`}
      backLabel="Experiments List"
    >
      <Row className="mb-3">
        <Col>
          <div className="d-flex align-items-start gap-2">
            <div className="flex-grow-1 min-w-0">
              <p className="mb-1"><strong>A:</strong> {experimentA.name || experimentA.id} (<code>{experimentA.id}</code>)</p>
              <p className="mb-0"><strong>B:</strong> {experimentB.name || experimentB.id} (<code>{experimentB.id}</code>)</p>
              <p className="text-muted mb-0">Metric delta is computed as B - A (negative means experiment B is lower).</p>
            </div>
            <Link
              to={`/organisation/${organisationId}/experiment/compare/${experimentBId}/v/${experimentAId}`}
              className="btn btn-sm btn-outline-secondary flex-shrink-0 p-1 lh-1"
              title="Swap A and B"
              aria-label="Swap A and B"
            >
              <DeviceRotateIcon size={18} aria-hidden />
            </Link>
          </div>
        </Col>
      </Row>
      <CompareOverview rows={metricOverviewRows} experimentA={experimentA} experimentB={experimentB} />
      <TableUsingAPI
        showSearch={false}
        data={{ hits: rows }}
        columns={columns}
        queryKeyPrefix={['experiment-compare', organisationId, experimentA.id, experimentB.id]}
      />
    </Page>
  );
};

function CompareOverview({ rows, experimentA, experimentB }: { rows: MetricOverviewRow[]; experimentA: Experiment; experimentB: Experiment }) {
  return (
    <Row className="mb-3">
      <Col>
        <Card>
          <CardHeader>
            <h5 className="mb-0">Compare Overview</h5>
          </CardHeader>
          <CardBody className="p-0">
            <div className="table-responsive">
              <table className="table table-sm table-bordered mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col" className="text-end">
                      Mean {experimentA.name || experimentA.id}
                    </th>
                    <th scope="col" className="text-end">
                      Mean {experimentB.name || experimentB.id}
                    </th>
                    <th scope="col" className="text-end">
                      % difference
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ metric, meanA, meanB }) => {
                    const pct = percentDifferenceBVsA(meanA, meanB);
                    return (
                    <tr key={metric.id}>
                      <td>{metric.name || metric.id}</td>
                      <td className="text-end">
                        {meanA != null ? formatMetricValue(metric, meanA) : '—'}
                      </td>
                      <td className="text-end">
                        {meanB != null ? formatMetricValue(metric, meanB) : '—'}
                      </td>
                      <td className="text-end">
                        {pct != null ? formatPercentDiff(pct) : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </Col>
    </Row>
  );
}

export default ExperimentComparePage;
