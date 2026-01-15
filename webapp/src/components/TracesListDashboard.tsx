import React, { useState } from 'react';
import { Card, CardBody, CardHeader, Row, Col } from 'reactstrap';
import { Span } from '../common/types';
import MetricCard from './dashboard/MetricCard';
import ViewModeToggle, { ViewMode } from './dashboard/ViewModeToggle';
import HistogramChart from './dashboard/HistogramChart';
import TokensHistogramChart from './dashboard/TokensHistogramChart';
import CostHistogramChart from './dashboard/CostHistogramChart';
import TimeseriesChart from './dashboard/TimeseriesChart';
import TokensTimeseriesChart from './dashboard/TokensTimeseriesChart';
import CostTimeseriesChart from './dashboard/CostTimeseriesChart';
import { useTraceMetrics, useHistogramData, useTokensHistogramData, useCostHistogramData, useTimeseriesData, useTokensTimeseriesData, useCostTimeseriesData } from './dashboard/useTraceMetrics';
import { durationString, isRootSpan, getDurationMs, prettyNumber } from '../utils/span-utils';
import { FEEDBACK_ICONS } from './dashboard/chart-constants';

interface TracesListDashboardProps {
  spans: Span[];
  feedbackMap: Map<string, { type: 'positive' | 'negative' | 'neutral'; comment?: string }>;
}

const TracesListDashboard: React.FC<TracesListDashboardProps> = ({ spans, feedbackMap }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('histogram');
  const metrics = useTraceMetrics(spans, feedbackMap);
  const durationHistogramData = useHistogramData(spans);
  const tokensHistogramData = useTokensHistogramData(spans);
  const costHistogramData = useCostHistogramData(spans);
  const durationTimeseriesData = useTimeseriesData(spans, feedbackMap);
  const tokensTimeseriesData = useTokensTimeseriesData(spans, feedbackMap);
  const costTimeseriesData = useCostTimeseriesData(spans, feedbackMap);

  return (
    <div className="mb-4">
      <Row>
        <Col md={3}>
          <MetricCard 
            label="Duration" 
            value={
              (() => {
                const rootSpans = spans.filter(s => isRootSpan(s));
                const durations = rootSpans.map(s => getDurationMs(s)).filter((d): d is number => d !== null);
                const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
                return (
                  <div>
                    <div>Avg: {durationString(metrics.avgDuration) || 'N/A'}</div>
                    <div className="mt-1">Max: {durationString(maxDuration) || 'N/A'}</div>
                  </div>
                );
              })()
            } 
          />
        </Col>
        <Col md={3}>
          <MetricCard 
            label="Tokens" 
            value={
              <div>
                <div>Avg: {prettyNumber(metrics.tokens.avg)}</div>
                <div className="mt-1">Max: {prettyNumber(metrics.tokens.max)}</div>
                <div className="mt-1">Total: {prettyNumber(metrics.tokens.total)}</div>
              </div>
            } 
          />
        </Col>
        <Col md={3}>
          <MetricCard 
            label="Cost" 
            value={
              <div>
                <div>Avg: ${prettyNumber(metrics.cost.avg)}</div>
                <div className="mt-1">Max: ${prettyNumber(metrics.cost.max)}</div>
                <div className="mt-1">Total: ${prettyNumber(metrics.cost.total)}</div>
              </div>
            } 
          />
        </Col>
        <Col md={3}>
          <MetricCard 
            label="Feedback" 
            value={
              <div>
                <div className="text-success">{FEEDBACK_ICONS.positive} {prettyNumber(metrics.positiveFeedback)}</div>
                <div className="text-danger mt-1">{FEEDBACK_ICONS.negative} {prettyNumber(metrics.negativeFeedback)}</div>
                <div className="mt-1">Total: {prettyNumber(metrics.positiveFeedback + metrics.negativeFeedback)}</div>
              </div>
            } 
          />
        </Col>
      </Row>

      <Card className="mt-3">
        <CardHeader className="d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Metrics Visualization</h5>
          <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </CardHeader>
        <CardBody>
          <Row>
            <Col md={4}>
              <h6 className="text-center mb-3">Duration</h6>
              {viewMode === 'histogram' ? (
                <HistogramChart data={durationHistogramData} />
              ) : (
                <TimeseriesChart data={durationTimeseriesData} />
              )}
            </Col>
            <Col md={4}>
              <h6 className="text-center mb-3">Tokens</h6>
              {viewMode === 'histogram' ? (
                <TokensHistogramChart data={tokensHistogramData} />
              ) : (
                <TokensTimeseriesChart data={tokensTimeseriesData} />
              )}
            </Col>
            <Col md={4}>
              <h6 className="text-center mb-3">Cost</h6>
              {viewMode === 'histogram' ? (
                <CostHistogramChart data={costHistogramData} />
              ) : (
                <CostTimeseriesChart data={costTimeseriesData} />
              )}
            </Col>
          </Row>
        </CardBody>
      </Card>
    </div>
  );
};

export default TracesListDashboard;

