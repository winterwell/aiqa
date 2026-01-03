import React from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { Nav, NavItem, NavLink } from 'reactstrap';
import { useStepCompletion, STEP_FLOW } from '../utils/stepProgress';
import '../utils/animations.css';

const LeftNav: React.FC = () => {
	const { organisationId } = useParams<{ organisationId: string }>();
	const location = useLocation();
	const completion = useStepCompletion(organisationId);

	// Use STEP_FLOW as the source of truth for navigation items
	const navItems = STEP_FLOW.map(step => ({
		...step,
		path: step.path(organisationId || ''),
	}));

	const isActive = (path: string) => {
		if (path === `/organisation/${organisationId}` || path === '/organisation') {
			return location.pathname === path;
		}
		return location.pathname.startsWith(path);
	};

	// Calculate overall progress
	const totalSteps = navItems.length;
	const completedSteps = navItems.filter(item => completion[item.id]).length;
	const progressPercent = (completedSteps / totalSteps) * 100;
	const isDisabled = (path: string) => path !== '/organisation' && (!organisationId || path.includes('undefined'));

	return (
		<Nav vertical className="p-3 border-end left-nav">
			{/* Progress bar */}
			<div className="progress-section mb-3 w-100">
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

			{navItems.map((item, index) => {
				const isDone = completion[item.id];
				const isCurrent = isActive(item.path);
				const disabled = isDisabled(item.path);
				const isSmall = isDone && (item.id === 'code-setup' || item.id === 'experiment-code');
				return (
					<NavItem key={item.id}>
						<NavLink
							tag={Link}
							to={item.path}
							active={isCurrent}
							className={`nav-link-item mb-2 ${isDone ? 'progress-step-complete' : ''} ${disabled ? 'disabled' : ''}`}
							disabled={disabled}
							style={{
								fontSize: isSmall ? '0.8rem' : '1rem',
							}}
						>
							<Number n={index+1} done={isDone} isCurrent={isCurrent} />
							{item.label}
							{isDone && (
								<span className="ms-2 checkmark-animate checkmark-icon">✓</span>
							)}
						</NavLink>
					</NavItem>
				);
			})}
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

