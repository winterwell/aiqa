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
        <defs>
          {/* Gradient for the main circle */}
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          
          {/* Gradient for AI nodes */}
          <linearGradient id="nodeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
        
        {/* Background circle with gradient */}
        <circle cx="32" cy="32" r="30" fill="url(#logoGradient)" />
        
        {/* AI Neural Network Nodes */}
        <g opacity="0.9">
          {/* Top nodes */}
          <circle cx="22" cy="20" r="3" fill="url(#nodeGradient)"/>
          <circle cx="32" cy="16" r="3" fill="url(#nodeGradient)"/>
          <circle cx="42" cy="20" r="3" fill="url(#nodeGradient)"/>
          
          {/* Middle nodes */}
          <circle cx="18" cy="32" r="3" fill="url(#nodeGradient)"/>
          <circle cx="32" cy="32" r="3" fill="url(#nodeGradient)"/>
          <circle cx="46" cy="32" r="3" fill="url(#nodeGradient)"/>
          
          {/* Bottom nodes */}
          <circle cx="22" cy="44" r="3" fill="url(#nodeGradient)"/>
          <circle cx="32" cy="48" r="3" fill="url(#nodeGradient)"/>
          <circle cx="42" cy="44" r="3" fill="url(#nodeGradient)"/>
          
          {/* Key connections */}
          <g stroke="white" strokeWidth="0.8" opacity="0.4">
            <line x1="32" y1="16" x2="18" y2="32"/>
            <line x1="32" y1="16" x2="32" y2="32"/>
            <line x1="32" y1="16" x2="46" y2="32"/>
            <line x1="32" y1="32" x2="22" y2="44"/>
            <line x1="32" y1="32" x2="32" y2="48"/>
            <line x1="32" y1="32" x2="42" y2="44"/>
          </g>
        </g>
        
        {/* QA Checkmark */}
        <path
          d="M 20 32 L 28 40 L 44 24"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.95"
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

























