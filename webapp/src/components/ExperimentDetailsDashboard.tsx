import React, { useMemo } from 'react';
import { Card, CardBody, CardHeader, Alert } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { getDataset } from '../api';
import type Dataset from '../common/types/Dataset';
import type { Metric } from '../common/types/Dataset';
import type Experiment from '../common/types/Experiment';
import Histogram, { createHistogram, type HistogramDataPoint } from './generic/Histogram';
import { asArray } from '../common/utils/miscutils';
import { extractMetricValues } from '../utils/metric-utils';
import DashboardStrip from './DashboardStrip';

type MetricDataResult = {
	metric: Metric;
	values: number[];
	histogram: HistogramDataPoint[];
	min: number;
	max: number;
	mean: number;
	count: number;
	unmeasuredCount: number;
};

/**
 * Process experiment results for each metric, extracting numerical values
 */
function processMetricData(metrics: Metric[], experiment: Experiment): MetricDataResult[] {
	const results = experiment.results || [];
	const totalResults = results.length;
	
	return metrics.map((metric: Metric) => {
		const values = extractMetricValues(metric, results);
		
		const count = values.length;
		const unmeasuredCount = totalResults - count;
		
		let min = 0;
		let max = 0;
		let mean = 0;
		let histogram: HistogramDataPoint[] = [];
		
		if (values.length > 0) {
			min = Math.min(...values);
			max = Math.max(...values);
			mean = values.reduce((sum, val) => sum + val, 0) / values.length;
			histogram = createHistogram(values);
		}
		
		return {
			metric,
			values,
			histogram,
			min,
			max,
			mean,
			count,
			unmeasuredCount,
		};
	});
}

/**
 * Similar to ExperimentListMetricsDashboard, but for a single experiment
 
 * For each metric (with some numerical data):
 * Show a histogram of the scores for that metric.
 * Plus min, max, mean
 * If count < results.length - give the unmeasured count.
 * 
 * If no numerical data, show a message saying so.
 * 
 */
export default function ExperimentDetailsDashboard({ experiment }: { experiment: Experiment }) {
	const { data: dataset, isLoading, error } = useQuery({
		queryKey: ['dataset', experiment.dataset],
		queryFn: () => getDataset(experiment.dataset),
		enabled: !!experiment.dataset,
	});

	// Get metrics from dataset, or extract from results if dataset not available
	const metrics = useMemo(() => {
		const datasetMetrics = asArray(dataset?.metrics);
		const resultMetrics = new Set<string>();
		
		// Also collect metrics from results
		if (experiment.results) {
			experiment.results.forEach(result => {
				if (result.scores) {
					Object.keys(result.scores).forEach(metricName => {
						resultMetrics.add(metricName);
					});
				}
			});
		}
		
		// Combine dataset metrics with result metrics
		const metricMap = new Map<string, Metric>();
		datasetMetrics.forEach(metric => {
			metricMap.set(metric.name, metric);
		});
		
		resultMetrics.forEach(metricName => {
			if (!metricMap.has(metricName)) {
				metricMap.set(metricName, { id: metricName, name: metricName, type: 'number' });
			}
		});
		
		return Array.from(metricMap.values());
	}, [dataset?.metrics, experiment.results]);

	// Process data for each metric
	const metricData = useMemo(() => {
		return processMetricData(metrics, experiment);
	}, [metrics, experiment]);

	// Extract Overall Score from summary_results
	const overallScoreStats = useMemo(() => {
		const summary = experiment.summary_results || {};
		const overallScore = summary['Overall Score'];
		if (!overallScore || typeof overallScore !== 'object') {
			return null;
		}
		
		// Handle both MetricStats format {mean, min, max, var, count} and legacy formats
		const mean = overallScore.mean ?? overallScore.avg ?? overallScore.average ?? null;
		const min = overallScore.min ?? null;
		const max = overallScore.max ?? null;
		const count = overallScore.count ?? null;
		
		if (mean === null || !isFinite(mean)) {
			return null;
		}
		
		return { mean, min, max, count };
	}, [experiment.summary_results]);

	if (isLoading) {
		return (
			<Alert color="info" className="mt-3" fade={false}>
				Loading dataset...
			</Alert>
		);
	}

	if (error) {
		return (
			<Alert color="warning" className="mt-3" fade={false}>
				Could not load dataset, but showing metrics from results.
			</Alert>
		);
	}

	if (metrics.length === 0) {
		return (
			<Alert color="info" className="mt-3" fade={false}>
				No metrics found. Add metrics to the dataset or ensure results contain scores.
			</Alert>
		);
	}

	// Filter to only metrics with numerical data
	const metricsWithData = metricData.filter(md => md.count > 0);

	if (metricsWithData.length === 0 && !overallScoreStats) {
		return (
			<Alert color="info" className="mt-3" fade={false}>
				No numerical data found for any metrics. Ensure experiment results contain numeric scores.
			</Alert>
		);
	}

	return (
		<DashboardStrip>
			{overallScoreStats && (
				<Card key="Overall Score">
					<CardHeader>
						<h5>Overall Score</h5>
						<p className="text-muted small mb-0">Geometric mean of all metrics</p>
					</CardHeader>
					<CardBody>
						<div className="mt-3">
							<p className="mb-1">
								<strong>Statistics:</strong>
							</p>
							<ul className="list-unstyled mb-0">
								{overallScoreStats.count !== null && <li>Count: {overallScoreStats.count}</li>}
								{overallScoreStats.min !== null && <li>Min: {overallScoreStats.min.toFixed(2)}</li>}
								{overallScoreStats.max !== null && <li>Max: {overallScoreStats.max.toFixed(2)}</li>}
								<li>Mean: {overallScoreStats.mean.toFixed(2)}</li>
							</ul>
						</div>
					</CardBody>
				</Card>
			)}
			{metricsWithData.map(({ metric, histogram, min, max, mean, count, unmeasuredCount }) => (
				<MetricDataCard
					key={metric.name}
					metric={metric}
					histogram={histogram}
					min={min}
					max={max}
					mean={mean}
					count={count}
					unmeasuredCount={unmeasuredCount}
					totalResults={experiment.results?.length || 0}
				/>
			))}
		</DashboardStrip>
	);
}

/**
 * Show the info for one metric
 */
function MetricDataCard({ metric, histogram, min, max, mean, count, unmeasuredCount, totalResults }: {
	metric: Metric;
	histogram: HistogramDataPoint[];
	min: number;
	max: number;
	mean: number;
	count: number;
	unmeasuredCount: number;
	totalResults: number;
}) {
	return (
		<Card>
			<CardHeader>
				<h5>{metric.name || metric.id}</h5>
				{metric.description && (
					<p className="text-muted small mb-0">{metric.description}</p>
				)}
				{metric.unit && (
					<span className="badge bg-secondary">{metric.unit}</span>
				)}
			</CardHeader>
			<CardBody>
				{histogram.length === 0 ? (
					<Alert color="warning" className="mb-0" fade={false}>
						No valid data points found for this metric.
					</Alert>
				) : (
					<>
						{unmeasuredCount > 0 && (
							<Alert color="warning" className="mb-2 small" fade={false}>
								{unmeasuredCount} of {totalResults} result{totalResults !== 1 ? 's' : ''} had missing or invalid values.
							</Alert>
						)}
						<Histogram data={histogram} />
						<div className="mt-3">
							<p className="mb-1">
								<strong>Statistics:</strong>
							</p>
							<ul className="list-unstyled mb-0">
								<li>Count: {count}</li>
								<li>Min: {min.toFixed(2)} {metric.unit || ''}</li>
								<li>Max: {max.toFixed(2)} {metric.unit || ''}</li>
								<li>Mean: {mean.toFixed(2)} {metric.unit || ''}</li>
							</ul>
						</div>
					</>
				)}
			</CardBody>
		</Card>
	);
}
