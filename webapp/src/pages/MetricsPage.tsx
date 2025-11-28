import React from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader } from 'reactstrap';

const MetricsPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Metrics</h1>
          <p className="text-muted">View metrics for organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Card>
            <CardHeader>
              <h5>Metrics Dashboard</h5>
            </CardHeader>
            <CardBody>
              <p>Metrics and analytics will be displayed here.</p>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default MetricsPage;












