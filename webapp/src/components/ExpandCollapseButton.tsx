import { CaretDown, CaretUp } from "@phosphor-icons/react";

export default function ExpandCollapseButton({ 
	expanded, 
	onClick 
}: { 
	expanded: boolean; 
	onClick: () => void;
}) {
	return (
		<button 
			className="btn btn-sm btn-outline-secondary"
			onClick={onClick}
			title={expanded ? "Collapse" : "Expand"}
		>
			{expanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
		</button>
	);
}

