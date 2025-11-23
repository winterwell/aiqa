import React from 'react';
import { Container, Row, Col } from 'reactstrap';
import TopNav from './TopNav';
import LeftNav from './LeftNav';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopNav />
      <Row className="flex-grow-1 g-0" style={{ margin: 0 }}>
        <Col xs="auto" className="p-0">
          <LeftNav />
        </Col>
        <Col className="p-4">
          {children}
        </Col>
      </Row>
    </div>
  );
};

export default Layout;

