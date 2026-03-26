import React from 'react';
import { CaretDownIcon, CaretRightIcon, CaretLeftIcon } from "@phosphor-icons/react";

/**
 * A simple expand/collapse control that shows a caret icon.
 * If hasChildren is false, shows a spacer instead of a button.
 */
export default function ExpandCollapseControl({
	direction = 'down',
	hasChildren,
	isExpanded,
	onToggle,
}: {
	direction?: 'down' | 'right';
	hasChildren: boolean;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	if (hasChildren) {
		return (
			<button 
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onToggle();
				}}
				style={{ 
					background: 'none', 
					border: 'none', 
					cursor: 'pointer',
					padding: '2px 5px',
					flexShrink: 0,
					display: 'flex',
					alignItems: 'center'
				}}
				title={isExpanded ? "Collapse" : "Expand"}
			>
				{isExpanded ? 
					(direction === 'down' ? <CaretDownIcon size={14} /> : <CaretRightIcon size={14} />)
					: (direction === 'down' ? <CaretRightIcon size={14} /> : <CaretLeftIcon size={14} />)}
			</button>
		);
	}
	return <span style={{ width: '20px', flexShrink: 0 }}></span>;
}

