import React from 'react';
import { Row, Col, Card, CardHeader, CardBody } from 'reactstrap';
import CopyButton from '../generic/CopyButton';
import { useToast } from '../../utils/toast';
import { API_BASE_URL } from '../../api';

interface ApiKeyHowToUseSectionProps {
  organisationId?: string;
  newlyGeneratedKey: string | null;
}

export const ApiKeyHowToUseSection: React.FC<ApiKeyHowToUseSectionProps> = ({ organisationId, newlyGeneratedKey }) => {
  const { showToast } = useToast();
  const curlCommand = `curl -X GET "${API_BASE_URL}/api-key" \\
  -H "Authorization: ApiKey ${newlyGeneratedKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json"`;

  return (
    <Row className="mt-4">
      <Col>
        <Card>
          <CardHeader>
            <h5>Test Your API Key</h5>
          </CardHeader>
          <CardBody>
            <p>Use this curl command to test your API key by fetching its details:</p>
            <div className="d-flex align-items-start gap-2">
              <pre className="bg-light p-3 rounded flex-grow-1" style={{ fontSize: '0.9em', margin: 0, overflowX: 'auto', minWidth: 0, maxWidth: '100%', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {curlCommand}
              </pre>
              <CopyButton
                content={curlCommand}
                className="btn btn-info btn-sm"
                showToast={showToast}
                successMessage="Curl command copied to clipboard!"
                errorMessage="Failed to copy curl command"
              />
            </div>
            <p className="text-muted small mt-2">
              {newlyGeneratedKey? <span>The command above uses your newly generated key.</span>
               : <span>Replace <code>YOUR_API_KEY</code> with your actual API key if you've already saved it.</span>}
            </p>
          </CardBody>
        </Card>
      </Col>
    </Row>
  );
};

