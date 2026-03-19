import React, { useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExperiment, getDataset, deleteExperiment, searchExamples, updateExperiment } from '../api';
import Experiment, {Result} from '../common/types/Experiment';
import TableUsingAPI from '../components/generic/TableUsingAPI';
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
import HelpText from '../components/generic/HelpText';
import Tags from 'src/components/generic/Tags';
import { getTruncatedDisplayString, getExampleInput } from '../utils/example-utils';
import { getSpanOutput } from '../common/types/Span';
import { useRootSpansForTraces } from '../hooks/useSpanData';

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
    queryFn: async () => {
      // what example IDs do we reference?
      if (exampleIds.length === 0) return { hits: [] };
      const result = await searchExamples({
        organisationId: organisationId!,
        datasetId: datasetId!,
        query: `id:${exampleIds.join(' OR id:')}`,
        limit: 1000,
        offset: 0,
      });
      // console.log('e4id result', result);
      const e4id = {};
      for (const example of result.hits) {
        e4id[example.id] = example;
      }
      return e4id;
    },
    enabled: Boolean(organisationId) && Boolean(datasetId) && exampleIds.length > 0,
  });

  // console.log('examples', examples);

  const traceIds = useMemo(
    () => [...new Set((experiment?.results ?? []).map((r) => r.trace).filter(Boolean))] as string[],
    [experiment?.results]
  );
  const { data: rootSpansMap } = useRootSpansForTraces(organisationId, traceIds, {
    fields: 'attributes.output',
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

  // columns: result id, duration, cost, totalTokens, errors, ...other metrics
  // Get the metrics from the dataset
  // This must be computed before any early returns to satisfy Rules of Hooks
  const notTooBigStyle: React.CSSProperties = { maxWidth: '200px', maxHeight: '100px', textOverflow: 'ellipsis', overflow: 'hidden', wordBreak: 'break-all', overflowWrap: 'anywhere' };
  const smallIdStyle: React.CSSProperties = { fontSize: '0.8rem', maxWidth: '150px', textOverflow: 'ellipsis', overflow: 'hidden', wordBreak: 'break-all', overflowWrap: 'anywhere' };
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
          const example = examples?.[eid];
          return example?.name || eid;
        },
        cell: ({ row }: any) => {
          const eid = row.original.example;
          const example = examples?.[eid];
          return <LinkId to={`/organisation/${organisationId}/example/${row.original.example}`} name={eid} id={eid} />;
        },
        style: smallIdStyle,
      },
      {
        header: 'Input',
        style: notTooBigStyle,
        accessorFn: (row: Result) => {
          const example = examples?.[row.example];
          return getTruncatedDisplayString(getExampleInput(example), TRACE_OUTPUT_MAX_LEN);
        },
        cell: ({ row }: any) => {
          const exampleId = row.original.example;
          const example = examples?.[row.original.example];
          // console.log('Input for row?', exampleId, row, example);
          const raw = getExampleInput(example);
          const display = getTruncatedDisplayString(raw, TRACE_OUTPUT_MAX_LEN);
          if (!display) return <span className="text-muted">—</span>;
          return <span className="small" title={typeof raw === 'string' ? raw : JSON.stringify(raw)}>{display}</span>;
        },
      },
      {
        header: 'Output',
        style: notTooBigStyle,
        accessorFn: (result: Result) => getTraceOutput(result.trace, outputByTrace),
        cell: ({ row }: any) => {
          const display = getTraceOutput(row.original.trace, outputByTrace);
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
        header: 'Tokens',
        accessorFn: (row: Result) => {
          return prettyNumber(row.scores?.[TOTAL_TOKENS_METRIC_ID]);
        }
      },
      {
        header: 'Time to First Token',
        accessorFn: (row: Result) => {
          return row.scores?.[TIME_TO_FIRST_TOKEN_METRIC_ID];
        },
        cell: ({ row }: any) => {
          const timeToFirst = row.original.scores?.[TIME_TO_FIRST_TOKEN_METRIC_ID];
          if (typeof timeToFirst !== 'number') return <span>—</span>;
          return <span>{durationString(1000*timeToFirst)}</span>;
        },
        csvValue: (row: Result) => {
          return durationString(1000*row.scores?.[TIME_TO_FIRST_TOKEN_METRIC_ID]);
        }
      },
      {
        header: 'Cost',
        accessorFn: (row: Result) => {
          return formatCost(row.scores?.[COST_METRIC_ID]);
        }
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
      header: 'Message for ' + metric.name || metric.id,
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
    header: 'Tags',
    accessorFn: (row: Result) => {
      const eid = row.example;
      const example = examples?.[eid];
      return example?.name || eid;
    },
    cell: ({ row }: any) => {
      const eid = row.original.example;
      const example = examples?.[eid];
      return <span>{example?.tags?.join(' + ') || ''}</span>;
    }
  });
  columns.push({
    header: 'Errors',
    style: notTooBigStyle,
    accessorFn: (row: Result) => {
      return row.errors? JSON.stringify(row.errors) : '';
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
    <Page
      fluid={true}
      header={
        <NameAndDeleteHeader
          label="Experiment"
          item={experiment}
          handleNameChange={() => {
            return updateExperiment(experimentId!, { name: experiment.name }) 
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

      <ExperimentDetailsDashboard experiment={experiment} />

      <TableUsingAPI
      showSearch={false}
        data={{ hits: experiment.results || [] }}
        columns={columns}
        queryKeyPrefix={['experiment-results', organisationId, experimentId]}
      />
    </Page>
  );
};

export default ExperimentDetailsPage;

