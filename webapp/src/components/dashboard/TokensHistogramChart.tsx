import React, { useMemo } from 'react';
import Histogram, { type HistogramDataPoint } from '../generic/Histogram';
import { type TokensHistogramDataPoint } from './useTraceMetrics';
import { CHART_HEIGHT } from './chart-constants';

interface TokensHistogramChartProps {
  data: TokensHistogramDataPoint[];
  width?: number | `${number}%`;
  height?: number;
}

/**
 * Histogram chart specifically for tokens data with custom formatting.
 */
const TokensHistogramChart: React.FC<TokensHistogramChartProps> = ({ data, width, height = CHART_HEIGHT }) => {
  const histogramData = useMemo<HistogramDataPoint[]>(() => {
    return data.map(({ tokens, count }) => ({
      bin: `${(tokens / 1000).toFixed(1)}k`,
      count,
    }));
  }, [data]);

  if (histogramData.length === 0) {
    return null;
  }

  return (
    <Histogram 
      data={histogramData} 
      width={width}
      height={height}
      xAxisLabel="Tokens"
      yAxisLabel="Count"
      horizontalLabels={true}
      tickFormatter={(value) => value}
      tooltipLabelFormatter={(label) => `Tokens: ${label}`}
    />
  );
};

export default TokensHistogramChart;

