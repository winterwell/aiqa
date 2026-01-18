import React, { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Container, Row, Col, FormGroup, Label, Input, Form } from 'reactstrap';
import { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { searchSpans } from '../api';
import { Span } from '../common/types';
import TableUsingAPI, { PageableData } from '../components/generic/TableUsingAPI';
import TracesListDashboard from '../components/TracesListDashboard';
import { getTraceId, getStartTime, getDurationMs, getTotalTokenCount, getCost, getSpanId } from '../utils/span-utils';
import StarButton from '../components/generic/StarButton';
import Page from '../components/generic/Page';
import Tags from '../components/generic/Tags';
import { updateSpan } from '../api';

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
  'traceId',
  'startTime',
  'endTime',
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
      parts.push(`startTime:>=${sinceValue}`);
    }
    
    if (dateFilterType === 'custom' && untilParam) {
      const untilValue = untilParam.startsWith('-') ? getRelativeTime(untilParam) : untilParam;
      parts.push(`startTime:<=${untilValue}`);
    }
    
    return parts.length > 0 ? parts.join(' AND ') : '';
  };

  // Main loadData function
  const loadData = async (query: string): Promise<PageableData<Span>> => {
    // Build combined query with date filter
    const dateFilter = buildDateFilterQuery();
    const combinedQuery = dateFilter 
      ? (query ? `(${query}) AND (${dateFilter})` : dateFilter)
      : query;
    
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
          const traceIdQuery = batch.map(id => `traceId:${id}`).join(' OR ');
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
			id: 'starred',
			header: '',
			accessorFn: (row) => {
			  // Sort: false (0) comes before true (1)
			  return row.starred ? 1 : 0;
			},
			cell: ({ row }) => {
			  return (
				<StarButton 
				  span={row.original} 
				  size="sm"
				  onUpdate={(updatedSpan) => {
					// Update the span in the enriched spans map
					const traceId = getTraceId(updatedSpan);
					if (traceId) {
					  setEnrichedSpans(prev => {
						const next = new Map(prev);
						next.set(traceId, updatedSpan);
						return next;
					  });
					}
				  }}
				/>
			  );
			},
			enableSorting: true,
		},
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
        id: 'traceId',
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
          // Format duration nicely
          if (duration < 1000) {
            return <span>{Math.round(duration)}ms</span>;
          } else if (duration < 60000) {
            return <span>{(duration / 1000).toFixed(2)}s</span>;
          } else {
            const minutes = Math.floor(duration / 60000);
            const seconds = ((duration % 60000) / 1000).toFixed(0);
            return <span>{minutes}m {seconds}s</span>;
          }
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
          return <span>{tokenCount !== null ? tokenCount.toLocaleString() : 'N/A'}</span>;
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
          // Format cost with appropriate precision
          if (cost < 0.01) {
            return <span>${cost.toFixed(4)}</span>;
          } else if (cost < 1) {
            return <span>${cost.toFixed(3)}</span>;
          } else {
            return <span>${cost.toFixed(2)}</span>;
          }
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
        header: 'Feedback',
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
              {feedback.type === 'positive' && <span className="text-success">👍</span>}
              {feedback.type === 'negative' && <span className="text-danger">👎</span>}
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
    [organisationId, feedbackMap]
  );

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

  return (
    <Page header="Traces">
      <Row className="mt-3">
        <Col>
          <Form>
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
            
            {dateFilterType === 'custom' && (
              <>
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
              </>
            )}
          </Form>
        </Col>
      </Row>

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
            initialSorting={[{ id: 'startTime', desc: true }]}
            queryKeyPrefix={['traces', organisationId]}
            onRowClick={(span) => {
              const traceId = getTraceId(span);
              if (traceId) {
                navigate(`/organisation/${organisationId}/traces/${traceId}`);
              }
            }}
          />
        </Col>
      </Row>
    </Page>
  );
};

export default TracesListPage;

