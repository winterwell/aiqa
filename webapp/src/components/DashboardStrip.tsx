import React, { useMemo } from 'react';
import { Row, Col } from 'reactstrap';

type DashboardStripLayout = 'auto' | 'dense';
type DashboardStripCols = { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number; xxxl: number };

/**
 * Responsive dashboard strip that handles column layout for cards.
 *
 * - `layout="auto"`: sizes columns based on number of children (historic behaviour).
 * - `layout="dense"`: fixed sizing for dashboards (4 across on laptop, 6 across on large screens).
 *
 * Note: Bootstrap ends at `xxl`. We add a project-specific `xxxl` breakpoint (>=1800px)
 * via CSS in `src/custom.css` using `.col-xxxl-*` classes.
 */
export default function DashboardStrip({
  children,
  className = 'mt-3',
  layout = 'auto',
}: {
  children: React.ReactNode;
  className?: string;
  layout?: DashboardStripLayout;
}) {
  const childCount = useMemo(() => React.Children.count(children), [children]);

  const cols: DashboardStripCols = useMemo(() => {
    if (layout === 'dense') {
      return { xs: 12, sm: 6, md: 4, lg: 3, xl: 2, xxl: 2, xxxl: 2 };
    }

    const xs = 12;
    const sm = childCount === 1 ? 12 : 6;
    const md = childCount === 1 ? 12 : childCount === 2 ? 6 : childCount === 3 ? 4 : 3;
    const lg = childCount === 1 ? 12 : childCount === 2 ? 6 : childCount === 3 ? 4 : 3;
    const xl = childCount === 1 ? 12 : childCount === 2 ? 6 : childCount === 3 ? 4 : childCount === 4 ? 3 : 2;
    const xxl = xl;
    const xxxl = xl;
    return { xs, sm, md, lg, xl, xxl, xxxl };
  }, [childCount, layout]);

  return (
    <Row className={className}>
      {React.Children.map(children, (child, index) => {
        if (!child) return null;
        return (
          <Col
            key={index}
            xs={cols.xs}
            sm={cols.sm}
            md={cols.md}
            lg={cols.lg}
            xl={cols.xl}
            xxl={cols.xxl}
            className={`mb-4 col-xxxl-${cols.xxxl}`}
          >
            {child}
          </Col>
        );
      })}
    </Row>
  );
}

