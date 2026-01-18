import React from 'react';

interface SpinnerProps {
  className?: string;
  size?: 'sm' | 'lg';
  centered?: boolean;
}

/**
 * Generic spinner component using vanilla Bootstrap.
 * Simple and reusable for loading states.
 */
export default function Spinner({ className = '', size, centered = false }: SpinnerProps) {
  const sizeClass = size ? `spinner-border-${size}` : '';
  const wrapperClass = centered ? 'text-center' : '';
  
  return (
    <div className={wrapperClass}>
      <div className={`spinner-border ${sizeClass} ${className}`} role="status">
        <span className="visually-hidden">Loading...</span>
      </div>
    </div>
  );
}

