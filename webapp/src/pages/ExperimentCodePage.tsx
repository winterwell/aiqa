import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Nav, NavItem, NavLink, TabContent, TabPane } from 'reactstrap';
import { API_BASE_URL, listApiKeys, listDatasets } from '../api';
import { useQuery } from '@tanstack/react-query';
import HowToSetYourEnv from '../components/HowToSetYourEnv';

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
    <Container>
      <Row>
        <Col>
          <h1>How to Run an Experiment</h1>
          <p className="text-muted">Instructions for running experiments with AIQA</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Card>
            <div className="p-3 border-bottom">
              <p className="mb-0">
                <strong>For LLM-as-Judge metrics, you can choose:</strong>
                <br />
                Provide us with details, and our server will call the LLM.
                <br />
                or
                <br />
                Call the LLM yourself - the ExperimentRunner contains functions to help.
              </p>
            </div>
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
                    className={activeTab === 'golang' ? 'active' : ''}
                    onClick={() => setActiveTab('golang')}
                    style={{ cursor: 'pointer' }}
                  >
                    Go
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
               
                <TabPanePython datasetId={datasetId} organisationId={organisationId} />
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
						<HowToSetYourEnv />
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
                <TabPaneGolang />
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
						<HowToSetYourEnv />
                    </li>
                    <li>
                      <strong>Fetch the dataset:</strong>
                      <br />
                      <code>GET /dataset/{'{datasetId}'}?organisation={'{organisationId}'}</code>
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
                      <small className="text-muted">Body: {'{'}organisation, dataset, summaries{'}'}</small>
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

function TabPanePython({ datasetId, organisationId }: { datasetId: string; organisationId: string }) {
  const datasetPlaceholder = datasetId || 'YOUR_DATASET_ID';
  const orgPlaceholder = organisationId || 'YOUR_ORGANISATION_ID';
  return (
    <TabPane tabId="python">
<h5>Running Experiments with Python</h5>
<ol>
  <li>
    <strong>Prepare your Dataset</strong> – these are the example inputs that will be tested.
  </li>
  <li>
    <strong>Setup your Metrics</strong> - AIQA always measures latency, token count, and cost. You can add your own metrics too. For example, you can use an LLM-as-Judge metric to score "helpfulness".
  </li>
  <li>
    <strong>Install the Python client library:</strong>
    <br />
    <code>pip install aiqa-client</code>
  </li>
  <li>
<HowToSetYourEnv />
  </li>
  <li>
    <strong>Use the AIQA ExperimentRunner:</strong>
          <pre className="bg-light p-3 mb-2"><code>{`from aiqa import ExperimentRunner

# If you have LLM-as-Judge metrics - the ExperimentRunner needs a way to call the LLM. 
# Default: just set OPENAI_API_KEY or ANTHROPIC_API_KEY in env
# Or: provide a custom llm_call_fn: async (system_prompt, user_message) -> str

runner = ExperimentRunner(
    dataset_id="${datasetPlaceholder}",
)

dataset = runner.get_dataset()  # fetch the dataset
runner.create_experiment({"name": "My experiment"})

# The experiment runner feeds example inputs to your code, then analyses the output and the traces.
# To do this, you need to define an engine function that takes the input and any extra parameters (e.g. model choice or configuration), and returns the output.
# Usually the input_data is from a WithTracing trace. So my_engine will use that to rerun the function.
# You might use mocks for e.g. the database or API calls, depending on your code.

async def my_engine(input_data, parameters):
    return await my_model(input_data, parameters)  # your model call

# Running the experiment is easy!
await runner.run(my_engine)  # runs on all examples, uploads results`}</code></pre>
    <ul>
      <li>Fetch the dataset</li>
      <li>Run the experiment</li>
      <li>Upload the results</li>
    </ul>
  </li>
  <li>
    This will create a new experiment here.
  </li>
  <li>For large datasets, the experiment might take a while to run. You can stop and restart an experiment - just get the experiment ID from here, and run again with that ID.</li>
</ol>
    </TabPane>
  );
}

function TabPaneGolang() {
  return (
    <TabPane tabId="golang">
      <h5>Running Experiments with Go</h5>
      <ol>
        <li>
          <strong>Prepare your Dataset</strong> – these are the example inputs that will be tested.
        </li>
        <li>
          <strong>Setup your Metrics</strong>.
        </li>
        <li>
          <strong>Install the client-go library:</strong>
          <br />
          <code>go get github.com/winterwell/aiqa-client-go</code>
        </li>
        <li>
          <HowToSetYourEnv />
        </li>
        <li>
          <strong>Use the AIQA ExperimentRunner:</strong>
          <ul>
            <li>Create a runner with <code>aiqa.NewExperimentRunner(aiqa.ExperimentRunnerOptions{'{'}...{'}'})</code></li>
            <li>Fetch the dataset with <code>runner.GetDataset(ctx)</code></li>
            <li>Define an engine function <code>func(input, parameters) (output, error)</code> and optional scorer (or nil)</li>
            <li>Run with <code>runner.Run(ctx, engine, scorer)</code></li>
            <li>Get summary with <code>runner.GetSummaryResults(ctx)</code></li>
          </ul>
        </li>
        <li>
          This will create a new experiment here.
        </li>
      </ol>
    </TabPane>
  );
}

export default ExperimentCodePage;

