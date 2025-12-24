import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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
	/** Height of the chart in pixels (default: 300) */
	height?: number;
}

/**
 * Histogram component for displaying distribution of numerical values
 */
export default function Histogram({ values, data, numBins = 8, height = 300 }: HistogramProps) {
	const histogramData = data || (values ? createHistogram(values, numBins) : []);

	if (histogramData.length === 0) {
		return null;
	}

	return (
		<ResponsiveContainer width="100%" height={height}>
			<BarChart data={histogramData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
				<CartesianGrid strokeDasharray="3 3" />
				<XAxis 
					dataKey="bin" 
					angle={-45}
					textAnchor="end"
					height={80}
					interval={0}
					tick={{ fontSize: 10 }}
				/>
				<YAxis 
					label={{ value: 'Count', angle: -90, position: 'insideLeft' }}
				/>
				<Tooltip />
				<Bar dataKey="count" fill="#8884d8" />
			</BarChart>
		</ResponsiveContainer>
	);
}




