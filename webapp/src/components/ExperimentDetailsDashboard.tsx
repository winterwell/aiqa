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
import { formatMetricValue } from '../utils/span-utils';
import CopyButton from './generic/CopyButton';

type MetricDataResult = {
	metric: Metric;
	values: number[];
	histogram: HistogramDataPoint[];
	min: number;
	max: number;
	mean: number;
	stdDev: number;
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
		let stdDev = 0;
		let histogram: HistogramDataPoint[] = [];
		
		if (values.length > 0) {
			min = Math.min(...values);
			max = Math.max(...values);
			mean = values.reduce((sum, val) => sum + val, 0) / values.length;
			const variance = values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length;
			stdDev = Math.sqrt(variance);
			histogram = createHistogram(values);
		}
		
		return {
			metric,
			values,
			histogram,
			min,
			max,
			mean,
			stdDev,
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
		<DashboardStrip className="mt-3 g-3" layout="dense">
			<OverviewStatisticsCard metricsWithData={metricsWithData} />
			{metricsWithData.map(({ metric, histogram, min, max, mean, count, unmeasuredCount }) => (
				<MetricDataCard
					key={metric.id || metric.name}
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

function OverviewStatisticsCard({ metricsWithData }: { metricsWithData: MetricDataResult[] }) {
	const overviewStatsAsTsv = () => {
		const header = ['Metric', 'Mean', 'Std-dev'].join('\t');
		const rows = metricsWithData.map(({ metric, mean, stdDev }) => {
			const metricLabel = metric.name || metric.id || '';
			return [metricLabel, formatMetricValue(metric, mean), formatMetricValue(metric, stdDev)].join('\t');
		});
		return [header, ...rows].join('\n');
	};

	return (
		<Card>
			<CardHeader className="d-flex justify-content-between align-items-center">
				<h5 className="mb-0">Overview Statistics</h5>
				<CopyButton content={overviewStatsAsTsv} className="btn btn-outline-secondary btn-sm" />
			</CardHeader>
			<CardBody>
				<div className="table-responsive">
					<table className="table table-sm mb-0">
						<thead>
							<tr>
								<th scope="col">Metric</th>
								<th scope="col">Mean</th>
								<th scope="col">Std-dev</th>
							</tr>
						</thead>
						<tbody>
							{metricsWithData.map(({ metric, mean, stdDev }) => (
								<tr key={`overview-${metric.id || metric.name}`}>
									<td>{metric.name || metric.id}</td>
									<td>{formatMetricValue(metric, mean)}</td>
									<td>{formatMetricValue(metric, stdDev)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</CardBody>
		</Card>
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
						<div className="w-100" style={{ marginLeft: "-10px", marginRight: "-10px" /* use the card padding to give the chart more width */}}>
							<Histogram data={histogram} width="100%" height={200} />
						</div>
						<div className="mt-3">
							<p className="mb-1">
								<strong>Statistics:</strong>
							</p>
							<ul className="list-unstyled mb-0">
								<li>Count: {count}</li>
								<li>Min: {formatMetricValue(metric, min)}</li>
								<li>Max: {formatMetricValue(metric, max)}</li>
								<li>Mean: {formatMetricValue(metric, mean)}</li>
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
