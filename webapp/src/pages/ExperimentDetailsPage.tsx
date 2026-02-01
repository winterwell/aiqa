import React, { useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Container, Row, Col } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getExperiment, getDataset, deleteExperiment } from '../api';
import { Experiment, Dataset } from '../common/types';
import TableUsingAPI from '../components/generic/TableUsingAPI';
import { useToast } from '../utils/toast';
import ExperimentDetailsDashboard from '../components/ExperimentDetailsDashboard';
import NameAndDeleteHeader from '../components/generic/NameAndDeleteHeader';
import Page from '../components/generic/Page';
import Spinner from '../components/generic/Spinner';
import type { ExtendedColumnDef } from '../components/generic/TableUsingAPI';
import { durationString, formatCost, prettyNumber } from '../utils/span-utils';
import { getMetricValue } from '../utils/metric-utils';

const ExperimentDetailsPage: React.FC = () => {
  const { organisationId, datasetId, experimentId } = useParams<{
    organisationId: string;
    datasetId: string;
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

  // columns: result id, duration, gen_ai.cost.usd, gen_ai.usage.total_tokens, errors, ...other metrics
  // Get the metrics from the dataset
  // This must be computed before any early returns to satisfy Rules of Hooks
  const columns = useMemo<ExtendedColumnDef<any>[]>(() => {
    const metrics = dataset?.metrics || [];
    // add any missing metrics - scores used in examples
    if (experiment?.results) {
      for (const result of experiment.results) {
        for (const metricName in result.scores || []) {
          if (!metrics.find(metric => metric.name === metricName || metric.id === metricName)) {
            metrics.push({ id: metricName, name: metricName, type: 'number' });
          }
        }
      }
    }

    // Define priority columns that should appear first (by ID, not display name)
    const priorityColumnIds = ['duration', 'gen_ai.cost.usd', 'gen_ai.usage.total_tokens'];
    const priorityMetrics: typeof metrics = [];
    const otherMetrics: typeof metrics = [];

    metrics.forEach(metric => {
      // Check by ID for priority columns, since IDs are stable identifiers
      if (priorityColumnIds.includes(metric.id)) {
        priorityMetrics.push(metric);
      } else {
        otherMetrics.push(metric);
      }
    });


    const buildMetricColumn = (metric: typeof metrics[0]) => {
      // Use display name if available, otherwise fall back to ID
      const displayName = metric.name || metric.id;
      // Check formatting by ID (stable identifier), not display name
      const isDuration = metric.id === 'duration';
      const isCost = metric.id === 'gen_ai.cost.usd';
      const isTokens = metric.id === 'gen_ai.usage.total_tokens';

      return {
        header: displayName,
        accessorFn: (row: any) => {
          const value = getMetricValue(row, metric);
          const error = row.errors?.[metric.id] ?? row.errors?.[metric.name];
          return value ?? error ?? null;
        },
        cell: ({ row }: any) => {
          const value = getMetricValue(row.original, metric);
          const error = row.original.errors?.[metric.id] ?? row.original.errors?.[metric.name];
          
          if (error) {
            return <span className="text-danger">{error}</span>;
          }
          
          if (value === null) {
            return '';
          }

          if (isDuration) {
            return <span>{durationString(value)}</span>;
          } else if (isCost) {
            return <span>{formatCost(value)}</span>;
          } else if (isTokens) {
            return <span>{prettyNumber(value)}</span>;
          }
          
          // Default formatting for other numeric metrics
          return <span>{prettyNumber(value)}</span>;
        },
        csvValue: (row: any) => {
          const value = getMetricValue(row, metric);
          const error = row.errors?.[metric.id] ?? row.errors?.[metric.name];
          if (error) return error;
          if (value === null) return '';
          return String(value);
        },
      };
    };

    return [
      {
        header: 'Example ID',
        accessorKey: 'exampleId',
      },
      ...priorityMetrics.map(buildMetricColumn),
      ...otherMetrics.map(buildMetricColumn),
      {
        header: 'Errors',
        accessorFn: (row: any) => {
          const errors = row.errors;
          if (!errors || Object.keys(errors).length === 0) return '';
          return JSON.stringify(errors);
        },
        cell: ({ row }: any) => {
          const errors = row.original.errors;
          if (!errors || Object.keys(errors).length === 0) {
            return <span></span>;
          }
          return <span className="text-danger">{JSON.stringify(errors)}</span>;
        },
        csvValue: (row: any) => {
          const errors = row.errors;
          if (!errors || Object.keys(errors).length === 0) return '';
          return JSON.stringify(errors);
        },
      },
    ];
  }, [dataset?.metrics, experiment?.results]);

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
          <Link to={`/organisation/${organisationId}/experiments`} className="btn btn-primary">
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
      back={`/organisation/${organisationId}/experiments`}
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
        data={{ hits: experiment.results || [] }}
        columns={columns}
        queryKeyPrefix={['experiment-results', organisationId, experimentId]}
      />
    </Page>
  );
};

export default ExperimentDetailsPage;

