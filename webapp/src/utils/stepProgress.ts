import { useQuery } from '@tanstack/react-query';
import { listApiKeys, listDatasets, listExperiments, searchSpans } from '../api';
import { asArray } from '../common/utils/miscutils';

export type StepId = 
  | 'organisation'
  | 'api-key'
  | 'code-setup'
  | 'traces'
  | 'datasets'
  | 'metrics'
  | 'experiment-code'
  | 'experiment-results';

export interface StepInfo {
  id: StepId;
  label: string;
  path: (orgId: string) => string;
  nextPath?: (orgId: string) => string;
}

export const STEP_FLOW: StepInfo[] = [
  { id: 'organisation', label: 'Organisation', path: (orgId) => `/organisation` },
  { id: 'api-key', label: 'API Key', path: (orgId) => `/organisation/${orgId}/api-key`, nextPath: (orgId) => `/organisation/${orgId}/code-setup` },
  { id: 'code-setup', label: 'Code Setup', path: (orgId) => `/organisation/${orgId}/code-setup`, nextPath: (orgId) => `/organisation/${orgId}/traces` },
  { id: 'traces', label: 'Traces', path: (orgId) => `/organisation/${orgId}/traces`, nextPath: (orgId) => `/organisation/${orgId}/dataset` },
  { id: 'datasets', label: 'Datasets', path: (orgId) => `/organisation/${orgId}/dataset`, nextPath: (orgId) => `/organisation/${orgId}/metrics` },
  // TODO QA for your QA metrics { id: 'metrics', label: 'Metrics', path: (orgId) => `/organisation/${orgId}/metrics`, nextPath: (orgId) => `/organisation/${orgId}/experiment-code` },
  { id: 'experiment-code', label: 'Experiment Code', path: (orgId) => `/organisation/${orgId}/experiment-code`, nextPath: (orgId) => `/organisation/${orgId}/experiment` },
  { id: 'experiment-results', label: 'Experiment Results', path: (orgId) => `/organisation/${orgId}/experiment` },
];

/**
 * Check if a step has been visited (for informational steps)
 */
function hasVisitedStep(stepId: StepId): boolean {
  const visited = localStorage.getItem(`step-visited-${stepId}`);
  return visited === 'true';
}

/**
 * Mark a step as visited
 */
export function markStepVisited(stepId: StepId): void {
  localStorage.setItem(`step-visited-${stepId}`, 'true');
}

/**
 * Hook to check step completion status
 */
export function useStepCompletion(organisationId: string | undefined) {
  // Check API keys
  const { data: apiKeys } = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });

  // Check traces (just check if any exist)
  const { data: tracesData } = useQuery({
    queryKey: ['traces-check', organisationId],
    queryFn: () => searchSpans({ organisationId: organisationId!, isRoot: true, limit: 1, offset: 0 }),
    enabled: !!organisationId,
  });

  // Check datasets
  const { data: datasets } = useQuery({
    queryKey: ['datasets', organisationId],
    queryFn: () => listDatasets(organisationId!),
    enabled: !!organisationId,
  });

  // Check if datasets have metrics
  const datasetsWithMetrics = datasets?.some((d: any) => asArray(d.metrics).length > 0);

  // Check experiments
  const { data: experiments } = useQuery({
    queryKey: ['experiments', organisationId],
    queryFn: () => listExperiments(organisationId!),
    enabled: !!organisationId,
  });

  const hasTraces = !!(tracesData && tracesData.hits && tracesData.hits.length > 0);
  const hasExperiments = !!(experiments && Array.isArray(experiments) && experiments.length > 0);

  const completion: Record<StepId, boolean> = {
    'organisation': !!organisationId,
    'api-key': !!(apiKeys && Array.isArray(apiKeys) && apiKeys.length > 0),
    'code-setup': hasTraces, // Done if any traces have been received
    'traces': hasTraces,
    'datasets': !!(datasets && Array.isArray(datasets) && datasets.length > 0),
    'metrics': !!datasetsWithMetrics,
    'experiment-code': hasExperiments, // Done if any experiments have been created
    'experiment-results': hasExperiments,
  };

  return completion;
}

/**
 * Get the current step ID from the pathname
 */
export function getCurrentStepId(pathname: string): StepId | null {
  // Check specific paths first (more specific before general)
  if (pathname.includes('/experiment-code')) return 'experiment-code';
  if (pathname.includes('/api-key')) return 'api-key';
  if (pathname.includes('/code-setup')) return 'code-setup';
  if (pathname.includes('/traces')) return 'traces';
  if (pathname.includes('/metrics')) return 'metrics';
  if (pathname.includes('/experiment')) return 'experiment-results';
  if (pathname.includes('/dataset')) return 'datasets';
  
  // Organisation page (exact match or with org ID)
  if (pathname === '/organisation' || pathname.match(/^\/organisation\/[^/]+$/)) {
    return 'organisation';
  }
  
  return null;
}

