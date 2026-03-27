import React, { useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { getExperiment, getDataset, deleteExperiment, searchExamplesByIds, updateExperiment } from '../api';
import Experiment, { Result } from '../common/types/Experiment';
import type Dataset from '../common/types/Dataset';
import type Example from '../common/types/Example';
import TableUsingAPI, { categoricalOrRowFilter } from '../components/generic/TableUsingAPI';
import { useToast } from '../utils/toast';
import ExperimentDetailsDashboard from '../components/ExperimentDetailsDashboard';
import NameAndDeleteHeader from '../components/generic/NameAndDeleteHeader';
import Page from '../components/generic/Page';
import Spinner from '../components/generic/Spinner';
import type { ExtendedColumnDef } from '../components/generic/TableUsingAPI';
import { durationString, formatCost, prettyNumber } from '../utils/span-utils';
import { getMetricValue, getMetrics } from '../utils/metric-utils';
import { COST_METRIC_ID, DURATION_METRIC_ID, SPAN_COUNT_METRIC_ID, TIME_TO_FIRST_TOKEN_METRIC_ID, TOTAL_TOKENS_METRIC_ID } from '../common/defaultSystemMetrics';
import LinkId from '../components/LinkId';
import { getTruncatedDisplayString, getExampleInput } from '../utils/example-utils';
import { getSpanOutput } from '../common/types/Span';
import { useRootSpansForTraces } from '../hooks/useSpanData';
import ExpandCollapseControl from '../components/generic/ExpandCollapseControl';
import { GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, GEN_AI_USAGE_INPUT_TOKENS, GEN_AI_USAGE_OUTPUT_TOKENS } from 'src/common/constants_otel';

const TRACE_OUTPUT_MAX_LEN = 100;

/** Truncated output string for a trace; looks up from pre-loaded outputByTrace map (root span output, same as ExampleDetailsPage). */
function getTraceOutput(traceId?: string, outputByTrace?: Map<string, string>): string {
  if (!traceId) return '';
  return outputByTrace?.get(traceId) ?? '';
}

const ExperimentDetailsPage: React.FC = () => {
  const { organisationId, experimentId } = useParams<{
    organisationId: string;
    experimentId: string;
  }>();

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: experiment, isLoading, error } = useQuery({
    queryKey: ['experiment', experimentId],
    queryFn: () => getExperiment(experimentId!),
    enabled: !!experimentId,
  });
  let datasetId = experiment?.dataset;

  const { data: dataset } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  const deleteExperimentMutation = useMutation({
    mutationFn: () => deleteExperiment(experimentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments', organisationId] });
      queryClient.invalidateQueries({ queryKey: ['experiment', experimentId] });
      showToast('Experiment deleted successfully', 'success');
      navigate(`/organisation/${organisationId}/dataset/${datasetId}`);
    },
    onError: (error: Error) => {
      showToast(`Failed to delete experiment: ${error.message}`, 'error');
    },
  });

  const exampleIds = useMemo(() => {
    return (experiment?.results ?? []).map((result: any) => result.example).filter(Boolean) as string[];
  }, [experiment?.results]);

  const examplesQueryKey = useMemo(() => {
    // react-query needs the key to change once `experiment` is loaded,
    // otherwise we can get stuck with an early "empty" fetch result.
    return ['examples-by-id', organisationId, datasetId, ...exampleIds] as const;
  }, [organisationId, datasetId, exampleIds]);

  const { data: examples } = useQuery({
    queryKey: examplesQueryKey,
    queryFn: () =>
      exampleIds.length === 0
        ? Promise.resolve({} as Record<string, Example>)
        : searchExamplesByIds({
            organisationId: organisationId!,
            datasetId: datasetId!,
            ids: exampleIds,
          }),
    enabled: Boolean(organisationId) && Boolean(datasetId) && exampleIds.length > 0,
  });

  // TanStack Table may retain column defs; read maps via ref so accessors/cells always see latest data.
  const examplesByIdRef = useRef<Record<string, Example> | undefined>(undefined);
  const outputByTraceRef = useRef<Map<string, string>>(new Map());

  const traceIds = useMemo(
    () => [...new Set((experiment?.results ?? []).map((r) => r.trace).filter(Boolean))] as string[],
    [experiment?.results]
  );
  const { data: rootSpansMap } = useRootSpansForTraces(organisationId, traceIds, {
    // Need `trace` in _source so we can key the map (fields=attributes.output alone omits it).
    // Request full `attributes` (not attributes.output) so the API also merges unindexed_attributes for large outputs.
    fields: 'trace,attributes',
    enabled: traceIds.length > 0,
  });
  const outputByTrace = useMemo(() => {
    const m = new Map<string, string>();
    rootSpansMap?.forEach((span, tid) => {
      const out = getTruncatedDisplayString(getSpanOutput(span), TRACE_OUTPUT_MAX_LEN);
      if (out) m.set(tid, out);
    });
    return m;
  }, [rootSpansMap]);

  examplesByIdRef.current = examples;
  outputByTraceRef.current = outputByTrace;

  // columns: result id, duration, cost, totalTokens, errors, ...other metrics
  // Get the metrics from the dataset
  // This must be computed before any early returns to satisfy Rules of Hooks
  const notTooBigStyle: React.CSSProperties = { maxWidth: '200px', maxHeight: '100px', textOverflow: 'ellipsis', overflow: 'hidden', wordBreak: 'break-all', overflowWrap: 'anywhere' };
  const smallIdStyle: React.CSSProperties = { fontSize: '0.8rem', maxWidth: '150px', textOverflow: 'ellipsis', overflow: 'hidden', wordBreak: 'break-all', overflowWrap: 'anywhere' };
  const [expandedTokens, setExpandedTokens] = useState(false);
  const toggleExpandedTokens = () => setExpandedTokens(!expandedTokens);
  const tokenDetailColumnClass = expandedTokens ? 'collapsible' : 'collapsible collapsed';
  // columns for tokens
  const columns : ExtendedColumnDef<Result>[] = [
    {
      header: 'Trace',
      accessorKey: 'trace',
      cell: ({ row }: any) => {
        return <LinkId to={`/organisation/${organisationId}/traces/${row.original.trace}`} id={row.original.trace} />;
      },
      style: smallIdStyle,
    },
  {
        header: 'Example',
        accessorKey: 'example',
        accessorFn: (row: Result) => {
          // TODO efficiently load the example names
          const eid = row.example;
          const example = examplesByIdRef.current?.[eid];
          return example?.name || eid;
        },
        cell: ({ row }: any) => {
          const eid = row.original.example;
          return <LinkId to={`/organisation/${organisationId}/example/${row.original.example}`} name={eid} id={eid} />;
        },
        style: smallIdStyle,
      },
      {
        header: 'Input',
        style: notTooBigStyle,
        accessorFn: (row: Result) => {
          const example = examplesByIdRef.current?.[row.example];
          // Note: don't truncate for filtering or csv export. Do truncate for display.
          return getExampleInput(example);
        },
        cell: ({ row }: any) => {
          const example = examplesByIdRef.current?.[row.original.example];
          const raw = getExampleInput(example);
          const display = getTruncatedDisplayString(raw, TRACE_OUTPUT_MAX_LEN);
          if (!display) return <span className="text-muted">—</span>;
          return <span className="small" title={typeof raw === 'string' ? raw : JSON.stringify(raw)}>{display}</span>;
        },
      },
      {
        header: 'Output',
        style: notTooBigStyle,
        accessorFn: (result: Result) => getTraceOutput(result.trace, outputByTraceRef.current),
        cell: ({ row }: any) => {
          const display = getTraceOutput(row.original.trace, outputByTraceRef.current);
          return display ? <span className="small" title={display}>{display}</span> : <span className="text-muted">—</span>;
        },
      },
      {
        header: 'Duration',
        accessorFn: (row: Result) => {
          return row.scores?.[DURATION_METRIC_ID]; // sort on duration ms (not string)
        },
        cell: ({ row }: any) => {
          return <span>{durationString(row.original.scores?.[DURATION_METRIC_ID])}</span>;
        },
        csvValue: (row: Result) => {
          return durationString(row.scores?.[DURATION_METRIC_ID]);
        }
      },
      {
        header: 'Cost',
        accessorFn: (row: Result) => {
          return formatCost(row.scores?.[COST_METRIC_ID]);
        }
      },
      {
        header: 'Tokens',
        headerCell: () => {
          return <>Tokens
          <ExpandCollapseControl direction="right" hasChildren={true} isExpanded={expandedTokens} onToggle={toggleExpandedTokens} />
          </>;
        },
        accessorFn: (row: Result) => {
          return prettyNumber(row.scores?.[TOTAL_TOKENS_METRIC_ID]);
        }
      },
      // {
      //   header: 'Time to First Token',
      //   accessorFn: (row: Result) => {
      //     return row.scores?.[TIME_TO_FIRST_TOKEN_METRIC_ID];
      //   },
      //   cell: ({ row }: any) => {
      //     const timeToFirst = row.original.scores?.[TIME_TO_FIRST_TOKEN_METRIC_ID];
      //     if (typeof timeToFirst !== 'number') return <span>—</span>;
      //     return <span>{durationString(1000*timeToFirst)}</span>;
      //   },
      //   csvValue: (row: Result) => {
      //     return durationString(1000*row.scores?.[TIME_TO_FIRST_TOKEN_METRIC_ID]);
      //   }
      // },
      { /* see SpanStats */
        header: 'Input Tokens',
        accessorFn: (row: Result) => {
          return row.scores?.inputTokens;
        },
        headerClassName: tokenDetailColumnClass,
        cellClassName: tokenDetailColumnClass,
      },
      {
        header: 'Cached Input Tokens',
        accessorFn: (row: Result) => {
          return row.scores?.cachedInputTokens;
        },
        headerClassName: tokenDetailColumnClass,
        cellClassName: tokenDetailColumnClass,
      },
      {
        header: 'Cache Creation Tokens',
        accessorFn: (row: Result) => {
          return row.scores?.cacheCreationTokens;
        },
        headerClassName: tokenDetailColumnClass,
        cellClassName: tokenDetailColumnClass,
      },
      {
        header: 'Output Tokens',
        accessorFn: (row: Result) => {
          return row.scores?.outputTokens;
        },
        headerClassName: tokenDetailColumnClass,
        cellClassName: tokenDetailColumnClass,
      },
      {
        header: 'Spans',
        accessorFn: (row: Result) => {
          return prettyNumber(row.scores?.[SPAN_COUNT_METRIC_ID]);
        } 
      },
    ];
  // metrics
  const metrics = getMetrics(dataset);
  for (const metric of metrics) {
    if (metric.type === 'system') continue; // done above
    columns.push({
      header: metric.name || metric.id,
      accessorFn: (row: Result) => {
        return row.scores?.[metric.id];
      },
      cell: ({ row }: any) => {
        const score = row.original.scores?.[metric.id];
        // Is there a message?
        const message = row.original.messages?.[metric.id];
        if ( ! message) return <span>{score}</span>;
        return <span title={message}>{score}</span>;
      }
    });
    // add a hidden column for the metric messages
    columns.push({
      header: `Message for ${metric.name ?? metric.id}`,
      accessorFn: (row: Result) => {
        return row.messages?.[metric.id];
      },
      cell: ({ row }: any) => {
        return <span>{row.original.messages?.[metric.id]}</span>;
      },
      hidden: true,
      includeInCSV: true
    });
  } // end for (const metric of metrics)
  columns.push({
    id: 'experimentResultExampleTags',
    header: 'Tags',
    type: 'categorical',
    categoricalValues: (row: Result) => examplesByIdRef.current?.[row.example]?.tags ?? [],
    filterFn: categoricalOrRowFilter((row: Result) => examplesByIdRef.current?.[row.example]?.tags ?? []),
    accessorFn: (row: Result) => {
      const tags = examplesByIdRef.current?.[row.example]?.tags;
      return Array.isArray(tags) ? tags.join(' + ') : '';
    },
    cell: ({ row }: any) => {
      const tags = examplesByIdRef.current?.[row.original.example]?.tags;
      const text = Array.isArray(tags) ? tags.join(' + ') : '';
      return text ? <span>{text}</span> : <span className="text-muted">—</span>;
    },
    csvValue: (row: Result) => {
      const tags = examplesByIdRef.current?.[row.example]?.tags;
      return Array.isArray(tags) ? tags.join(' + ') : '';
    },
  });
  columns.push({
    header: 'Errors',
    style: notTooBigStyle,
    accessorFn: (row: Result) => {
      if ( ! row.errors || Object.keys(row.errors).length === 0) {
        return null;
      }
      return Object.entries(row.errors).map(([key, value]) => `${key}: ${value}`).join('\n');
    },
    cell: ({ row }: any) => {
      if ( ! row.original.errors || Object.keys(row.original.errors).length === 0) {
        return null;
      }
      return <span>{Object.entries(row.original.errors).map(([key, value]) => `${key}: ${value}`).join('\n')}</span>;
    }
  });

  if (isLoading) {
    return (
      <Container>
        <Spinner centered />
      </Container>
    );
  }

  if (error || !experiment) {
    return (
      <Container>
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load experiment: {error instanceof Error ? error.message : 'Unknown error'}</p>
          <Link to={`/organisation/${organisationId}/experiment`} className="btn btn-primary">
            Back to Experiments List
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <ExperimentDetailsPageContent
      organisationId={organisationId!}
      experimentId={experimentId!}
      experiment={experiment}
      dataset={dataset}
      datasetId={datasetId}
      columns={columns}
      deleteExperimentMutation={deleteExperimentMutation}
    />
  );
};

/** Split so hooks for table↔dashboard sync stay below loading/error guards (Rules of Hooks). */
function ExperimentDetailsPageContent({
  organisationId,
  experimentId,
  experiment,
  dataset,
  datasetId,
  columns,
  deleteExperimentMutation,
}: {
  organisationId: string;
  experimentId: string;
  experiment: Experiment;
  dataset: Dataset | undefined;
  datasetId: string | undefined;
  columns: ExtendedColumnDef<Result>[];
  deleteExperimentMutation: UseMutationResult<void, Error, void, unknown>;
}) {
  const queryClient = useQueryClient();
  const [filteredResults, setFilteredResults] = useState<Result[] | null>(null);

  const updateExperimentNameMutation = useMutation({
    mutationFn: (name: string) => updateExperiment(experimentId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment', experimentId] });
    },
  });

  const dashboardExperiment = useMemo(
    () => ({
      ...experiment,
      results: filteredResults ?? experiment.results ?? [],
    }),
    [experiment, filteredResults]
  );

  return (
    <Page
      fluid={true}
      header={
        <NameAndDeleteHeader
          label="Experiment"
          item={experiment}
          handleNameChange={(e) => {
            updateExperimentNameMutation.mutate(e.target.value);
          }}
          handleDelete={async () => {
            await deleteExperimentMutation.mutateAsync();
          }}
        />
      }
      back={`/organisation/${organisationId}/experiment`}
      backLabel="Experiments List"
      item={experiment}
    >
      {dataset && (
        <Row>
          <Col>
            <p className="text-muted mb-0">
              Dataset: <Link to={`/organisation/${organisationId}/dataset/${datasetId}`}>{dataset.name || datasetId}</Link>
            </p>
          </Col>
        </Row>
      )}

      <ExperimentDetailsDashboard experiment={dashboardExperiment} baselineExperiment={experiment} />

      <TableUsingAPI
        freezeRows={1}
        showSearch={false}
        data={{ hits: experiment.results || [] }}
        columns={columns}
        queryKeyPrefix={['experiment-results', organisationId, experimentId]}
        onFilteredRowsChange={setFilteredResults}
      />
    </Page>
  );
};

export default ExperimentDetailsPage;

