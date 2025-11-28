import React from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { Nav, NavItem, NavLink } from 'reactstrap';

const LeftNav: React.FC = () => {
	const { organisationId } = useParams<{ organisationId: string }>();
	const location = useLocation();

	const navItems = [
		{
			label: 'Organisation',
			path: `/organisation`,
		},
		{
			label: 'API Key',
			path: `/organisation/${organisationId}/api-key`,
			disabled: !organisationId,
		},
		{
			label: 'Code Setup',
			path: `/organisation/${organisationId}/code-setup`,
			disabled: !organisationId,
		},
		{
			label: 'Traces',
			path: `/organisation/${organisationId}/traces`,
			disabled: !organisationId,
		},
		{
			label: 'Datasets',
			path: `/organisation/${organisationId}/dataset`,
			disabled: !organisationId,
		},
		{
			label: 'Metrics',
			path: `/organisation/${organisationId}/metrics`,
			disabled: !organisationId,
		},
		{
			label: 'Experiment Code',
			path: `/organisation/${organisationId}/experiment-code`,
			disabled: !organisationId,
		},
		{
			label: 'Experiment Results',
			path: `/organisation/${organisationId}/experiments`,
			disabled: !organisationId,
		},
	];

	const isActive = (path: string) => {
		if (path === `/organisation/${organisationId}` || path === '/organisation') {
			return location.pathname === path;
		}
		return location.pathname.startsWith(path);
	};

	return (
		<Nav vertical className="p-3 border-end" style={{ minHeight: 'calc(100vh - 56px)', backgroundColor: '#f8f9fa' }}>
			{navItems.map((item, index) => (
				<NavItem key={item.path}>
					<NavLink
						tag={Link}
						to={item.path}
						active={isActive(item.path)}
						className="mb-2"
						style={{
							cursor: 'pointer',
							borderRadius: '4px',
							padding: '8px 12px',
						}}
						disabled={item.disabled}
					>
						<Number n={index+1} done={true} />
						{item.label}
					</NavLink>
				</NavItem>
			))}
		</Nav>
	);
};


function Number({ n, done }: { n: number, done: boolean }) {
	return (
		<span
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: '24px',
				height: '24px',
				borderRadius: '50%',
				backgroundColor: done ? '#28a745' : '#6c757d',
				color: '#ffffff',
				fontSize: '12px',
				fontWeight: '600',
				marginRight: '8px',
			}}
		>
			{n}
		</span>
	);
}

export default LeftNav;

