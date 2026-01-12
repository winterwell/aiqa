import React, { useMemo } from 'react';
import { Row, Col, Card, CardBody, CardHeader, Alert } from 'reactstrap';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useQueries } from '@tanstack/react-query';
import { getDataset } from '../api';
import type Dataset from '../common/types/Dataset';
import type { Metric } from '../common/types/Dataset';
import type Experiment from '../common/types/Experiment';

type ScatterDataPoint = {
	x: number;
	y: number;
	experimentId: string;
	date: string;
};

type MetricDataResult = {
	metric: Metric;
	data: ScatterDataPoint[];
	ignoredCount: number;
};

/**
 * Process experiments data for a single metric, extracting numeric values and handling missing/invalid data
 */
function processOneMetricData(metric: Metric, experiments: Experiment[], datasetMap: Map<string, Dataset>): MetricDataResult {
	const data: ScatterDataPoint[] = [];
	let ignoredCount = 0;

	experiments.forEach((exp: Experiment) => {
		const dataset = datasetMap.get(exp.dataset);
		// For Overall Score, skip dataset check (it's a computed metric)
		// For other metrics, only process experiments whose dataset has this metric
		if (metric.name !== 'Overall Score') {
			if (!dataset || !dataset.metrics?.some(m => m.name === metric.name)) {
				return;
			}
		}

		const summaryResults = exp.summary_results || {};
		// Try to find the metric value in summary_results
		// It could be directly under the metric name, or under a nested structure
		let metricValue: any = summaryResults[metric.name];
		
		// If the value is an object (nested structure like {mean: 835.8, max: 985, ...}),
		// extract a numeric value from common statistical keys
		if (metricValue !== null && metricValue !== undefined && typeof metricValue === 'object' && !Array.isArray(metricValue)) {
			// Prefer mean, then avg/average, then median, then just take the first numeric value found
			const preferredKeys = ['mean', 'avg', 'average', 'median', 'min', 'max'];
			for (const key of preferredKeys) {
				if (metricValue[key] !== undefined && metricValue[key] !== null) {
					metricValue = metricValue[key];
					break;
				}
			}
			// If no preferred key found, try to find any numeric value in the object
			if (typeof metricValue === 'object') {
				for (const key in metricValue) {
					const val = metricValue[key];
					if (typeof val === 'number' || (typeof val === 'string' && !isNaN(parseFloat(val)))) {
						metricValue = val;
						break;
					}
				}
			}
		}
		
		// If not found directly, try common variations (avg, mean, etc.)
		if (metricValue === undefined || metricValue === null || (typeof metricValue === 'object' && !Array.isArray(metricValue))) {
			const variations = [
				`avg_${metric.name}`,
				`mean_${metric.name}`,
				`${metric.name}_avg`,
				`${metric.name}_mean`,
			];
			for (const variant of variations) {
				if (summaryResults[variant] !== undefined && summaryResults[variant] !== null) {
					metricValue = summaryResults[variant];
					break;
				}
			}
		}

		// Check if the value is numeric
		const numericValue = typeof metricValue === 'number' ? metricValue : 
			(typeof metricValue === 'string' && !isNaN(parseFloat(metricValue)) ? parseFloat(metricValue) : null);

		if (numericValue !== null && !isNaN(numericValue) && isFinite(numericValue)) {
			const date = new Date(exp.created);
			data.push({
				x: date.getTime(), // Use timestamp for X axis
				y: numericValue,
				experimentId: exp.id,
				date: date.toLocaleString(),
			});
		} else {
			ignoredCount++;
		}
	});

	// Sort by date (x value)
	data.sort((a, b) => a.x - b.x);

	return {
		metric,
		data,
		ignoredCount,
	};
}

/**
 * Process experiments data for each metric, extracting numeric values and handling missing/invalid data
 */
function processMetricData(metrics: Metric[], experiments: Experiment[], datasetMap: Map<string, Dataset>): MetricDataResult[] {
	return metrics.map(metric => processOneMetricData(metric, experiments, datasetMap));
}

/**
 * Show analysis of experiments
 */
export default function ExperimentsListMetricsDashboard({ experiments }: { experiments: Experiment[] }) {
	// Extract unique dataset IDs from experiments
	const datasetIds = useMemo(() => {
		const ids = new Set<string>();
		experiments.forEach(exp => {
			if (exp.dataset) {
				ids.add(exp.dataset);
			}
		});
		return Array.from(ids);
	}, [experiments]);

	// Load all datasets
	const datasetQueries = useQueries({
		queries: datasetIds.map(datasetId => ({
			queryKey: ['dataset', datasetId],
			queryFn: () => getDataset(datasetId),
		})),
	});

	// Check if datasets are still loading
	const isLoadingDatasets = datasetQueries.some(query => query.isLoading);
	const datasetErrors = datasetQueries.filter(query => query.error);

	// Create a map of dataset ID to dataset for quick lookup
	const datasetMap = useMemo(() => {
		const map = new Map<string, Dataset>();
		datasetQueries.forEach((query, index) => {
			if (query.data) {
				map.set(datasetIds[index], query.data);
			}
		});
		return map;
	}, [datasetQueries, datasetIds]);

	// Collect all unique metrics from all datasets
	const metrics = useMemo(() => {
		const metricMap = new Map<string, Metric>();
		datasetMap.forEach(dataset => {
			if (dataset.metrics) {
				dataset.metrics.forEach(metric => {
					// Use metric name as key to avoid duplicates
					if (!metricMap.has(metric.name)) {
						metricMap.set(metric.name, metric);
					}
				});
			}
		});
		
		// Also add Overall Score if it exists in any experiment's summary_results
		const hasOverallScore = experiments.some(exp => {
			const summary = exp.summary_results || {};
			const overallScore = summary['Overall Score'];
			return overallScore && (overallScore.mean !== undefined || overallScore.avg !== undefined || overallScore.average !== undefined);
		});
		if (hasOverallScore && !metricMap.has('Overall Score')) {
			metricMap.set('Overall Score', { name: 'Overall Score', type: 'number' });
		}
		
		return Array.from(metricMap.values());
	}, [datasetMap, experiments]);

	// Process data for each metric
	const metricData = useMemo(() => {
		return processMetricData(metrics, experiments, datasetMap);
	}, [metrics, experiments, datasetMap]);

	if (isLoadingDatasets) {
		return (
			<Alert color="info" className="mt-3">
				Loading datasets...
			</Alert>
		);
	}

	if (datasetErrors.length > 0) {
		return (
			<Alert color="danger" className="mt-3">
				Error loading some datasets: {datasetErrors.map(e => e.error instanceof Error ? e.error.message : 'Unknown error').join(', ')}
			</Alert>
		);
	}

	if (metrics.length === 0) {
		return (
			<Alert color="info" className="mt-3">
				No metrics defined for the datasets. Add metrics to see performance analysis.
			</Alert>
		);
	}

	if (experiments.length === 0) {
		return (
			<Alert color="info" className="mt-3">
				No experiments found.
			</Alert>
		);
	}

	// Calculate column width based on number of metrics
	const getColumnWidth = () => {
		if (metrics.length <= 1) return 12;
		if (metrics.length === 2) return 6;
		return 4; // 3 or more metrics
	};
	const colWidth = getColumnWidth();

	// Color palette for scatter points
	const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00', '#ff00ff'];

	return (
		<Row className="mt-3">
			{metricData.map(({ metric, data, ignoredCount }, index) => (
				<Col md={colWidth} key={metric.name} className="mb-4">
					<MetricDataCard
						metric={metric}
						data={data}
						ignoredCount={ignoredCount}
						color={colors[index % colors.length]}
					/>
				</Col>
			))}
		</Row>
	);
}

/**
 * Show the info for one metric
 */
function MetricDataCard({ metric, data, ignoredCount, color }: {
	metric: Metric;
	data: ScatterDataPoint[];
	ignoredCount: number;
	color: string;
}) {
	return (
		<Card>
			<CardHeader>
				<h5>{metric.name}</h5>
				{metric.description && (
					<p className="text-muted small mb-0">{metric.description}</p>
				)}
				{metric.unit && (
					<span className="badge bg-secondary">{metric.unit}</span>
				)}
			</CardHeader>
			<CardBody>
				{data.length === 0 ? (
					<Alert color="warning" className="mb-0">
						No valid data points found for this metric.
						{ignoredCount > 0 && (
							<> {ignoredCount} experiment{ignoredCount !== 1 ? 's' : ''} had missing or invalid values.</>
						)}
					</Alert>
				) : (
					<>
						{ignoredCount > 0 && (
							<Alert color="warning" className="mb-2 small">
								{ignoredCount} experiment{ignoredCount !== 1 ? 's' : ''} had missing or non-numeric values and were ignored.
							</Alert>
						)}
						<ResponsiveContainer width="100%" height={300}>
							<ScatterChart
								margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
							>
								<CartesianGrid strokeDasharray="3 3" />
								<XAxis
									type="number"
									dataKey="x"
									name="Date"
									tickFormatter={(value) => {
										const date = new Date(value);
										return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
									}}
									domain={['dataMin', 'dataMax']}
								/>
								<YAxis
									type="number"
									dataKey="y"
									name={metric.name}
									label={{ value: metric.unit || metric.name, angle: -90, position: 'insideLeft' }}
								/>
								<Tooltip
									cursor={{ strokeDasharray: '3 3' }}
									content={({ active, payload }) => {
										if (active && payload && payload[0]) {
											const data = payload[0].payload;
											return (
												<div className="bg-white p-2 border rounded shadow-sm">
													<p className="mb-1"><strong>{metric.name}</strong></p>
													<p className="mb-1 small">Value: {data.y} {metric.unit || ''}</p>
													<p className="mb-0 small">Date: {data.date}</p>
												</div>
											);
										}
										return null;
									}}
								/>
								<Scatter name={metric.name} data={data} fill={color}>
									{data.map((entry, i) => (
										<Cell key={`cell-${i}`} fill={color} />
									))}
								</Scatter>
							</ScatterChart>
						</ResponsiveContainer>
						<p className="text-muted small mt-2 mb-0">
							{data.length} data point{data.length !== 1 ? 's' : ''} shown
						</p>
					</>
				)}
			</CardBody>
		</Card>
	);
}