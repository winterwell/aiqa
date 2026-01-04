import React, { useEffect } from 'react';
import { Container, Row, Col, Card, CardBody, CardHeader } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import Logo from '../components/Logo';
import { getVersion } from '../api';

const AboutPage: React.FC = () => {
  const { data: versionInfo, isLoading: isLoadingVersion, error: versionError } = useQuery({
    queryKey: ['version'],
    queryFn: getVersion,
    retry: 1,
  });

  useEffect(() => {
    console.log('[AboutPage] Query state:', { isLoadingVersion, versionError, versionInfo });
  }, [isLoadingVersion, versionError, versionInfo]);

  return (
    <Container>
      <Row>
        <Col>
          <div className="d-flex align-items-center mb-4">
            <Logo size={48} showText={true} />
          </div>
          <h1>About this App</h1>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col md={8}>
          <Card>
            <CardHeader>
              <h5>Welcome to AIQA</h5>
            </CardHeader>
            <CardBody>
              <p>
                AIQA is a platform for evaluating and improving AI systems through experiments,
                datasets, and comprehensive metrics tracking.
              </p>
              <h6 className="mt-4">Features</h6>
              <ul>
                <li>Create and manage datasets for your AI models</li>
                <li>Run experiments to test different configurations</li>
                <li>Track metrics and performance over time</li>
                <li>Analyze traces and spans for debugging</li>
                <li>Compare results across different experiments</li>
              </ul>
              <h6 className="mt-4">Getting Started</h6>
              <p>
                Start by creating a dataset, then run experiments to evaluate your AI models.
                Use the metrics dashboard to track performance and identify areas for improvement.
              </p>
              {versionError && (
                <div className="mt-4 pt-3 border-top">
                  <small className="text-muted">Version information unavailable: {versionError.message}</small>
                </div>
              )}
              {isLoadingVersion && (
                <div className="mt-4 pt-3 border-top">
                  <small className="text-muted">Loading version information...</small>
                </div>
              )}
              {versionInfo && (
                <div className="mt-4 pt-3 border-top">
                  <h6>Version Information</h6>
                  <dl className="row mb-0">
                    <dt className="col-sm-3">Version:</dt>
                    <dd className="col-sm-9">{versionInfo.VERSION}</dd>
                    <dt className="col-sm-3">Git Commit:</dt>
                    <dd className="col-sm-9">
                      <code className="small">{versionInfo.GIT_COMMIT?.substring(0, 7)}</code>
                    </dd>
                    <dt className="col-sm-3">Build Date:</dt>
                    <dd className="col-sm-9">{new Date(versionInfo.DATE).toLocaleString()}</dd>
                  </dl>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default AboutPage;

