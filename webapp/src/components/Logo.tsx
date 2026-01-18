import React from 'react';

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

/**
 * AIQA Logo Component
 * Displays the logo from aiqa-badge.svg with optional text
 */
const Logo: React.FC<LogoProps> = ({ size = 48, showText = true, className = '' }) => {
  // aiqa-badge.svg has viewBox="0 0 200 200" (1:1 aspect ratio)
  // Calculate height to maintain aspect ratio
  const height = size;
  
  return (
    <div className={`d-flex align-items-center ${className}`} style={{ gap: '12px' }}>
      <img
        src="/aiqa-badge.svg"
        alt="AIQA Logo"
        width={size}
        height={height}
        className="aiqa-logo-icon"
        style={{ display: 'block' }}
      />
      
      {showText && (
        <span
          className="aiqa-logo-text"
          style={{
            fontSize: `${size * 0.75}px`,
            fontWeight: '700',
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.5px',
          }}
        >
          AIQA
        </span>
      )}
    </div>
  );
};

export default Logo;
















