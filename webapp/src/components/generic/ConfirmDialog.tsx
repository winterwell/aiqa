import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter, Button } from 'reactstrap';

interface ConfirmDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Function to close the dialog */
  toggle: () => void;
  /** Header text or JSX. Defaults to "Confirm Action" */
  header?: React.ReactNode;
  /** Body text or JSX */
  body?: React.ReactNode;
  /** Optional callback that receives the processing state (true when processing, false when done) */
  setProcessingState?: (processing: boolean) => void;
  /** Called when user confirms. May return a promise. */
  onConfirm: () => void | Promise<void>;
  /** Called when user cancels. Defaults to calling toggle. */
  onCancel?: () => void;
  /** Text for the confirm button. Defaults to "Confirm" */
  confirmButtonText?: string;
  /** Color for the confirm button. Defaults to "primary" */
  confirmButtonColor?: string;
}

/** Reusable confirmation dialog component */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  toggle,
  header = 'Confirm Action',
  body,
  setProcessingState,
  onConfirm,
  onCancel,
  confirmButtonText = 'Confirm',
  confirmButtonColor = 'primary',
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (setProcessingState) {
      setProcessingState(isProcessing);
    }
  }, [isProcessing, setProcessingState]);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
      toggle();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      toggle();
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={handleCancel}>
      <ModalHeader toggle={handleCancel}>{header}</ModalHeader>
      {body && <ModalBody>{body}</ModalBody>}
      <ModalFooter>
        <Button color={confirmButtonColor as any} onClick={handleConfirm} disabled={isProcessing}>
          {isProcessing ? 'Processing...' : confirmButtonText}
        </Button>
        <Button color="secondary" onClick={handleCancel} disabled={isProcessing}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ConfirmDialog;
