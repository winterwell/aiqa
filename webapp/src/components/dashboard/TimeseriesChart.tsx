import React from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TimeseriesDataPoint } from './useTraceMetrics';
import { CHART_HEIGHT, CHART_COLORS } from './chart-constants';
import { TimeseriesTooltip } from './TimeseriesTooltip';

interface TimeseriesChartProps {
  data: TimeseriesDataPoint[];
  width?: number | `${number}%`;
  height?: number;
}

const getFeedbackColor = (feedback: number): string => {
  if (feedback === 1) return CHART_COLORS.positive;
  if (feedback === -1) return CHART_COLORS.negative;
  return CHART_COLORS.neutral;
};

const TimeseriesChart: React.FC<TimeseriesChartProps> = ({ data, width = "100%", height = CHART_HEIGHT }) => {
  if (!data || data.length === 0) {
    return (
      <div className="text-center p-4 text-muted">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width={width} height={height}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis 
          dataKey="time" 
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(value) => new Date(value).toLocaleTimeString()}
          label={{ value: 'Time', position: 'insideBottom', offset: -5 }}
        />
        <YAxis 
          dataKey="duration" 
          type="number"
          label={{ value: 'Duration (ms)', angle: -90, position: 'insideLeft' }}
        />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={(props: any) => <TimeseriesTooltip {...props} />}
        />
        <Legend />
        <Scatter 
          data={data} 
          fill={CHART_COLORS.primary} 
          name="Traces"
          shape={(props: any) => {
            const { payload, cx, cy } = props;
            const feedback = payload?.feedback ?? 0;
            const fillColor = getFeedbackColor(feedback);
            return <circle cx={cx} cy={cy} r={4} fill={fillColor} />;
          }}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
};

export default TimeseriesChart;

