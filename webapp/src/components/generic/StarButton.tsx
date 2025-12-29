import React, { useState } from 'react';
import { updateSpan } from '../../api';
import { useToast } from '../../utils/toast';
import { Span } from '../../common/types';
import { getSpanId } from '../../utils/span-utils';

interface StarButtonProps {
	span: Span;
	onUpdate?: (updatedSpan: Span) => void;
	size?: 'sm' | 'md' | 'lg';
}

const StarButton: React.FC<StarButtonProps> = ({ span, onUpdate, size = 'md' }) => {
	const [isStarred, setIsStarred] = useState<boolean>((span as any).starred ?? false);
	const [isUpdating, setIsUpdating] = useState<boolean>(false);
	const { showToast } = useToast();

	const sizeClasses = {
		sm: 'fs-6',
		md: 'fs-5',
		lg: 'fs-4'
	};

	const handleClick = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		
		if (isUpdating) return;

		const newStarredValue = !isStarred;
		setIsStarred(newStarredValue);
		setIsUpdating(true);

		try {
			const spanId = getSpanId(span);
			if (!spanId || spanId === 'N/A') {
				throw new Error('Invalid span ID');
			}

			const updatedSpan = await updateSpan(spanId, { starred: newStarredValue });
			
			if (onUpdate) {
				onUpdate(updatedSpan);
			}
		} catch (error: any) {
			// Revert on error
			setIsStarred(!newStarredValue);
			showToast(`Failed to update star: ${error.message}`, 'error');
		} finally {
			setIsUpdating(false);
		}
	};

	return (
		<button
			type="button"
			className="btn btn-link p-0 border-0"
			onClick={handleClick}
			disabled={isUpdating}
			style={{ 
				cursor: isUpdating ? 'wait' : 'pointer',
				color: isStarred ? '#ffc107' : '#6c757d',
				textDecoration: 'none'
			}}
			title={isStarred ? 'Unstar' : 'Star'}
		>
			<span className={sizeClasses[size]}>
				{isStarred ? '★' : '☆'}
			</span>
		</button>
	);
};

export default StarButton;

