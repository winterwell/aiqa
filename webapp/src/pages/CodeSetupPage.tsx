import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Nav, NavItem, NavLink, TabContent, TabPane } from 'reactstrap';
import { API_BASE_URL, listApiKeys } from '../api';
import { useQuery } from '@tanstack/react-query';
import ApiKey from '../common/types/ApiKey.js';

const CodeSetupPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [activeTab, setActiveTab] = useState('python');

  const {data:apiKeys, isLoading, error} = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });
  const apiKey = apiKeys?.[0];
  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Code Setup</h1>
          <p className="text-muted">Setup instructions for organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Card>
            <CardHeader>
              <Nav tabs>
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
                    className={activeTab === 'javascript' ? 'active' : ''}
                    onClick={() => setActiveTab('javascript')}
                    style={{ cursor: 'pointer' }}
                  >
                    JavaScript
                  </NavLink>
                </NavItem>
				<NavItem>
                  <NavLink
                    className={activeTab === 'golang' ? 'active' : ''}
                    onClick={() => setActiveTab('golang')}
                    style={{ cursor: 'pointer' }}
                  >
                    Golang
                  </NavLink>
                </NavItem>
				<NavItem>
                  <NavLink
                    className={activeTab === 'api' ? 'active' : ''}
                    onClick={() => setActiveTab('api')}
                    style={{ cursor: 'pointer' }}
                  >
                    API
                  </NavLink>
                </NavItem>
              </Nav>
            </CardHeader>
            <CardBody>
              <TabContent activeTab={activeTab}>
                <TabPane tabId="python">
                  <PythonCodeSetupPane apiKey={apiKey} />
                </TabPane>
                <TabPane tabId="javascript">
				<JavaScriptCodeSetupPane apiKey={apiKey} />
                </TabPane>
				<TabPane tabId="golang">
				<GolangCodeSetupPane apiKey={apiKey} />
				</TabPane>
				<TabPane tabId="api">
				<APICodeSetupPane apiKey={apiKey} />
				</TabPane>
              </TabContent>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

function PythonCodeSetupPane({ apiKey }: { apiKey?: ApiKey }) {
  return (
    <div>
      <h5>Python Integration Instructions</h5>
      <h5>Install the Python client</h5>
      <pre>
pip install aiqa-client
      </pre>
	  <p>In .env or otherwise, set the API key and server URL:</p>
	    <p><code>AIQA_API_KEY=your-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
      <h5>Trace your functions</h5>
      <p>
        Use the <code>@WithTracing</code> or <code>@WithTracingAsync</code> decorators from the client. For example:
      </p>
      <pre><code>{`from aiqa import get_client, WithTracing

# Initialize the client
client = get_client()

@WithTracing
def my_function(x):
    return x * 2

result = my_function(5)
      `}</code></pre>

    </div>
  );
}

function JavaScriptCodeSetupPane({ apiKey }: { apiKey?: ApiKey }) {
  return (
    <div>
 <h5>Install the client-js library</h5>
<p><code>npm install @aiqa/client-js</code></p>
<p>In .env or otherwise, set the API key and server URL:</p>
  <p><code>AIQA_API_KEY=your-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
<h5>Wrap the functions you want to trace using the <code>withTracing</code> or <code>withTracingAsync</code> decorators</h5>
<pre><code>{`import { withTracing, withTracingAsync } from '@aiqa/client-js';

const tracedFn = withTracing(fn);

// Just use the tracedFn as normal instead of the original fn
tracedFn(5);`}</code></pre>
<h5>That's it!</h5>
<p>For setting extra attributes and other features - please see <code>tracing.ts</code> in the client-js library.</p>
    </div>
  );
}
function GolangCodeSetupPane({ apiKey }: { apiKey?: ApiKey }) {
  return (
    <div>
      <h5>Install the client-go library</h5>
      <p><code>go get github.com/winterwell/aiqa-client-go</code></p>
      <p>In .env or otherwise, set the API key and server URL:</p>
        <p><code>AIQA_API_KEY=your-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
      <h5>Initialize tracing and wrap functions with <code>WithTracing</code></h5>
      <pre><code>{`import (
    "context"
    "time"
    "github.com/winterwell/aiqa-client-go"
)

func main() {
    // Initialize tracing
    err := aiqa.InitTracing("", "")
    if err != nil {
        panic(err)
    }
    defer func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        aiqa.ShutdownTracing(ctx)
    }()

    // Wrap a function with tracing
    multiply := func(x, y int) int {
        return x * y
    }
    tracedMultiply := aiqa.WithTracing(multiply).(func(int, int) int)
    
    result := tracedMultiply(5, 3)
}`}</code></pre>
      <h5>That's it!</h5>
      <p>For setting extra attributes and other features - please see <code>tracing.go</code> in the client-go library.</p>
    </div>
  );
}

function APICodeSetupPane({ apiKey }: { apiKey?: ApiKey }) {
  return (
    <div>
      <h5>API Integration Instructions</h5>
	  <p>We recommend using a client library if possible.</p>
      <p>
        To add a span via the API, you can use <code>curl</code> to send a POST request to your AIQA server.
        <br/>
        Here is an example:
      </p>
      <pre>
<code>{`curl -X POST \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  http://localhost:4001/span \\
  -d '{
    "organisation": "YOUR_ORGANISATION_ID",
    "traceId": "example-trace-id",
    "name": "operationName",
    "startTime": 1719260281123,
    "endTime": 1719260283123,
    "attributes": {
      "input": {"custom.key": "value"},
      "output": {"custom.key": "value"}
    }
  }'
`}</code>
      </pre>
      <ul>
        <li><strong>organisation</strong>: Your organisation ID (see your environment variables).</li>
        <li><strong>traceId</strong>: Use the same traceId to connect related spans.</li>
        <li><strong>name</strong>: Name of the operation or function.</li>
        <li><strong>startTime/endTime</strong>: Milliseconds since epoch (UTC). Use <code>Date.now()</code> or similar.</li>
        <li><strong>attributes</strong>: (Optional) Custom attributes as key-value pairs.</li>
      </ul>
      <p>
        The <code>X-API-Key</code> header must be set to your API key.<br/>
        You can find your API key and organisation ID in your <code>.env</code> file.
      </p>
    </div>
  );
}

export default CodeSetupPage;

