import React from 'react';
import { Row, Col } from 'reactstrap';

/** Responsive cols: more items per row as breakpoints widen. Bootstrap stops at `xxl`; `xxxl` is >=1800px in `custom.css`. */
const COLS = { xs: 12, sm: 6, md: 4, lg: 4, xl: 3, xxl: 3, xxxl: 2 } as const;

export default function DashboardStrip({
  children,
  className = 'mt-3',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Row className={className}>
      {React.Children.map(children, (child, index) => {
        if (!child) return null;
        return (
          <Col
            key={index}
            xs={COLS.xs}
            sm={COLS.sm}
            md={COLS.md}
            lg={COLS.lg}
            xl={COLS.xl}
            xxl={COLS.xxl}
            className={`mb-4 col-xxxl-${COLS.xxxl}`}
          >
            {child}
          </Col>
        );
      })}
    </Row>
  );
}
