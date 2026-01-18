import React, { useState } from 'react';

interface AvatarBadgeProps {
  picture?: string;
  name?: string;
  email?: string;
  size?: number;
  className?: string;
}

/**
 * AvatarBadge Component
 * Displays user profile image with fallback to initials, and name/email
 * Handles expired image links gracefully by detecting load errors
 */
const AvatarBadge: React.FC<AvatarBadgeProps> = ({
  picture,
  name,
  email,
  size = 32,
  className = '',
}) => {
  const [imageError, setImageError] = useState(false);
  const displayName = name || email || 'Profile';

  // Generate initials from name or email
  const getInitials = (): string => {
    if (name) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return '??';
  };

  const showImage = picture && !imageError;
  const initials = getInitials();

  return (
    <span className={`d-inline-flex align-items-center ${className}`}>
      {showImage ? (
        <img
          src={picture}
          alt={displayName}
          className="rounded-circle me-2"
          style={{ width: `${size}px`, height: `${size}px` }}
          onError={() => setImageError(true)}
        />
      ) : (
        <span
          className="rounded-circle me-2 d-inline-flex align-items-center justify-content-center text-white fw-bold"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            backgroundColor: '#6c757d',
            fontSize: `${size * 0.4}px`,
          }}
        >
          {initials}
        </span>
      )}
      <span>{displayName}</span>
    </span>
  );
};

export default AvatarBadge;

