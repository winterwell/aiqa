import React from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TokensTimeseriesDataPoint } from './useTraceMetrics';
import { CHART_HEIGHT } from './chart-constants';

interface TokensTimeseriesChartProps {
  data: TokensTimeseriesDataPoint[];
  width?: number | `${number}%`;
  height?: number;
}

const TokensTimeseriesChart: React.FC<TokensTimeseriesChartProps> = ({ data, width = "100%", height = CHART_HEIGHT }) => {
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
          dataKey="tokens" 
          type="number"
          label={{ value: 'Tokens', angle: -90, position: 'insideLeft' }}
        />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (active && payload && payload[0]) {
              const data = payload[0].payload as TokensTimeseriesDataPoint;
              return (
                <div className="bg-white p-2 border rounded shadow">
                  <p className="mb-1"><strong>Time:</strong> {new Date(data.time).toLocaleString()}</p>
                  <p className="mb-0"><strong>Tokens:</strong> {data.tokens.toLocaleString()}</p>
                </div>
              );
            }
            return null;
          }}
        />
        <Scatter 
          data={data} 
          fill="#8884d8" 
          name="Tokens"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
};

export default TokensTimeseriesChart;

