import React from 'react';
import { Link } from 'react-router-dom';
import { Row, Col, Button } from 'reactstrap';
import HelpText from './generic/HelpText';
import { ChatsIcon } from '@phosphor-icons/react';

interface TraceDetailsPageHeaderProps {
  organisationId: string;
  traceId: string;
  traceIds: string[];
  conversationId: string | null;
  canExpandToConversation: boolean;
  isExpanding: boolean;
  onExpandToConversation: () => void;
}

/**
 * Header component for TraceDetailsPage.
 * Shows trace/conversation title and expand to conversation button.
 */
export default function TraceDetailsPageHeader({
  organisationId,
  traceId,
  traceIds,
  conversationId,
  canExpandToConversation,
  isExpanding,
  onExpandToConversation,
}: TraceDetailsPageHeaderProps) {
  const hasMultipleTraces = traceIds.length > 1;

  return (
    <Row>
      <Col>
        <Link to={`/organisation/${organisationId}/traces`} className="btn btn-link mb-3">
          ← Back to Traces
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <h1 style={{ margin: 0 }}>
            {hasMultipleTraces ? (
              <>Conversation: <code>{conversationId || 'Multiple Traces'}</code></>
            ) : (
              <>Trace: <code>{traceId}</code></>
            )}
          </h1>
          {!hasMultipleTraces && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              {canExpandToConversation ? (
                <Button
                  color="primary"
                  size="sm"
                  onClick={onExpandToConversation}
                  disabled={isExpanding}
                >
                    <ChatsIcon size={16} />
                  {isExpanding && '...'}
                </Button>
              ) : (
                <>
                  <Button color="secondary" size="sm" disabled>
                    <ChatsIcon size={16} />
                  </Button>
                  <HelpText label="Conversation ID Required">
                    To expand to a conversation, this trace needs a gen_ai.conversation.id attribute.
                    Set it using set_conversation_id() in your tracing code to group multiple traces together.
                  </HelpText>
                </>
              )}
            </div>
          )}
        </div>
        {hasMultipleTraces && (
          <div style={{ marginTop: '10px' }}>
            <small className="text-muted">
              Showing {traceIds.length} trace{traceIds.length !== 1 ? 's' : ''} in this conversation
            </small>
          </div>
        )}
      </Col>
    </Row>
  );
}

