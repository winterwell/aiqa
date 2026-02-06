import React, { useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExperiment, getDataset, deleteExperiment, searchExamples } from '../api';
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
import { COST_METRIC_ID, DURATION_METRIC_ID, TOTAL_TOKENS_METRIC_ID } from '../common/defaultSystemMetrics';
import LinkId from '../components/LinkId';



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

  const { data: examples } = useQuery({
    queryKey: ['examples', organisationId, experimentId],
    queryFn: async () => {
      // what example IDs do we reference?
      const exampleIds = experiment?.results?.map((result: any) => result.example) || [];
      if (exampleIds.length === 0) return { hits: [] };
      const result = await searchExamples({
        organisationId: organisationId!,
        datasetId: datasetId!,
        query: `id:${exampleIds.join(' OR id:')}}`,
        limit: 1000,
        offset: 0,
      });
      console.log('e4id result', result);
      const e4id = {};
      for (const example of result.hits) {
        e4id[example.id] = example;
      }
      return e4id;
    }
  });

  console.log('examples', examples);

  // columns: result id, duration, cost, totalTokens, errors, ...other metrics
  // Get the metrics from the dataset
  // This must be computed before any early returns to satisfy Rules of Hooks
  const columns : ExtendedColumnDef<Result>[] = [
    {
      header: 'Trace',
      accessorKey: 'trace',
      cell: ({ row }: any) => {
        return <LinkId to={`/traces/${row.original.trace}`} id={row.original.trace} />;
      }
    },
  {
        header: 'Example',
        accessorKey: 'example',
        accessorFn: (row: any) => {
          // TODO efficiently load the example names
          const eid = row.original.example;
          const example = examples?.[eid];
          return example?.name || eid;
        },
        cell: ({ row }: any) => {
          const eid = row.original.example;
          const example = examples?.[eid];
          console.log('example', eid, example, "e4id", examples);
          return <LinkId to={`/organisation/${organisationId}/example/${row.original.example}`} name={example?.name || example?.input} id={eid} />;
        }
      },
      {
        header: 'Duration',
        accessorFn: (row: Result) => {
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
        header: 'Cost',
        accessorFn: (row: Result) => {
          return formatCost(row.scores?.[COST_METRIC_ID]);
        }
      },
      {
        header: 'Errors',
        accessorFn: (row: Result) => {
          return row.errors? JSON.stringify(row.errors) : '';
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
      }
    });
  }

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
      header={
        <NameAndDeleteHeader
          label="Experiment"
          item={experiment}
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

