import React from 'react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, Progress } from 'reactstrap';

export type CopyDatasetPhase = 'confirm' | 'fetching' | 'copying' | 'error';

export interface CopyDatasetModalProps {
  isOpen: boolean;
  onClose: () => void;
  datasetName: string;
  phase: CopyDatasetPhase;
  progress: { current: number; total: number };
  error: string | null;
  onStartCopy: () => void;
}

/** Confirm + progress UI for copying a dataset and all its examples. */
export function CopyDatasetModal({
  isOpen,
  onClose,
  datasetName,
  phase,
  progress,
  error,
  onStartCopy,
}: CopyDatasetModalProps) {
  const copyBusy = phase === 'fetching' || phase === 'copying';
  const displayName = datasetName || 'Dataset';

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      backdrop={copyBusy ? 'static' : true}
      keyboard={!copyBusy}
    >
      <ModalHeader toggle={onClose}>Copy dataset</ModalHeader>
      <ModalBody>
        {phase === 'confirm' && (
          <p className="mb-0">
            Copy will make a fresh dataset and copy all examples from this one. The new dataset will be named{' '}
            <strong>{displayName} (copy)</strong>.
          </p>
        )}
        {phase === 'fetching' && (
          <>
            <p className="text-muted mb-2">Loading examples…</p>
            <Progress animated value={100} aria-label="Loading examples" />
          </>
        )}
        {phase === 'copying' && (
          <>
            <p className="mb-2">
              Copied {progress.current} of {progress.total} example{progress.total === 1 ? '' : 's'}
            </p>
            <Progress
              value={progress.total === 0 ? 100 : (progress.current / progress.total) * 100}
              aria-label="Copy progress"
            />
          </>
        )}
        {phase === 'error' && error && <p className="text-danger mb-0">{error}</p>}
      </ModalBody>
      <ModalFooter>
        {phase === 'confirm' && (
          <>
            <Button color="primary" onClick={() => void onStartCopy()}>
              Copy
            </Button>
            <Button color="secondary" onClick={onClose}>
              Cancel
            </Button>
          </>
        )}
        {(phase === 'fetching' || phase === 'copying') && (
          <Button color="secondary" disabled>
            {phase === 'fetching' ? 'Loading…' : 'Copying…'}
          </Button>
        )}
        {phase === 'error' && (
          <Button color="secondary" onClick={onClose}>
            Close
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
