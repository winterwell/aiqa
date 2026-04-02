import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CaretDown, CaretUp, DeviceRotateIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Row, Col, Card, CardHeader, CardBody, Collapse, Button } from 'reactstrap';
import { getDataset, listAllExamplesInDataset } from '../api';
import type { Dataset, Example } from '../common/types';
import Metric, { isExampleSpecificMetric } from '../common/types/Metric';
import LinkId from '../components/LinkId';
import Page from '../components/generic/Page';
import Spinner from '../components/generic/Spinner';
import TableUsingAPI, { ExtendedColumnDef } from '../components/generic/TableUsingAPI';
import { asArray, truncate } from '../common/utils/miscutils';
import { SPECIFIC_METRIC } from '../common/defaultSystemMetrics';
import {
  getExampleInput,
  getTruncatedDisplayString,
  getFirstSpan,
  getExampleSpecificMetricText,
} from '../utils/example-utils';
import { compareDatasetMetrics } from '../utils/datasetCompare';
import { MIN_PAIR_SIMILARITY, type SemanticExampleHit } from '../utils/similarity';
import {
  matchExamplesOneToOneAsync,
  type ExampleMatchResult,
  type ExampleMatchProgress,
} from '../utils/exampleMatching';
import {
  compactWhitespace,
  DIFF_TRUNCATION_ELLIPSIS,
  PAIR_DIFF_DISPLAY_MAX_CHARS,
  samePairTextFold,
  shrinkPairDiffForDisplay,
  splitMiddleDiffCaseInsensitive,
} from '../utils/textMiddleDiff';

function datasetLabel(d: Dataset | undefined): string {
  if (!d) return '—';
  return d.name || d.id;
}

/** Same display logic as DatasetDetailsPage "Name" column. */
function exampleDisplayName(example: Example): string | undefined {
  if (example.name) return example.name;
  if (example.input) return truncate(example.input, 100);
  const span = getFirstSpan(example);
  if (span?.name) return truncate(span.name, 100);
  return undefined;
}

function mergedExampleSpecificMetrics(datasetA: Dataset, datasetB: Dataset): Metric[] {
  const a = (asArray(datasetA.metrics) as Metric[]).filter(isExampleSpecificMetric);
  const b = (asArray(datasetB.metrics) as Metric[]).filter(isExampleSpecificMetric);
  const byId = new Map<string, Metric>();
  for (const m of [...a, ...b]) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }
  if (![...byId.values()].find((m) => m.id === SPECIFIC_METRIC.id)) {
    byId.set(SPECIFIC_METRIC.id, SPECIFIC_METRIC);
  }
  return [...byId.values()].sort((x, y) => String(x.name || x.id).localeCompare(String(y.name || y.id)));
}

function exampleSpecificMetricsForOneDataset(dataset: Dataset): Metric[] {
  const esms = (asArray(dataset.metrics) as Metric[]).filter(isExampleSpecificMetric);
  if (!esms.find((m) => m.id === SPECIFIC_METRIC.id)) {
    esms.push(SPECIFIC_METRIC);
  }
  return esms.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

function tagBadges(tags?: string[]) {
  if (!tags?.length) {
    return <span className="text-muted">—</span>;
  }
  return (
    <>
      {tags.map((t) => (
        <span key={t} className="badge bg-secondary me-1">
          {t}
        </span>
      ))}
    </>
  );
}

export type ExamplePairRow = { exampleA: Example; exampleB: Example };

export type SemanticExamplePairRow = ExamplePairRow & { score: number };

/** Side-by-side middle diff (case-folded prefix/suffix); one line when texts match ignoring case. */
function PairValueDiff({
  a,
  b,
  title,
  maxDisplayChars = PAIR_DIFF_DISPLAY_MAX_CHARS,
}: {
  a: string;
  b: string;
  title?: string;
  /** Max combined character count for both lines (ellipsis excluded from budget roughly). */
  maxDisplayChars?: number;
}) {
  const aN = compactWhitespace(a ?? '');
  const bN = compactWhitespace(b ?? '');
  if (!aN && !bN) return <span className="text-muted">—</span>;
  if (samePairTextFold(aN, bN)) {
    const single = aN || bN;
    const shown =
      single.length <= maxDisplayChars
        ? single
        : `${DIFF_TRUNCATION_ELLIPSIS}${single.slice(-(maxDisplayChars - 1))}`;
    return (
      <span className="text-break" title={title ?? (single.length > maxDisplayChars ? single : undefined)}>
        {shown}
      </span>
    );
  }
  const { pre, suf } = splitMiddleDiffCaseInsensitive(aN, bN);
  const na = aN.length;
  const nb = bN.length;
  const prefA = aN.slice(0, pre);
  const prefB = bN.slice(0, pre);
  const midA = aN.slice(pre, na - suf);
  const midB = bN.slice(pre, nb - suf);
  const sufA = aN.slice(na - suf);
  const sufB = bN.slice(nb - suf);
  const d = shrinkPairDiffForDisplay(
    { prefA, prefB, midA, sufA, midB, sufB },
    maxDisplayChars,
  );
  const markMid = (s: string) => (s ? <mark className="px-0">{s}</mark> : null);
  const lineA = (
    <>
      {d.prefA}
      {markMid(d.midA)}
      {d.sufA}
    </>
  );
  const lineB = (
    <>
      {d.prefB}
      {markMid(d.midB)}
      {d.sufB}
    </>
  );
  const emptyA = !d.prefA && !d.midA && !d.sufA;
  const emptyB = !d.prefB && !d.midB && !d.sufB;
  return (
    <div className="text-break small" title={title}>
      <div>{emptyA ? <span className="text-muted">—</span> : lineA}</div>
      <div className="text-muted mt-1">{emptyB ? <span className="text-muted">—</span> : lineB}</div>
    </div>
  );
}

function buildExamplePairColumns(
  organisationId: string,
  datasetA: Dataset,
  datasetB: Dataset,
  labelA: string,
  labelB: string,
): ExtendedColumnDef<ExamplePairRow>[] {
  const specificMetrics = mergedExampleSpecificMetrics(datasetA, datasetB);
  const idHeaderA = `ID (${labelA})`;
  const idHeaderB = `ID (${labelB})`;

  return [
    {
      id: 'index',
      header: '#',
      accessorFn: (_row, index) => index + 1,
      enableColumnFilter: false,
      includeInCSV: false,
    },
    {
      id: 'idA',
      header: idHeaderA,
      accessorFn: (row) => row.exampleA.id,
      cell: ({ row }) => (
        <LinkId to={`/organisation/${organisationId}/example/${row.original.exampleA.id}`} id={row.original.exampleA.id} />
      ),
      csvValue: (row) => row.exampleA.id,
      style: { maxWidth: 140 },
    },
    {
      id: 'idB',
      header: idHeaderB,
      accessorFn: (row) => row.exampleB.id,
      cell: ({ row }) => (
        <LinkId to={`/organisation/${organisationId}/example/${row.original.exampleB.id}`} id={row.original.exampleB.id} />
      ),
      csvValue: (row) => row.exampleB.id,
      style: { maxWidth: 140 },
    },
    {
      id: 'name',
      header: 'Name',
      accessorFn: (row) => exampleDisplayName(row.exampleA) ?? '',
      cell: ({ row }) => {
        const a = exampleDisplayName(row.original.exampleA) ?? '';
        const b = exampleDisplayName(row.original.exampleB) ?? '';
        return <PairValueDiff a={a} b={b} />;
      },
      csvValue: (row) => exampleDisplayName(row.exampleA) ?? '',
    },
    {
      id: 'input',
      header: 'Input',
      accessorFn: (row) => getTruncatedDisplayString(getExampleInput(row.exampleA), 200),
      cell: ({ row }) => {
        const ia = getExampleInput(row.original.exampleA);
        const ib = getExampleInput(row.original.exampleB);
        const sa = getTruncatedDisplayString(ia, 120);
        const sb = getTruncatedDisplayString(ib, 120);
        const fullA = getTruncatedDisplayString(ia, 500_000);
        const fullB = getTruncatedDisplayString(ib, 500_000);
        const title =
          fullA !== sa || fullB !== sb ? `A:\n${fullA}\n---\nB:\n${fullB}` : undefined;
        return <PairValueDiff a={sa} b={sb} title={title} />;
      },
      style: { minWidth: 160, maxWidth: 320 },
    },
    ...specificMetrics.map(
      (m): ExtendedColumnDef<ExamplePairRow> => ({
        id: `specific-${m.id}`,
        header: m.name || m.id,
        csvValue: (row) => {
          const ta = getExampleSpecificMetricText(row.exampleA, m.id);
          const tb = getExampleSpecificMetricText(row.exampleB, m.id);
          return [ta, tb].filter(Boolean).join(' | ');
        },
        cell: ({ row }) => {
          const ta = getExampleSpecificMetricText(row.original.exampleA, m.id);
          const tb = getExampleSpecificMetricText(row.original.exampleB, m.id);
          if (!ta && !tb) return <span className="text-muted">—</span>;
          const sa = getTruncatedDisplayString(ta, 100);
          const sb = getTruncatedDisplayString(tb, 100);
          const title =
            ta !== sa || tb !== sb ? [ta && `A:\n${ta}`, tb && `B:\n${tb}`].filter(Boolean).join('\n---\n') : undefined;
          return <PairValueDiff a={sa} b={sb} title={title} />;
        },
        style: { minWidth: 120 },
      }),
    ),
    {
      id: 'createdA',
      header: `Created (${labelA})`,
      accessorFn: (row) => (row.exampleA.created ? new Date(row.exampleA.created).getTime() : 0),
      cell: ({ row }) =>
        row.original.exampleA.created ? (
          new Date(row.original.exampleA.created).toLocaleString()
        ) : (
          <span className="text-muted">—</span>
        ),
      csvValue: (row) => (row.exampleA.created ? new Date(row.exampleA.created).toISOString() : ''),
      type: 'date',
    },
    {
      id: 'createdB',
      header: `Created (${labelB})`,
      accessorFn: (row) => (row.exampleB.created ? new Date(row.exampleB.created).getTime() : 0),
      cell: ({ row }) =>
        row.original.exampleB.created ? (
          new Date(row.original.exampleB.created).toLocaleString()
        ) : (
          <span className="text-muted">—</span>
        ),
      csvValue: (row) => (row.exampleB.created ? new Date(row.exampleB.created).toISOString() : ''),
      type: 'date',
    },
    {
      id: 'tags',
      header: 'Tags',
      accessorFn: (row) => (row.exampleA.tags?.[0] ? row.exampleA.tags[0] : ''),
      cell: ({ row }) => {
        const a = row.original.exampleA.tags;
        const b = row.original.exampleB.tags;
        const same =
          JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
        if (same) return tagBadges(a);
        return (
          <div className="small">
            <div className="text-muted">A</div>
            {tagBadges(a)}
            <div className="text-muted mt-1">B</div>
            {tagBadges(b)}
          </div>
        );
      },
      csvValue: (row) => [row.exampleA.tags?.join(' + '), row.exampleB.tags?.join(' + ')].filter(Boolean).join(' | '),
    },
    {
      id: 'notes',
      header: 'Notes',
      accessorFn: (row) => row.exampleA.notes ?? '',
      cell: ({ row }) => {
        const na = row.original.exampleA.notes ?? '';
        const nb = row.original.exampleB.notes ?? '';
        return <PairValueDiff a={na} b={nb} />;
      },
      csvValue: (row) => [row.exampleA.notes, row.exampleB.notes].filter(Boolean).join(' | '),
    },
  ];
}

function buildSemanticPairColumns(
  organisationId: string,
  datasetA: Dataset,
  datasetB: Dataset,
  labelA: string,
  labelB: string,
): ExtendedColumnDef<SemanticExamplePairRow>[] {
  const base = buildExamplePairColumns(organisationId, datasetA, datasetB, labelA, labelB) as unknown as ExtendedColumnDef<SemanticExamplePairRow>[];
  const simCol: ExtendedColumnDef<SemanticExamplePairRow> = {
    id: 'similarity',
    header: 'Similarity',
    accessorFn: (row) => row.score,
    cell: ({ row }) => <span className="text-nowrap">{(row.original.score * 100).toFixed(1)}%</span>,
    csvValue: (row) => String(row.score),
    enableSorting: true,
  };
  return [...base.slice(0, 3), simCol, ...base.slice(3)];
}

function buildExampleSoloColumns(organisationId: string, dataset: Dataset, label: string): ExtendedColumnDef<Example>[] {
  const specificMetrics = exampleSpecificMetricsForOneDataset(dataset);
  const idHeader = `ID (${label})`;

  return [
    {
      id: 'index',
      header: '#',
      accessorFn: (_row, index) => index + 1,
      enableColumnFilter: false,
      includeInCSV: false,
    },
    {
      id: 'id',
      header: idHeader,
      accessorKey: 'id',
      cell: ({ row }) => (
        <LinkId to={`/organisation/${organisationId}/example/${row.original.id}`} id={row.original.id} />
      ),
      csvValue: (row) => row.id,
      style: { maxWidth: 140 },
    },
    {
      id: 'name',
      header: 'Name',
      accessorFn: (ex) => exampleDisplayName(ex) ?? '',
      cell: ({ row }) => exampleDisplayName(row.original) || <span className="text-muted">—</span>,
      csvValue: (row) => exampleDisplayName(row) ?? '',
    },
    {
      id: 'input',
      header: 'Input',
      accessorFn: (ex) => getTruncatedDisplayString(getExampleInput(ex), 200),
      cell: ({ row }) => (
        <span className="small">{getTruncatedDisplayString(getExampleInput(row.original), 120) || '—'}</span>
      ),
      style: { minWidth: 160, maxWidth: 320 },
    },
    ...specificMetrics.map(
      (m): ExtendedColumnDef<Example> => ({
        id: `specific-${m.id}`,
        header: m.name || m.id,
        csvValue: (row) => getExampleSpecificMetricText(row, m.id),
        cell: ({ row }) => {
          const text = getExampleSpecificMetricText(row.original, m.id);
          if (!text) return <span className="text-muted">—</span>;
          return (
            <span className="small" title={text}>
              {getTruncatedDisplayString(text, 100)}
            </span>
          );
        },
        style: { minWidth: 120 },
      }),
    ),
    {
      id: 'created',
      header: 'Created',
      accessorFn: (row) => (row.created ? new Date(row.created).getTime() : 0),
      cell: ({ row }) =>
        row.original.created ? new Date(row.original.created).toLocaleString() : <span className="text-muted">—</span>,
      csvValue: (row) => (row.created ? new Date(row.created).toISOString() : ''),
      type: 'date',
    },
    {
      id: 'tags',
      header: 'Tags',
      accessorFn: (row) => (row.tags?.[0] ? row.tags[0] : ''),
      cell: ({ row }) => tagBadges(row.original.tags),
      csvValue: (row) => row.tags?.join(' + ') ?? '',
    },
    {
      id: 'notes',
      header: 'Notes',
      accessorKey: 'notes',
      cell: ({ row }) => row.original.notes || <span className="text-muted">—</span>,
      csvValue: (row) => row.notes ?? '',
    },
  ];
}

function CollapsibleCardFrame({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Card className={className}>
      <CardHeader className="d-flex align-items-start justify-content-between gap-2 py-2">
        <div className="flex-grow-1 min-w-0">
          <h6 className="mb-0">{title}</h6>
          {subtitle != null && subtitle !== '' && <div className="small text-muted mt-1">{subtitle}</div>}
        </div>
        <Button
          type="button"
          color="secondary"
          outline
          size="sm"
          className="flex-shrink-0"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse section' : 'Expand section'}
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? <CaretUp size={18} aria-hidden /> : <CaretDown size={18} aria-hidden />}
        </Button>
      </CardHeader>
      <Collapse isOpen={open}>{children}</Collapse>
    </Card>
  );
}

function ExampleCompareTableCard<T>({
  title,
  subtitle,
  hits,
  columns,
  queryKeySuffix,
  organisationId,
  getRowId,
  onRowClick,
}: {
  title: string;
  subtitle?: React.ReactNode;
  hits: T[];
  columns: ExtendedColumnDef<T>[];
  queryKeySuffix: string;
  organisationId: string;
  getRowId: (row: T) => string;
  onRowClick: (row: T) => void;
}) {
  const n = hits.length;
  const titleWithCount = `${title} (${n})`;
  return (
    <CollapsibleCardFrame title={titleWithCount} subtitle={subtitle} className="mb-3">
      <CardBody className="p-0">
        <TableUsingAPI<T>
          key={`${queryKeySuffix}-${hits.length}`}
          freezeRows={1}
          data={{ hits }}
          columns={columns}
          showSearch={false}
          pageSize={50}
          enableInMemoryFiltering={true}
          queryKeyPrefix={['dataset-compare-examples', organisationId, queryKeySuffix, `n${hits.length}`]}
          getRowId={getRowId}
          onRowClick={onRowClick}
          csvFilenamePrefix={`dataset-compare-${queryKeySuffix}`}
        />
      </CardBody>
    </CollapsibleCardFrame>
  );
}

function MetricCompareCard({
  title,
  pairs,
  solo,
}: {
  title: string;
  pairs?: { metricA: Metric; metricB: Metric }[];
  solo?: Metric[];
}) {
  return (
    <CollapsibleCardFrame title={title} className="h-100">
      <CardBody className="pt-2">
        {pairs && pairs.length > 0 && (
          <ul className="list-unstyled mb-0 small">
            {pairs.map((p, idx) => (
              <li key={idx} className="border-bottom py-2">
                <div>
                  <span className="text-muted me-1">A:</span>
                  <strong>{p.metricA.name || p.metricA.id}</strong>
                  <code className="ms-1 text-muted">{p.metricA.id}</code>
                </div>
                <div>
                  <span className="text-muted me-1">B:</span>
                  <strong>{p.metricB.name || p.metricB.id}</strong>
                  <code className="ms-1 text-muted">{p.metricB.id}</code>
                </div>
              </li>
            ))}
          </ul>
        )}
        {solo && solo.length > 0 && (
          <ul className="list-unstyled mb-0 small">
            {solo.map((m) => (
              <li key={m.id} className="border-bottom py-2">
                <strong>{m.name || m.id}</strong>
                <code className="ms-1 text-muted">{m.id}</code>
              </li>
            ))}
          </ul>
        )}
        {(!pairs || pairs.length === 0) && (!solo || solo.length === 0) && (
          <p className="text-muted small mb-0">None</p>
        )}
      </CardBody>
    </CollapsibleCardFrame>
  );
}

const DatasetComparePage: React.FC = () => {
  const navigate = useNavigate();
  const { organisationId, datasetAId, datasetBId } = useParams<{
    organisationId: string;
    datasetAId: string;
    datasetBId: string;
  }>();

  const { data: datasetA, isLoading: loadingA, error: errorA } = useQuery({
    queryKey: ['dataset', datasetAId],
    queryFn: () => getDataset(datasetAId!),
    enabled: !!datasetAId,
  });
  const { data: datasetB, isLoading: loadingB, error: errorB } = useQuery({
    queryKey: ['dataset', datasetBId],
    queryFn: () => getDataset(datasetBId!),
    enabled: !!datasetBId,
  });

  const { data: examplesA = [], isLoading: loadingExA } = useQuery({
    queryKey: ['dataset-compare-examples', organisationId, datasetAId],
    queryFn: () => listAllExamplesInDataset(organisationId!, datasetAId!),
    enabled: !!organisationId && !!datasetAId,
  });
  const { data: examplesB = [], isLoading: loadingExB } = useQuery({
    queryKey: ['dataset-compare-examples', organisationId, datasetBId],
    queryFn: () => listAllExamplesInDataset(organisationId!, datasetBId!),
    enabled: !!organisationId && !!datasetBId,
  });

  const metricCompare = useMemo(() => {
    const ma = asArray(datasetA?.metrics) as Metric[];
    const mb = asArray(datasetB?.metrics) as Metric[];
    return compareDatasetMetrics(ma, mb);
  }, [datasetA?.metrics, datasetB?.metrics]);

  const nameA = datasetLabel(datasetA);
  const nameB = datasetLabel(datasetB);

  const pairColumns = useMemo(
    () =>
      datasetA && datasetB && organisationId
        ? buildExamplePairColumns(organisationId, datasetA, datasetB, nameA, nameB)
        : [],
    [organisationId, datasetA, datasetB, nameA, nameB],
  );

  const soloColumnsA = useMemo(
    () => (datasetA && organisationId ? buildExampleSoloColumns(organisationId, datasetA, nameA) : []),
    [organisationId, datasetA, nameA],
  );

  const soloColumnsB = useMemo(
    () => (datasetB && organisationId ? buildExampleSoloColumns(organisationId, datasetB, nameB) : []),
    [organisationId, datasetB, nameB],
  );

  const semanticPairColumns = useMemo(
    () =>
      datasetA && datasetB && organisationId
        ? buildSemanticPairColumns(organisationId, datasetA, datasetB, nameA, nameB)
        : [],
    [organisationId, datasetA, datasetB, nameA, nameB],
  );

  const [exampleMatch, setExampleMatch] = useState<ExampleMatchResult | null>(null);
  const [matchProgress, setMatchProgress] = useState<{
    phase: 'idle' | 'equality' | 'similarity' | 'done' | 'error';
    similarityEvaluated?: number;
    similarityTotal?: number;
    error?: string;
  }>({ phase: 'idle' });

  const matchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!organisationId) return;
    matchAbortRef.current?.abort();
    const ac = new AbortController();
    matchAbortRef.current = ac;
    setExampleMatch(null);
    setMatchProgress({ phase: 'equality' });

    let cancelled = false;

    (async () => {
      try {
        const result = await matchExamplesOneToOneAsync(examplesA, examplesB, {
          signal: ac.signal,
          yieldMs: 0,
          onEqualityDone: ({ identical, remainingA, remainingB }) => {
            if (cancelled) return;
            setExampleMatch({
              identical,
              similar: [],
              onlyA: remainingA,
              onlyB: remainingB,
            });
            const total = remainingA.length * remainingB.length;
            setMatchProgress({
              phase: 'similarity',
              similarityEvaluated: 0,
              similarityTotal: total,
            });
          },
          onProgress: (p: ExampleMatchProgress) => {
            if (cancelled) return;
            if (p.phase === 'equality') {
              setMatchProgress({ phase: 'equality' });
            } else {
              setMatchProgress({
                phase: 'similarity',
                similarityEvaluated: p.evaluated,
                similarityTotal: p.total,
              });
            }
          },
          onSimilarPair: (hit) => {
            if (cancelled) return;
            setExampleMatch((prev) => {
              if (!prev) return null;
              const onlyA = prev.onlyA.filter((x) => x.id !== hit.exampleA.id);
              const onlyB = prev.onlyB.filter((x) => x.id !== hit.exampleB.id);
              const similar = [...prev.similar, hit].sort((a, b) => b.score - a.score);
              return { ...prev, onlyA, onlyB, similar };
            });
          },
        });
        if (cancelled || ac.signal.aborted) return;
        setExampleMatch(result);
        setMatchProgress({ phase: 'done' });
      } catch (e) {
        if (!ac.signal.aborted) {
          setMatchProgress({
            phase: 'error',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [organisationId, datasetAId, datasetBId, examplesA, examplesB]);

  const goExample = (id: string) => {
    if (organisationId && id) navigate(`/organisation/${organisationId}/example/${id}`);
  };

  if (loadingA || loadingB || loadingExA || loadingExB) {
    return <Spinner centered />;
  }

  if (!datasetA || !datasetB || errorA || errorB) {
    return (
      <Page
        fluid={true}
        header="Compare Datasets"
        back={`/organisation/${organisationId}/dataset`}
        backLabel="Datasets"
      >
        <div className="alert alert-danger mt-3">Failed to load datasets for comparison.</div>
      </Page>
    );
  }

  return (
    <Page
      fluid={true}
      header="Compare Datasets"
      back={`/organisation/${organisationId}/dataset`}
      backLabel="Datasets"
    >
      <Row className="mb-3">
        <Col>
          <div className="d-flex align-items-start gap-2">
            <div className="flex-grow-1 min-w-0">
              <p className="mb-1">
                <strong>A:</strong> {nameA} (
                <Link to={`/organisation/${organisationId}/dataset/${datasetA.id}`}>{datasetA.id}</Link>)
              </p>
              <p className="mb-0">
                <strong>B:</strong> {nameB} (
                <Link to={`/organisation/${organisationId}/dataset/${datasetB.id}`}>{datasetB.id}</Link>)
              </p>
              <p className="text-muted small mb-0 mt-2">
                Identical metrics match by full definition (ignoring id). Similar metrics share the same name with different
                settings. Example matching is 1:1: structural equality first (ignoring id and metrics), then embedding
                similarity (MiniLM) on remaining pairs, highest scores first, minimum {(MIN_PAIR_SIMILARITY * 100).toFixed(0)}%
                to pair. Each example appears in at most one of identical, similar, A-only, or B-only.
              </p>
            </div>
            <Link
              to={`/organisation/${organisationId}/dataset/compare/${datasetBId}/v/${datasetAId}`}
              className="btn btn-sm btn-outline-secondary flex-shrink-0 p-1 lh-1"
              title="Swap A and B"
              aria-label="Swap A and B"
            >
              <DeviceRotateIcon size={18} aria-hidden />
            </Link>
          </div>
        </Col>
      </Row>

      <h5 className="mt-4 mb-3">Metrics</h5>
      <Row className="g-3 mb-4">
        <Col md={6} lg={3}>
          <MetricCompareCard title="Identical metrics" pairs={metricCompare.identical} />
        </Col>
        <Col md={6} lg={3}>
          <MetricCompareCard title="Similar metrics" pairs={metricCompare.similar} />
        </Col>
        <Col md={6} lg={3}>
          <MetricCompareCard title={`Metrics in ${nameA} only`} solo={metricCompare.onlyA} />
        </Col>
        <Col md={6} lg={3}>
          <MetricCompareCard title={`Metrics in ${nameB} only`} solo={metricCompare.onlyB} />
        </Col>
      </Row>

      <h5 className="mb-3">Examples</h5>
      <Row>
        <Col xs={12}>
        <ExampleCompareTableCard<ExamplePairRow>
          title="Identical examples (apart from id)"
          hits={exampleMatch?.identical ?? []}
          columns={pairColumns}
          queryKeySuffix={`identical-${datasetAId}-${datasetBId}`}
          organisationId={organisationId!}
          getRowId={(row) => `${row.exampleA.id}-${row.exampleB.id}`}
          onRowClick={(row) => goExample(row.exampleA.id)}
        />
        <ExampleCompareTableCard<SemanticExamplePairRow>
          title="Similar examples (semantic)"
          subtitle={
            matchProgress.phase === 'error'
              ? `Error: ${matchProgress.error}`
              : matchProgress.phase === 'equality'
                ? 'Computing equality…'
                : matchProgress.similarityTotal === 0
                  ? 'No candidate pairs after equality (one side empty).'
                  : `${matchProgress.similarityEvaluated ?? 0}/${matchProgress.similarityTotal ?? 0} pair evaluations · MiniLM · min pair ${(MIN_PAIR_SIMILARITY * 100).toFixed(0)}%${matchProgress.phase === 'done' ? ' · done' : ''}${(exampleMatch?.similar.length ?? 0) > 0 ? ` · ${exampleMatch?.similar.length} match(es)` : ''}`
          }
          hits={exampleMatch?.similar ?? []}
          columns={semanticPairColumns}
          queryKeySuffix={`similar-semantic-${datasetAId}-${datasetBId}`}
          organisationId={organisationId!}
          getRowId={(row) => `${row.exampleA.id}-${row.exampleB.id}`}
          onRowClick={(row) => goExample(row.exampleA.id)}
        />
        <ExampleCompareTableCard<Example>
          title={`Examples in ${nameA} only`}
          hits={exampleMatch?.onlyA ?? []}
          columns={soloColumnsA}
          queryKeySuffix={`only-a-${datasetAId}-${datasetBId}`}
          organisationId={organisationId!}
          getRowId={(row) => row.id}
          onRowClick={(row) => goExample(row.id)}
        />
        <ExampleCompareTableCard<Example>
          title={`Examples in ${nameB} only`}
          hits={exampleMatch?.onlyB ?? []}
          columns={soloColumnsB}
          queryKeySuffix={`only-b-${datasetAId}-${datasetBId}`}
          organisationId={organisationId!}
          getRowId={(row) => row.id}
          onRowClick={(row) => goExample(row.id)}
        />
        </Col>
      </Row>
    </Page>
  );
};

export default DatasetComparePage;
