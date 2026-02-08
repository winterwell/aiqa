import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { prettyNumber } from '../../utils/span-utils';

export type HistogramDataPoint = {
	bin: string;
	count: number;
};

/**
 * Create histogram bins from an array of values
 */
export function createHistogram(values: number[], numBins: number = 8): HistogramDataPoint[] {
	if (values.length === 0) return [];
	
	const min = Math.min(...values);
	const max = Math.max(...values);
	
	// Handle edge case where all values are the same
	if (min === max) {
		return [{
			bin: min.toFixed(2),
			count: values.length,
		}];
	}
	
	const binWidth = (max - min) / numBins;
	
	// Create bins
	const bins = new Array(numBins).fill(0).map((_, i) => ({
		binStart: min + i * binWidth,
		binEnd: min + (i + 1) * binWidth,
		count: 0,
	}));
	
	// Count values in each bin
	values.forEach(value => {
		let binIndex = Math.floor((value - min) / binWidth);
		// Handle edge case where value equals max
		if (binIndex >= numBins) binIndex = numBins - 1;
		bins[binIndex].count++;
	});
	
	// Format bin labels
	return bins.map(bin => ({
		bin: `${bin.binStart.toFixed(2)}-${bin.binEnd.toFixed(2)}`,
		count: bin.count,
	}));
}

interface HistogramProps {
	/** Array of numerical values to create histogram from */
	values?: number[];
	/** Pre-computed histogram data (if provided, values will be ignored) */
	data?: HistogramDataPoint[];
	/** Number of bins for the histogram (default: 8) */
	numBins?: number;
	/** Width of the chart in pixels or percentage (default: "100%") */
	width?: number | `${number}%`;
	/** Height of the chart in pixels (default: 300) */
	height?: number;
	/** X-axis label text */
	xAxisLabel?: string;
	/** Y-axis label text */
	yAxisLabel?: string;
	/** Whether to use horizontal labels (default: false, uses angled labels) */
	horizontalLabels?: boolean;
	/** Custom tick formatter for X-axis */
	tickFormatter?: (value: string) => string;
	/** Custom tooltip label formatter */
	tooltipLabelFormatter?: (label: string) => string;
}

/**
 * Histogram component for displaying distribution of numerical values
 */
export default function Histogram({ 
	values, 
	data, 
	numBins = 8, 
	width = "100%",
	height = 200,
	xAxisLabel,
	yAxisLabel = 'Count',
	horizontalLabels = false,
	tickFormatter,
	tooltipLabelFormatter,
}: HistogramProps) {
	const histogramData = data || (values ? createHistogram(values, numBins) : []);

	if (histogramData.length === 0) {
		return null;
	}
	if ( ! tickFormatter) {
		tickFormatter = (value) => {
			return prettyNumber(value);
		};
	}

	return (
		<ResponsiveContainer width={width} height={height}>
			<BarChart data={histogramData} >
				<CartesianGrid strokeDasharray="3 3" />
				<XAxis 
					dataKey="bin" 
					angle={horizontalLabels ? 0 : -45}
					textAnchor={horizontalLabels ? 'middle' : 'end'}
					height={horizontalLabels ? 30 : 30}
					interval={0}
					tick={{ fontSize: 10 }}
					label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined}
					tickFormatter={tickFormatter}
					tickCount={Math.min(histogramData.length, 5)}
				/>
				<YAxis 
					label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined}
				/>
				<Tooltip 
					labelFormatter={tooltipLabelFormatter || ((label) => label)}
				/>
				<Bar dataKey="count" fill="#8884d8" />
			</BarChart>
		</ResponsiveContainer>
	);
}







