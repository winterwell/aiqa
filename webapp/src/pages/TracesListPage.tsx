import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Container, Row, Col, FormGroup, Label, Input, Form, Button } from 'reactstrap';
import { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { searchSpans, deleteSpans } from '../api';
import { Span, getSpanId, getTraceId } from '../common/types';
import { propFromString, setPropInString } from '../common/SearchQuery';
import TableUsingAPI, { PageableData } from '../components/generic/TableUsingAPI';
import TracesListDashboard from '../components/TracesListDashboard';
import { getStartTime, getDurationMs, getTotalTokenCount, getCost, durationString, formatCost, prettyNumber } from '../utils/span-utils';
import Page from '../components/generic/Page';
import Tags from '../components/generic/Tags';
import { updateSpan } from '../api';
import { TrashIcon } from '@phosphor-icons/react';
import ConfirmDialog from '../components/generic/ConfirmDialog';

const getFeedback = (span: Span): { type: 'positive' | 'negative' | 'neutral' | null; comment?: string } | null => {
  const attributes = (span as any).attributes || {};
  const spanType = attributes['aiqa.span_type'];
  if (spanType === 'feedback') {
    const feedbackType = attributes['feedback.type'] as string | undefined;
    const thumbsUp = attributes['feedback.thumbs_up'] as boolean | undefined;
    const comment = attributes['feedback.comment'] as string | undefined;
    
    let type: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (feedbackType === 'positive' || thumbsUp === true) {
      type = 'positive';
    } else if (feedbackType === 'negative' || thumbsUp === false) {
      type = 'negative';
    }
    
    return { type, comment };
  }
  return null;
};

// Attributes we need for the traces list page
const REQUIRED_ATTRIBUTES = [
  'trace_id',
  'start_time',
  'end_time',
  'name',
  'attributes',
  'tags',
].join(',');

// Attributes we need for feedback spans
const FEEDBACK_ATTRIBUTES = [
  'aiqa.span_type',
  'feedback.type',
  'feedback.thumbs_up',
  'feedback.comment',
].join(',');

const BATCH_SIZE = 10;
const CACHE_STALE_TIME = 5 * 60 * 1000; // 5 minutes

type DateFilterType = '1h' | '1d' | '1w' | 'custom';

// Convert relative time format to ISO string
const getRelativeTime = (relative: string): string => {
  const match = relative.match(/^-(\d+)([hdw])$/);
  if (!match) return relative; // Assume it's already ISO format
  
  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();
  
  switch (unit) {
    case 'h':
      now.setHours(now.getHours() - amount);
      break;
    case 'd':
      now.setDate(now.getDate() - amount);
      break;
    case 'w':
      now.setDate(now.getDate() - (amount * 7));
      break;
  }
  
  return now.toISOString();
};

const TracesListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [feedbackMap, setFeedbackMap] = useState<Map<string, { type: 'positive' | 'negative' | 'neutral'; comment?: string }>>(new Map());
  const [enrichedSpans, setEnrichedSpans] = useState<Map<string, Span>>(new Map());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<Span[]>([]);
  
  // Get date filter from URL params, default to '1d'
  const dateFilterType = (searchParams.get('dateFilter') || '1d') as DateFilterType;
  const sinceParam = searchParams.get('since') || '';
  const untilParam = searchParams.get('until') || '';
  
  // Initialize date filter state from URL params
  const [customSince, setCustomSince] = useState<string>(() => {
    if (dateFilterType === 'custom' && sinceParam) {
      // If it's a relative format, convert to ISO for the input
      if (sinceParam.startsWith('-')) {
        return getRelativeTime(sinceParam);
      }
      return sinceParam;
    }
    return '';
  });
  
  const [customUntil, setCustomUntil] = useState<string>(() => {
    if (dateFilterType === 'custom' && untilParam) {
      if (untilParam.startsWith('-')) {
        return getRelativeTime(untilParam);
      }
      return untilParam;
    }
    return '';
  });
  
  // Get search query from URL params (may include feedback:positive / feedback:negative; server maps to attribute.feedback)
  const searchQuery = searchParams.get('search') || '';
  const [searchInput, setSearchInput] = useState<string>(searchQuery);

  const setSearchWithFeedback = (feedback: 'positive' | 'negative' | null) => {
    const newSearch = setPropInString(searchQuery, 'feedback', feedback ?? null);
    const next = new URLSearchParams(searchParams);
    if (newSearch) next.set('search', newSearch);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };
  const fb = propFromString(searchQuery, 'feedback');
  const feedbackInSearch = (fb === 'positive' || fb === 'negative') ? fb : null;
  
  // Update URL params when date filter changes
  const updateDateFilter = (type: DateFilterType, since?: string, until?: string) => {
    const newParams = new URLSearchParams(searchParams);
    
    if (type === 'custom') {
      newParams.set('dateFilter', 'custom');
      if (since) {
        newParams.set('since', since);
      } else {
        newParams.delete('since');
      }
      if (until) {
        newParams.set('until', until);
      } else {
        newParams.delete('until');
      }
    } else {
      newParams.set('dateFilter', type);
      // For preset filters, only set since
      const now = new Date();
      let sinceDate: Date;
      switch (type) {
        case '1h':
          sinceDate = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '1d':
          sinceDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '1w':
          sinceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          sinceDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }
      // Use relative format for preset filters
      const relativeFormat = type === '1h' ? '-1h' : type === '1d' ? '-1d' : '-1w';
      newParams.set('since', relativeFormat);
      newParams.delete('until');
    }
    
    setSearchParams(newParams, { replace: true });
  };
  
  // Build date filter query string
  const buildDateFilterQuery = (): string => {
    const parts: string[] = [];
    
    if (sinceParam) {
      const sinceValue = sinceParam.startsWith('-') ? getRelativeTime(sinceParam) : sinceParam;
      parts.push(`start:>=${sinceValue}`);
    }
    
    if (dateFilterType === 'custom' && untilParam) {
      const untilValue = untilParam.startsWith('-') ? getRelativeTime(untilParam) : untilParam;
      parts.push(`start_time:<=${untilValue}`);
    }
    
    return parts.length > 0 ? parts.join(' AND ') : '';
  };

  // Main loadData function (server handles feedback:positive/negative in search as attribute.feedback)
  const loadData = async (query: string): Promise<PageableData<Span>> => {
    const dateFilter = buildDateFilterQuery();
    const parts: string[] = [];
    if (query) parts.push(`(${query})`);
    if (searchQuery) parts.push(`(${searchQuery})`);
    if (dateFilter) parts.push(`(${dateFilter})`);
    const combinedQuery = parts.length > 0 ? parts.join(' AND ') : '';
    
    // Load root spans with required attributes directly
    const result = await searchSpans({ 
      organisationId: organisationId!, 
      query: combinedQuery, 
      isRoot: true, 
      limit: 1000,
      offset: 0,
      fields: REQUIRED_ATTRIBUTES,
      exclude: 'attributes.input,attributes.output',
    });
    
    if (!result.hits || result.hits.length === 0) {
      setFeedbackMap(new Map());
      setEnrichedSpans(new Map());
      return result;
    }

    // Extract trace IDs
    const traceIds = result.hits
      .map(span => getTraceId(span))
      .filter((id): id is string => !!id);

    // Load feedback in batches with caching
    const feedbackData = new Map<string, { type: 'positive' | 'negative' | 'neutral'; comment?: string }>();
    for (let i = 0; i < traceIds.length; i += BATCH_SIZE) {
      const batch = traceIds.slice(i, i + BATCH_SIZE);
      const sortedBatch = [...batch].sort();
      const cacheKey = ['feedback-spans', organisationId, sortedBatch.join(',')];
      
      const spans = await queryClient.fetchQuery({
        queryKey: cacheKey,
        queryFn: async () => {
          const traceIdQuery = batch.map(id => `trace:${id}`).join(' OR ');
          const feedbackResult = await searchSpans({
            organisationId: organisationId!,
            query: `(${traceIdQuery}) AND attributes.aiqa\\.span_type:feedback`,
            limit: batch.length,
            offset: 0,
            fields: FEEDBACK_ATTRIBUTES,
          });
          return feedbackResult.hits || [];
        },
        staleTime: CACHE_STALE_TIME,
      });
      
      spans.forEach((span: Span) => {
        const traceId = getTraceId(span);
        if (traceId) {
          const feedback = getFeedback(span);
          if (feedback && feedback.type !== null) {
            feedbackData.set(traceId, feedback);
          }
        }
      });
    }

    // Update state and build enriched spans map
    setFeedbackMap(feedbackData);
    const enrichedMap = new Map<string, Span>();
    result.hits.forEach(span => {
      const traceId = getTraceId(span);
      if (traceId) {
        enrichedMap.set(traceId, span);
      }
    });
    setEnrichedSpans(enrichedMap);

    return result;
  };

  // Table columns
  const columns = useMemo<ColumnDef<Span>[]>(
    () => [
		{
			id: 'startTime',
			header: 'Start Time',
			accessorFn: (row) => {
			  const startTime = getStartTime(row);
			  return startTime ? startTime.getTime() : null;
			},
			cell: ({ row }) => {
			  const startTime = getStartTime(row.original);
			  return (
				<span>
				  {startTime
					? startTime.toLocaleString(undefined, {
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						hour: '2-digit',
						minute: '2-digit',
						hour12: false,
					  })
					: null}
				</span>
			  );
			},
			csvValue: (row) => {
			  // Export as ISO 8601 format string
			  const startTime = getStartTime(row);
			  return startTime ? startTime.toISOString() : '';
			},
			enableSorting: true,
		  },
	
		{
        id: 'trace_id',
        header: 'Trace ID',
        cell: ({ row }) => {
          const traceId = getTraceId(row.original);
          if (!traceId) return <span>N/A</span>;
          return <code className="small">{traceId.length > 16 ? `${traceId.substring(0, 16)}...` : traceId}</code>;
        },
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => {
          const name = (row.original as any).name || 'Unknown';
          return <span>{name}</span>;
        },
      },
      {
        id: 'duration',
        header: 'Duration',
        accessorFn: (row) => {
          const duration = getDurationMs(row);
          return duration !== null ? duration : null;
        },
        cell: ({ row }) => {
          const duration = getDurationMs(row.original);
          if (duration === null) return <span>N/A</span>;
          return <span>{durationString(duration)}</span>;
        },
        enableSorting: true,
      },
      {
        id: 'totalTokens',
        header: 'Tokens',
        accessorFn: (row) => {
          const tokenCount = getTotalTokenCount(row);
          return tokenCount !== null ? tokenCount : null;
        },
        cell: ({ row }) => {
          const tokenCount = getTotalTokenCount(row.original);
          return <span>{tokenCount !== null ? prettyNumber(tokenCount) : 'N/A'}</span>;
        },
        enableSorting: true,
      },
      {
        id: 'cost',
        header: 'Cost (USD)',
        accessorFn: (row) => {
          const cost = getCost(row);
          return cost !== null ? cost : null;
        },
        cell: ({ row }) => {
          const cost = getCost(row.original);
          if (cost === null) return <span>N/A</span>;
          return <span>{formatCost(cost)}</span>;
        },
        enableSorting: true,
      },
      {
        id: 'component',
        header: 'Component',
        cell: ({ row }) => {
          const component = (row.original as any).attributes?.['gen_ai.component.id'] || 
                           (row.original as any).attributes?.component || 
                           null;
          return <span>{component || 'N/A'}</span>;
        },
      },
      {
        id: 'feedback',
        header: () => (
          <span>
            Feedback{' '}
            <span
              className={`small ${feedbackInSearch === null ? 'fw-bold' : 'text-muted'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setSearchWithFeedback(null)}
              title="Show all"
            >All</span>
            {' · '}
            <span
              className={`small ${feedbackInSearch === 'positive' ? 'fw-bold text-success' : 'text-muted'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setSearchWithFeedback(feedbackInSearch === 'positive' ? null : 'positive')}
              title={feedbackInSearch === 'positive' ? 'Clear filter' : 'Filter: thumbs up only'}
            >👍</span>
            {' · '}
            <span
              className={`small ${feedbackInSearch === 'negative' ? 'fw-bold text-danger' : 'text-muted'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setSearchWithFeedback(feedbackInSearch === 'negative' ? null : 'negative')}
              title={feedbackInSearch === 'negative' ? 'Clear filter' : 'Filter: thumbs down only'}
            >👎</span>
          </span>
        ),
        accessorFn: (row) => {
          // Sort: no feedback (0) < negative (1) < neutral (2) < positive (3)
          const traceId = getTraceId(row);
          const feedback = traceId ? feedbackMap.get(traceId) : null;
          if (!feedback) return 0;
          switch (feedback.type) {
            case 'negative': return 1;
            case 'neutral': return 2;
            case 'positive': return 3;
            default: return 0;
          }
        },
        cell: ({ row }) => {
          const traceId = getTraceId(row.original);
          const feedback = traceId ? feedbackMap.get(traceId) : null;
          if (!feedback) {
            return <span className="text-muted">—</span>;
          }
          return (
            <span>
              {feedback.type === 'positive' && (
                <span
                  className={`text-success ${feedbackInSearch === 'positive' ? 'opacity-100' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); setSearchWithFeedback(feedbackInSearch === 'positive' ? null : 'positive'); }}
                  title={feedbackInSearch === 'positive' ? 'Clear filter: thumbs up' : 'Filter: thumbs up'}
                >👍</span>
              )}
              {feedback.type === 'negative' && (
                <span
                  className={`text-danger ${feedbackInSearch === 'negative' ? 'opacity-100' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); setSearchWithFeedback(feedbackInSearch === 'negative' ? null : 'negative'); }}
                  title={feedbackInSearch === 'negative' ? 'Clear filter: thumbs down' : 'Filter: thumbs down'}
                >👎</span>
              )}
              {feedback.type === 'neutral' && <span className="text-muted">○</span>}
              {feedback.comment && (
                <span className="ms-2" title={feedback.comment}>
                  💬
                </span>
              )}
            </span>
          );
        },
        enableSorting: true,
      },
      {
        id: 'tags',
        header: 'Tags',
        accessorFn: (row) => {
          // Sort by first tag alphabetically, or empty string if no tags
          if (!row.tags || !Array.isArray(row.tags) || row.tags.length === 0) {
            return '';
          }
          // Sort by first tag (alphabetically), with empty tags at the end
          return row.tags[0] || '';
        },
        cell: ({ row }) => {
          const span = row.original;
          const spanId = getSpanId(span);
          
          return (
            <Tags
            compact={true}
              tags={span.tags}
              setTags={async (newTags) => {
                try {
                  const updatedSpan = await updateSpan(spanId, {
                    tags: newTags,
                  });
                  // Update the span in the enriched spans map
                  const traceId = getTraceId(updatedSpan);
                  if (traceId) {
                    setEnrichedSpans(prev => {
                      const next = new Map(prev);
                      next.set(traceId, updatedSpan);
                      return next;
                    });
                  }
                } catch (error) {
                  console.error('Failed to update span tags:', error);
                }
              }}
            />
          );
        },
        csvValue: (row) => {
          // Export tags as comma-separated string for CSV
          return row.tags && Array.isArray(row.tags) && row.tags.length > 0 ? row.tags.join(', ') : '';
        },
        enableSorting: true,
      },
    ],
    [organisationId, feedbackMap, feedbackInSearch, searchParams]
  ); // end columns

  const handleBulkDelete = (selectedRowIds: string[], selectedRows: Span[]) => {
    setSelectedRowIds(selectedRowIds);
    setSelectedRows(selectedRows);
    setDeleteModalOpen(true);
  }
  const handleBulkDeleteConfirmed = async () => {
    if (!organisationId) {
      console.warn('No organisation context for bulk delete');
      setDeleteModalOpen(false);
      return;
    }
    if (selectedRows.length === 0) {
      console.warn('No rows selected for deletion');
      setDeleteModalOpen(false);
      return;
    }

    // Build set of trace_ids and orphan span.ids
    const traceIds = new Set<string>();
    const orphanSpanIds = new Set<string>();
    for (const span of selectedRows) {
      const traceId = getTraceId(span);
      if (traceId) {
        traceIds.add(traceId);
      } else {
        // If for some reason traceId is empty, fallback to spanId
        const spanId = getSpanId(span);
        if (spanId) orphanSpanIds.add(spanId);
      }
    }

    try {
      if (traceIds.size > 0) {
        await deleteSpans(organisationId!, { traceIds: Array.from(traceIds) });
      }
      if (orphanSpanIds.size > 0) {
        await deleteSpans(organisationId!, { spanIds: Array.from(orphanSpanIds) });
      }
      // Invalidate queries to refresh the table data
      // Invalidate both the table-data queries and trace-related queries
      queryClient.invalidateQueries({ queryKey: ['table-data', 'traces', organisationId] });
      queryClient.invalidateQueries({ queryKey: ['traces', organisationId] });
      queryClient.invalidateQueries({ queryKey: ['feedback-spans', organisationId] });
      setDeleteModalOpen(false);
      setSelectedRowIds([]);
      setSelectedRows([]);
    } catch (err) {
      console.error('Failed to delete spans:', err);
      // Keep modal open on error so user can retry
    }
  }; // end handleBulkDeleteConfirmed

  // Handle custom date changes
  const handleCustomSinceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCustomSince(value);
    if (value) {
      // Convert to ISO format if it's a datetime-local input
      const isoValue = value.includes('T') ? new Date(value).toISOString() : value;
      updateDateFilter('custom', isoValue, untilParam);
    } else {
      updateDateFilter('custom', undefined, untilParam);
    }
  };
  
  const handleCustomUntilChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCustomUntil(value);
    if (value) {
      // Convert to ISO format if it's a datetime-local input
      const isoValue = value.includes('T') ? new Date(value).toISOString() : value;
      updateDateFilter('custom', sinceParam, isoValue);
    } else {
      updateDateFilter('custom', sinceParam, undefined);
    }
  };
  
  const handleDateFilterTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newType = e.target.value as DateFilterType;
    updateDateFilter(newType);
  };
  
  // Handle search input changes
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    
    // Update URL params
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set('search', value);
    } else {
      newParams.delete('search');
    }
    setSearchParams(newParams, { replace: true });
  };
  
  // Sync searchInput with URL param when it changes externally
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  return (
    <Page header="Traces">
      {/* filtering is buggy so off for now <Row className="mt-3">
        <Col>
          <Form>
            <Row>
              <Col md="auto">
                <FormGroup>
                  <Label for="dateFilter">Date Filter</Label>
                  <Input
                    type="select"
                    id="dateFilter"
                    value={dateFilterType}
                    onChange={handleDateFilterTypeChange}
                    style={{ maxWidth: '200px' }}
                  >
                    <option value="1h">1 hour</option>
                    <option value="1d">1 day</option>
                    <option value="1w">1 week</option>
                    <option value="custom">Custom</option>
                  </Input>
                </FormGroup>
              </Col>
              <Col md="auto">
                <FormGroup>
                  <Label for="search">Search</Label>
                  <Input
                    type="search"
                    id="search"
                    placeholder="Search traces..."
                    value={searchInput}
                    onChange={handleSearchChange}
                    style={{ maxWidth: '300px' }}
                  />
                </FormGroup>
              </Col>
            </Row>
            
            {dateFilterType === 'custom' && (
              <Row>
                <Col md="auto">
                  <FormGroup>
                    <Label for="customSince">Since</Label>
                    <Input
                      type="datetime-local"
                      id="customSince"
                      value={customSince ? new Date(customSince).toISOString().slice(0, 16) : ''}
                      onChange={handleCustomSinceChange}
                      style={{ maxWidth: '300px' }}
                    />
                  </FormGroup>
                </Col>
                <Col md="auto">
                  <FormGroup>
                    <Label for="customUntil">Until</Label>
                    <Input
                      type="datetime-local"
                      id="customUntil"
                      value={customUntil ? new Date(customUntil).toISOString().slice(0, 16) : ''}
                      onChange={handleCustomUntilChange}
                      style={{ maxWidth: '300px' }}
                    />
                  </FormGroup>
                </Col>
              </Row>
            )}
          </Form>
        </Col>
      </Row> */}

      {enrichedSpans.size > 0 && (
        <Row className="mt-3">
          <Col>
            <TracesListDashboard spans={Array.from(enrichedSpans.values())} feedbackMap={feedbackMap} />
          </Col>
        </Row>
      )}

      <Row className="mt-3">
        <Col>
          <TableUsingAPI
            loadData={loadData}
            showSearch={false}
			refetchInterval={30000} // 30 seconds
            columns={columns}
            pageSize={50}
            enableInMemoryFiltering={true}
            initialSorting={[{ id: 'start', desc: true }]}
            queryKeyPrefix={['traces', organisationId, searchQuery, dateFilterType, sinceParam, untilParam]}
            getRowId={(span) => {
              // Use trace as the stable row ID, fallback to span ID if no trace
              const traceId = getTraceId(span);
              if (traceId) return traceId;
              const spanId = getSpanId(span);
              return spanId || `span-${Math.random()}`; // Fallback for edge cases
            }}
            onRowClick={(span) => {
              const traceId = getTraceId(span);
              if (traceId) {
                navigate(`/organisation/${organisationId}/traces/${traceId}`);
              }
            }}
            enableRowSelection={true}
            onSelectionChange={(selectedRowIds, selectedRows) => {
              console.log('selectedRowIds:', selectedRowIds);
              console.log('selectedRows:', selectedRows);
            }}
            bulkActionsToolbar={(selectedRowIds, selectedRows) => {
              return (
                <div>
                  <Button color="danger" size="xs" onClick={() => handleBulkDelete(selectedRowIds, selectedRows)} title="Delete selected traces">
                    <TrashIcon size={16} />
                  </Button>
                </div>
              );
            }}
          />
          <ConfirmDialog
            isOpen={deleteModalOpen}
            toggle={() => setDeleteModalOpen(false)}
            header="Delete selected traces"
            body="Are you sure you want to delete these traces?"
            onConfirm={handleBulkDeleteConfirmed}
            confirmButtonText="Delete"
            confirmButtonColor="danger"
          />
        </Col>
      </Row>
    </Page>
  );
};

export default TracesListPage;

