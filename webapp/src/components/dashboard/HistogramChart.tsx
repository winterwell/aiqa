import React, { useMemo } from 'react';
import Histogram, { type HistogramDataPoint } from '../generic/Histogram';
import { type DurationHistogramDataPoint } from './useTraceMetrics';
import { CHART_HEIGHT } from './chart-constants';

interface HistogramChartProps {
  data: DurationHistogramDataPoint[];
  width?: number | `${number}%`;
  height?: number;
}

/**
 * Histogram chart specifically for duration data with custom formatting.
 * Converts duration-based histogram data to the generic Histogram format.
 */
const HistogramChart: React.FC<HistogramChartProps> = ({ data, width, height = CHART_HEIGHT }) => {
  const histogramData = useMemo<HistogramDataPoint[]>(() => {
    return data.map(({ duration, count }) => ({
      bin: `${(duration / 1000).toFixed(1)}s`,
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
      xAxisLabel="Duration (ms)"
      yAxisLabel="Count"
      horizontalLabels={true}
      tickFormatter={(value) => value}
      tooltipLabelFormatter={(label) => `Duration: ${label}`}
    />
  );
};

export default HistogramChart;

