import React from 'react';
import { Row, Col } from 'reactstrap';

interface LoadingSpinnerProps {
  message: string;
  subtitle?: string;
  className?: string;
}

/**
 * Reusable loading spinner component for the app.
 * Displays a centered spinner with optional message and subtitle.
 */
export default function LoadingSpinner({ message, subtitle, className = '' }: LoadingSpinnerProps) {
  return (
    <div className={`mt-4 ${className}`}>
      <Row>
        <Col>
          <div className="text-center" style={{ padding: '40px' }}>
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <div style={{ marginTop: '15px' }}>
              <strong>{message}</strong>
              {subtitle && <div className="text-muted" style={{ marginTop: '5px' }}>{subtitle}</div>}
            </div>
          </div>
        </Col>
      </Row>
    </div>
  );
}

