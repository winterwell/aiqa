import React, { useState } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { Nav, NavItem, NavLink, Collapse } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { useStepCompletion, STEP_FLOW } from '../utils/stepProgress';
import { listDatasets } from '../api';
import '../utils/animations.css';

const LeftNav: React.FC = () => {
	const { organisationId } = useParams<{ organisationId: string }>();
	const location = useLocation();
	const navigate = useNavigate();
	const completion = useStepCompletion(organisationId);
	const [animatingDataset, setAnimatingDataset] = useState(false);
	// Auto-open api-key submenu if we're on api-key or llm-key pages
	const isOnApiKeyPage = location.pathname.includes('/api-key') || location.pathname.includes('/llm-key');
	const [apiKeySubMenuOpen, setApiKeySubMenuOpen] = useState(isOnApiKeyPage);

	// Query datasets to check if there's only one
	const { data: datasets } = useQuery({
		queryKey: ['datasets', organisationId],
		queryFn: () => listDatasets(organisationId!),
		enabled: !!organisationId,
	});

	// Use STEP_FLOW as the source of truth for navigation items
	const navItems = STEP_FLOW.map(step => ({
		...step,
		path: step.path(organisationId || ''),
	}));

	const isActive = (path: string, itemId: string) => {
		const currentPath = location.pathname;
		
		// Special handling for organisation: only match exact paths
		if (itemId === 'organisation') {
			return currentPath === '/organisation' || 
			       (organisationId && currentPath === `/organisation/${organisationId}`);
		}
		
		// Special handling for metrics: base path is /metrics but detail pages use /metric (singular)
		if (itemId === 'metrics') {
			const basePath = `/organisation/${organisationId}/metrics`;
			if (currentPath === basePath) {
				return true;
			}
			// Check for detail page: /organisation/{id}/metric/{metricName}
			const detailPathPattern = `/organisation/${organisationId}/metric/`;
			if (currentPath.startsWith(detailPathPattern)) {
				const pathAfterDetail = currentPath.slice(detailPathPattern.length);
				const segments = pathAfterDetail.split('/');
				// Active if there's exactly one segment (the metric name) and no deeper paths
				return segments.length === 1 && segments[0] !== '';
			}
			return false;
		}
		
		// Special handling for experiment-results: exclude experiment-code paths
		if (itemId === 'experiment-results') {
			// Don't match if current path contains experiment-code
			if (currentPath.includes('/experiment-code')) {
				return false;
			}
		}
		
		// Special handling for api-key: check if we're on api-key or llm-key pages
		if (itemId === 'api-key') {
			const apiKeyPath = `/organisation/${organisationId}/api-key`;
			const llmKeyPath = `/organisation/${organisationId}/llm-key`;
			return currentPath === apiKeyPath || currentPath === llmKeyPath;
		}
		
		// For other nav items: match base path or one level deeper (sub-pages)
		if (!currentPath.startsWith(path)) {
			return false;
		}
		
		// If it's exactly the base path, it's active
		if (currentPath === path) {
			return true;
		}
		
		// Check if it's exactly one segment deeper (e.g., /dataset/{id})
		const pathAfterBase = currentPath.slice(path.length);
		// Remove leading slash if present
		const segments = pathAfterBase.replace(/^\//, '').split('/');
		// Active if there's exactly one additional segment (the ID)
		return segments.length === 1 && segments[0] !== '';
	};

	// Calculate overall progress
	const totalSteps = navItems.length;
	const completedSteps = navItems.filter(item => completion[item.id]).length;
	const progressPercent = (completedSteps / totalSteps) * 100;
	const isDisabled = (path: string) => path !== '/organisation' && (!organisationId || path.includes('undefined'));

	return (
		<Nav vertical className="p-3 border-end left-nav" style={{ flex: '1 1 auto', overflow: 'auto' }}>
			{navItems.map((item, index) => {
				const isDone = completion[item.id];
				const isCurrent = isActive(item.path, item.id);
				const disabled = isDisabled(item.path);
				const isSmall = isDone && (item.id === 'code-setup' || item.id === 'experiment-code');
				const isDatasets = item.id === 'datasets';
				const isApiKey = item.id === 'api-key';
				const hasSingleDataset = isDatasets && datasets && Array.isArray(datasets) && datasets.length === 1;
				// Check if currently on a dataset details page (not the list page)
				const isOnDatasetDetailsPage = isDatasets && location.pathname.match(/\/organisation\/[^/]+\/dataset\/[^/]+$/);
				
				
				const handleClick = (e: React.MouseEvent) => {
					// Only auto-navigate if there's a single dataset AND we're not already on a details page
					if (isDatasets && hasSingleDataset && !disabled && !isOnDatasetDetailsPage) {
						e.preventDefault();
						setAnimatingDataset(true);
						// Short animation before navigation
						setTimeout(() => {
							navigate(`/organisation/${organisationId}/dataset/${datasets[0].id}`);
							setAnimatingDataset(false);
						}, 300);
					}
					// Toggle api-key submenu
					if (isApiKey) {
						e.preventDefault();
						setApiKeySubMenuOpen(!apiKeySubMenuOpen);
					}
				};

				return (
					<React.Fragment key={item.id}>
						<NavItem>
							<NavLink
								tag={isApiKey ? 'a' : Link}
								to={isApiKey ? undefined : item.path}
								href={isApiKey ? '#' : undefined}
								onClick={handleClick}
								active={isCurrent}
								className={`nav-link-item mb-2 ${isDone ? 'progress-step-complete' : ''} ${disabled ? 'disabled' : ''} ${animatingDataset && isDatasets ? 'dataset-nav-animate' : ''}`}
								disabled={disabled}
								style={{
									fontSize: isSmall ? '0.8rem' : '1rem',
									cursor: isApiKey ? 'pointer' : undefined,
								}}
							>
								<Number n={index+1} done={isDone} isCurrent={isCurrent} />
								{item.label}
								{isApiKey && (
									<span className="ms-2" style={{ fontSize: '0.8em' }}>
										{apiKeySubMenuOpen ? '▼' : '▶'}
									</span>
								)}
							</NavLink>
						</NavItem>
						{isApiKey && (
							<Collapse isOpen={apiKeySubMenuOpen}>
								<NavItem>
									<NavLink
										tag={Link}
										to={`/organisation/${organisationId}/api-key`}
										active={location.pathname === `/organisation/${organisationId}/api-key`}
										className="nav-link-item mb-2 ms-4"
										style={{ fontSize: '0.9rem' }}
									>
										AIQA Keys
									</NavLink>
								</NavItem>
								<NavItem>
									<NavLink
										tag={Link}
										to={`/organisation/${organisationId}/llm-key`}
										active={location.pathname === `/organisation/${organisationId}/llm-key`}
										className="nav-link-item mb-2 ms-4"
										style={{ fontSize: '0.9rem' }}
									>
										LLM Keys
									</NavLink>
								</NavItem>
							</Collapse>
						)}
					</React.Fragment>
				);
			})}

			{/* Progress bar */}
			<div className="progress-section mt-3 w-100">
				<div className="d-flex justify-content-between align-items-center mb-2">
					<small className="text-muted progress-label">Progress</small>
					<small className="text-muted progress-label">{completedSteps}/{totalSteps}</small>
				</div>
				<div className="progress-bar-container">
					<div
						className="progress-bar-animated"
						style={{
							width: `${progressPercent}%`,
						}}
					/>
				</div>
			</div>
		</Nav>
	);
};


function Number({ n, done, isCurrent }: { n: number, done: boolean, isCurrent?: boolean }) {
	const bgColor = done ? '#28a745' : isCurrent ? '#007bff' : '#6c757d';
	return (
		<span
			className={`step-number ${done ? 'progress-complete' : ''}`}
			style={{
				backgroundColor: bgColor,
				boxShadow: done ? '0 2px 8px rgba(40, 167, 69, 0.3)' : 'none',
			}}
		>
			{n}
		</span>
	);
}

export default LeftNav;

