import React, { useState } from 'react';
import { Button } from 'reactstrap';
import PropInput from './PropInput';
import ConfirmDialog from './ConfirmDialog';

interface NameAndDeleteHeaderProps {
  /** Label before the name input, e.g. "Dataset" or "Experiment" */
  label: string;
  /** Item holding the name (e.g. dataset or experiment) */
  item: Record<string, any>;
  /** Property name for the editable name, typically "name" */
  prop?: string;
  /** Called after the name value is set (e.g. to persist). Omit if name is read-only. */
  handleNameChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** When provided, Delete button and confirm modal are shown. Called on confirm; may return a promise. */
  handleDelete?: () => void | Promise<void>;
  /** Label for delete modal title/body, e.g. "Experiment". Defaults to label. */
  deleteItemTypeLabel?: string;
}

/** Header row: label + name PropInput on the left, optional Delete button + confirm modal on the right. Used by Page header on Dataset/Experiment details. */
const NameAndDeleteHeader: React.FC<NameAndDeleteHeaderProps> = ({
  label,
  item,
  prop = 'name',
  handleNameChange,
  handleDelete,
  deleteItemTypeLabel,
}) => {
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const itemType = deleteItemTypeLabel ?? label;
  const itemTypeLower = itemType.toLowerCase();

  return (
    <>
      <span className="d-flex align-items-center justify-content-between w-100">
        <span className="d-flex align-items-center gap-2">
          <span>{label}:</span>
          <PropInput item={item} prop={prop} label="" placeholder="name" inline onChange={handleNameChange} />
        </span>
        {handleDelete != null && (
          <Button color="danger" size="sm" onClick={() => setDeleteModalOpen(true)} className="ms-2">
            Delete
          </Button>
        )}
      </span>

      {handleDelete != null && (
        <ConfirmDialog
          isOpen={deleteModalOpen}
          toggle={() => setDeleteModalOpen(false)}
          header={`Delete ${itemType}`}
          body={
            <>
              <p>Are you sure you want to delete this {itemTypeLower}?</p>
              <p className="text-danger">This action cannot be undone.</p>
            </>
          }
          onConfirm={handleDelete}
          confirmButtonText="Delete"
          confirmButtonColor="danger"
        />
      )}
    </>
  );
};

export default NameAndDeleteHeader;
