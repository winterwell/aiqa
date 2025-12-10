import React from 'react';

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

/**
 * AIQA Logo Component
 * Displays a stylized logo with optional text
 */
const Logo: React.FC<LogoProps> = ({ size = 48, showText = true, className = '' }) => {
  return (
    <div className={`d-flex align-items-center ${className}`} style={{ gap: '12px' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="aiqa-logo-icon"
      >
        {/* Background circle with gradient */}
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        
        {/* Outer circle */}
        <circle cx="32" cy="32" r="30" fill="url(#logoGradient)" />
        
        {/* Checkmark representing quality assurance */}
        <path
          d="M20 32 L28 40 L44 24"
          stroke="white"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        
        {/* AI symbol - stylized "A" */}
        <path
          d="M32 18 L38 38 M32 18 L26 38 M28 28 L36 28"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.8"
        />
      </svg>
      
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




















