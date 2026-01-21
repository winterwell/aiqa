import React, { useMemo } from 'react';
import { Row, Col } from 'reactstrap';

/**
 * Responsive dashboard strip that automatically handles column layout for cards.
 * 
 * Calculates optimal column widths based on the number of children:
 * - 1 child: full width (12 columns)
 * - 2 children: 6 columns each
 * - 3 children: 4 columns each
 * - 4 children: 3 columns each
 * - 5+ children: 2 columns each (up to 6 per row)
 * 
 * Responsive breakpoints ensure cards stack appropriately on smaller screens.
 * 
 * Example usage:
 * ```tsx
 * <DashboardStrip>
 *   <MyCard1 />
 *   <MyCard2 />
 *   <MyCard3 />
 * </DashboardStrip>
 * ```
 */
export default function DashboardStrip({ 
	children, 
	className = 'mt-3' 
}: { 
	children: React.ReactNode;
	className?: string;
}) {
	const childCount = useMemo(() => React.Children.count(children), [children]);
	
	// Calculate optimal column widths for different breakpoints
	// Bootstrap breakpoints: xs (default), sm (≥576px), md (≥768px), lg (≥992px), xl (≥1200px), xxl (≥1400px)
	const getResponsiveCols = useMemo(() => {
		// On very small screens (xs): always 1 card per row for readability
		const xs = 12;
		
		// On small screens (sm): up to 2 cards per row, but grow to fill
		const sm = childCount === 1 ? 12 : 6;
		
		// On medium screens (md): up to 4 cards per row, but grow to fill
		const md = childCount === 1 ? 12 : childCount === 2 ? 6 : childCount === 3 ? 4 : 3;
		
		// On large screens (lg): up to 4 cards per row, but grow to fill
		const lg = childCount === 1 ? 12 : childCount === 2 ? 6 : childCount === 3 ? 4 : 3;
		
		// On extra large screens (xl): up to 6 cards per row, but grow to fill
		const xl = childCount === 1 ? 12 : childCount === 2 ? 6 : childCount === 3 ? 4 : childCount === 4 ? 3 : 2;
		
		// On extra extra large screens (xxl): same as xl
		const xxl = xl;
		
		return { xs, sm, md, lg, xl, xxl };
	}, [childCount]);
	
	return (
		<Row className={className}>
			{React.Children.map(children, (child, index) => {
				if (!child) return null;
				
				return (
					<Col 
						xs={getResponsiveCols.xs}
						sm={getResponsiveCols.sm}
						md={getResponsiveCols.md}
						lg={getResponsiveCols.lg}
						xl={getResponsiveCols.xl}
						xxl={getResponsiveCols.xxl}
						key={index}
						className="mb-4"
					>
						{child}
					</Col>
				);
			})}
		</Row>
	);
}

