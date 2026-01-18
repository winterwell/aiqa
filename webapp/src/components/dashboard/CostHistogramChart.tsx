import React, { useMemo } from 'react';
import Histogram, { type HistogramDataPoint } from '../generic/Histogram';
import { type CostHistogramDataPoint } from './useTraceMetrics';
import { CHART_HEIGHT } from './chart-constants';

interface CostHistogramChartProps {
  data: CostHistogramDataPoint[];
  width?: number | `${number}%`;
  height?: number;
}

/**
 * Histogram chart specifically for cost data with custom formatting.
 */
const CostHistogramChart: React.FC<CostHistogramChartProps> = ({ data, width, height = CHART_HEIGHT }) => {
  const histogramData = useMemo<HistogramDataPoint[]>(() => {
    return data.map(({ cost, count }) => ({
      bin: `$${cost.toFixed(4)}`,
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
      xAxisLabel="Cost (USD)"
      yAxisLabel="Count"
      horizontalLabels={true}
      tickFormatter={(value) => value}
      tooltipLabelFormatter={(label) => `Cost: ${label}`}
    />
  );
};

export default CostHistogramChart;

