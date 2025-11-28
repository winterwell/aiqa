import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Nav, NavItem, NavLink, TabContent, TabPane } from 'reactstrap';
import { listApiKeys, listDatasets } from '../api';
import { useQuery } from '@tanstack/react-query';

const ExperimentCodePage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [activeTab, setActiveTab] = useState('javascript');

  const { data: apiKeys } = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });
  const apiKey = apiKeys?.[0];
  const {data:datasets} = useQuery({
    queryKey: ['datasets', organisationId],
    queryFn: () => listDatasets(organisationId!),
    enabled: !!organisationId,
  });
  const [datasetId, setDatasetId] = useState('');
  useEffect(() => {
    if (datasets && datasets.length ==1) {
      setDatasetId(datasets[0].id);	
    }
  }, [datasets]);

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>How to Run an Experiment</h1>
          <p className="text-muted">Instructions for running experiments with AIQA</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Card>
            <CardHeader>
              <Nav tabs>
                <NavItem>
                  <NavLink
                    className={activeTab === 'javascript' ? 'active' : ''}
                    onClick={() => setActiveTab('javascript')}
                    style={{ cursor: 'pointer' }}
                  >
                    JavaScript
                  </NavLink>
                </NavItem>
                <NavItem>
                  <NavLink
                    className={activeTab === 'python' ? 'active' : ''}
                    onClick={() => setActiveTab('python')}
                    style={{ cursor: 'pointer' }}
                  >
                    Python
                  </NavLink>
                </NavItem>
                <NavItem>
                  <NavLink
                    className={activeTab === 'api' ? 'active' : ''}
                    onClick={() => setActiveTab('api')}
                    style={{ cursor: 'pointer' }}
                  >
                    API-based
                  </NavLink>
                </NavItem>
              </Nav>
            </CardHeader>
            <CardBody>
              <TabContent activeTab={activeTab}>
                <TabPane tabId="javascript">
                  <h5>Running Experiments with JavaScript</h5>
                  <ol>
                    <li>
                      <strong>Prepare your Dataset</strong> – these are the example inputs that will be tested.
                    </li>
                    <li>
                      <strong>Setup your Metrics</strong>.
                    </li>
                    <li>
                      <strong>Install the client-js library:</strong>
                      <br />
                      <code>npm install @aiqa/client-js</code>
                    </li>
                    <li>
                      <strong>Set your API key:</strong>
                      <br />
                      In .env or otherwise, set: <code>AIQA_API_KEY="{apiKey?.id || 'your-api-key'}"</code>
                    </li>
                    <li>
                      <strong>Use the AIQA ExperimentRunner:</strong>
                      <ul>
                        <li>Fetch the dataset</li>
                        <li>Run the experiment</li>
                        <li>Upload the results</li>
                      </ul>
                    </li>
                    <li>
                      This will create a new experiment here.
                    </li>
                  </ol>
                </TabPane>
                <TabPane tabId="python">
                  <h5>Running Experiments with Python</h5>
                  <ol>
                    <li>
                      <strong>Prepare your Dataset</strong> – these are the example inputs that will be tested.
                    </li>
                    <li>
                      <strong>Setup your Metrics</strong>.
                    </li>
                    <li>
                      <strong>Install the Python client library:</strong>
                      <br />
                      <code>pip install aiqa-client-python</code>
                    </li>
                    <li>
                      <strong>Set your API key:</strong>
                      <br />
                      In your environment or config, set: <code>AIQA_API_KEY="{apiKey?.id || 'your-api-key'}"</code>
                    </li>
                    <li>
                      <strong>Use the AIQA ExperimentRunner:</strong>
                      <ul>
                        <li>Fetch the dataset</li>
                        <li>Run the experiment</li>
                        <li>Upload the results</li>
                      </ul>
                    </li>
                    <li>
                      This will create a new experiment here.
                    </li>
                  </ol>
                </TabPane>
                <TabPane tabId="api">
                  <h5>Running Experiments via API</h5>
                  <ol>
                    <li>
                      <strong>Prepare your Dataset</strong> – these are the example inputs that will be tested.
                    </li>
                    <li>
                      <strong>Setup your Metrics</strong>.
                    </li>
                    <li>
                      <strong>Get your API key:</strong>
                      <br />
                      Your API key: <code>{apiKey?.id || 'your-api-key'}</code>
                    </li>
                    <li>
                      <strong>Fetch the dataset:</strong>
                      <br />
                      <code>GET /dataset/{'{datasetId}'}?organisation_id={'{organisationId}'}</code>
                      <br />
                      <small className="text-muted">Headers: Authorization: Bearer {'{your-api-key}'}</small>
                    </li>
                    <li>
                      <strong>Run your experiment:</strong>
                      <br />
                      Execute your model/function with the dataset inputs and collect traces/spans.
                    </li>
                    <li>
                      <strong>Upload results:</strong>
                      <br />
                      <code>POST /experiment</code>
                      <br />
                      <small className="text-muted">Body: {'{'}organisation_id, dataset_id, summary_results{'}'}</small>
                    </li>
                    <li>
                      This will create a new experiment here.
                    </li>
                  </ol>
                </TabPane>
              </TabContent>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default ExperimentCodePage;

