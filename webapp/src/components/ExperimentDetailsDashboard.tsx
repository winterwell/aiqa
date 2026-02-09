import React, { useMemo } from 'react';
import { Card, CardBody, CardHeader, Alert } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { getDataset } from '../api';
import type Dataset from '../common/types/Dataset';
import type Metric from '../common/types/Metric';
import type Experiment from '../common/types/Experiment';
import Histogram, { createHistogram, type HistogramDataPoint } from './generic/Histogram';
import { asArray } from '../common/utils/miscutils';
import { extractMetricValues, getMetrics } from '../utils/metric-utils';
import DashboardStrip from './DashboardStrip';
import { durationString, prettyNumber } from '../utils/span-utils';

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
	const metrics = getMetrics(dataset);

	// Process data for each metric
	const metricData = useMemo(() => {
		return processMetricData(metrics, experiment);
	}, [metrics, experiment]);

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

	if (metricsWithData.length === 0) {
		return (
			<Alert color="info" className="mt-3" fade={false}>
				No numerical data found for any metrics. Ensure experiment results contain numeric scores.
			</Alert>
		);
	}

	return (
		<DashboardStrip>
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
	const str4num = metric.unit == "ms" ? durationString : prettyNumber;
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
						
						<Histogram data={histogram} />
						<div className="mt-3">
							<p className="mb-1">
								<strong>Statistics:</strong>
							</p>
							<ul className="list-unstyled mb-0">
								<li>Count: {count}</li>
								<li>Min: {str4num(min)} {metric.unit || ''}</li>
								<li>Max: {str4num(max)} {metric.unit || ''}</li>
								<li>Mean: {str4num(mean)} {metric.unit || ''}</li>
							</ul>
							{unmeasuredCount > 0 && (
							<Alert color="warning" className="mb-2 p-1 small" fade={false}>
								{unmeasuredCount} of {totalResults} missing values.
							</Alert>
						)}
						</div>
					</>
				)}
			</CardBody>
		</Card>
	);
}
