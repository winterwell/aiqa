import React from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter, Button, Input, Label, Alert } from 'reactstrap';

interface CreateApiKeyModalProps {
  isOpen: boolean;
  toggle: () => void;
  newKeyName: string;
  onKeyNameChange: (name: string) => void;
  onCreate: () => void;
  isCreating: boolean;
  createError: string | null;
}

export const CreateApiKeyModal: React.FC<CreateApiKeyModalProps> = ({
  isOpen,
  toggle,
  newKeyName,
  onKeyNameChange,
  onCreate,
  isCreating,
  createError,
}) => {
  return (
    <Modal isOpen={isOpen} toggle={toggle}>
      <ModalHeader toggle={toggle}>Create New API Key</ModalHeader>
      <ModalBody>
        {createError && (
          <Alert color="danger" className="mb-3">
            {createError}
          </Alert>
        )}
        <Label for="keyName">Name (optional)</Label>
        <Input
          type="text"
          id="keyName"
          value={newKeyName}
          onChange={(e) => onKeyNameChange(e.target.value)}
          placeholder="e.g., Production API Key"
        />
        <p className="text-muted small mt-2">
          A name helps you identify this API key later. The key itself will be shown after creation.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={toggle}>
          Cancel
        </Button>
        <Button color="primary" onClick={onCreate} disabled={isCreating}>
          {isCreating ? 'Creating...' : 'Create API Key'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

