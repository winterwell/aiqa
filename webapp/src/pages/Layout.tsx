import React from 'react';
import { Container, Row, Col } from 'reactstrap';
import { useParams } from 'react-router-dom';
import TopNav from './TopNav';
import LeftNav from './LeftNav';
import CelebrationModal from '../components/CelebrationModal';
import { useStepCompletionModal } from '../hooks/useStepCompletionModal';
import '../utils/animations.css';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const modalProps = useStepCompletionModal(organisationId);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopNav />
      <Row className="flex-grow-1 g-0" style={{ margin: 0, flex: '1 1 auto', minHeight: 0 }}>
        <Col xs="auto" className="p-0" style={{ maxWidth: '175px', minWidth: '175px', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <LeftNav />
        </Col>
        <Col className="p-4" style={{ overflow: 'auto', minWidth: 0 }}>
          <div className="page-enter">
            {children}
          </div>
        </Col>
      </Row>
      <CelebrationModal {...modalProps} />
    </div>
  );
};

export default Layout;

