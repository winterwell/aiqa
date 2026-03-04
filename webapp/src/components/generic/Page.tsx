import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Container, Row, Col, ListGroup, ListGroupItem, Button, Modal, ModalHeader, ModalBody, ModalFooter } from 'reactstrap';
import CopyButton from './CopyButton';
import { useToast } from '../../utils/toast';
import NameAndDeleteHeader from './NameAndDeleteHeader';
import { updateExample } from '../../api';
import PropInput from './PropInput';

interface PageItem {
  id?: string;
  created?: string | Date;
  updated?: string | Date;
  [key: string]: any; // Allow additional fields
}

interface ItemInfoProps {
  item: PageItem;
  itemType: string;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  showEditorFor?: string[]; // Optional list of properties to show editor for
}

const formatDate = (date: string | Date | undefined): string | null => {
  if (!date) return null;
  return new Date(date).toLocaleString();
};

const ItemInfo: React.FC<ItemInfoProps> = ({ item, itemType, showToast, showEditorFor }) => {
  const infoItems: Array<{ label: string; value: React.ReactNode }> = [];
  const showEditorForNotes = showEditorFor && "notes" in showEditorFor;
  if (item.id) {
    infoItems.push({
      label: 'ID',
      value: (
        <div className="d-flex align-items-center gap-2">
          <code>{item.id}</code>
          <CopyButton
            content={item.id}
            className="btn btn-outline-secondary btn-sm"
            showToast={showToast}
            successMessage="ID copied to clipboard!"
          />
        </div>
      ),
    });
  }

  if (item.created) {
    infoItems.push({
      label: 'Created',
      value: formatDate(item.created),
    });
  }

  if (item.updated) {
    infoItems.push({
      label: 'Updated',
      value: formatDate(item.updated),
    });
  }

  if (infoItems.length === 0) return null;

  const apiSave = itemType && {
    Example: (updates: any) => updateExample(item.organisationId, item.id, updates),
  }[itemType];
  const saveItem = (props: string[]) => {
    const updates: any = {};
    props.forEach(prop => {
      updates[prop] = item[prop];
    });
    apiSave(updates);
    showToast(`${props.join(", ")} saved`);
  };

  return (
    <div className="d-flex flex-column gap-2"><ListGroup flush className="mb-3">
      {infoItems.map((info, idx) => (
        <ListGroupItem key={idx}>
          <div className="d-flex align-items-center gap-2">
            <strong>{info.label}:</strong> {info.value}
          </div>
        </ListGroupItem>
      ))}
    </ListGroup>
    {showEditorForNotes && <PropInput type="textarea" item={item} prop="notes" onChange={(e) => saveItem(["notes"])} />}
    {item.description && <div>
      {item.description && <p>{item.description}</p>}
    </div>}
    </div>
  );
};

interface PageProps {
  /** This is placed within an h1 tag */
  header: React.ReactNode;
  back?: string | React.ReactNode; // URL string or custom ReactNode
  backLabel?: string; // Optional label for back link, e.g. "Dataset" → "← Back to Dataset"
  item?: PageItem;
  itemType?: string; // Type of item, e.g. "Example"
  onDelete?: () => void | Promise<void>; // Optional delete handler
  children: React.ReactNode;
  /** TODO name editing support here instead of NameAndDeleteHeader?? */
  showEditorFor?: string[]; // Optional list of properties to show editor for
}

const Page: React.FC<PageProps> = ({ header, back, backLabel, item, itemType, onDelete, children, showEditorFor }) => {
  const { showToast } = useToast();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const renderBackLink = () => {
    if (!back) return null;
    
    if (typeof back === 'string') {
      const backText = backLabel ? `← Back to ${backLabel}` : '← Back';
      return (
        <Link to={back} className="btn btn-link mb-3">
          {backText}
        </Link>
      );
    }
    
    return <div className="mb-3">{back}</div>;
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    
    setIsDeleting(true);
    try {
      await onDelete();
      setDeleteModalOpen(false);
    } catch (error) {
      showToast(`Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const showDeleteButton = itemType === 'Example' && onDelete;

  // TODO
  // if (showEditorFor && "name" in showEditorFor) {
  //   header = <NameAndDeleteHeader label={itemType} item={item} handleNameChange={() => {}} handleDelete={onDelete} />
  // }

  return (
    <Container className="page">
      <Row>
        <Col>
          {renderBackLink()}
          <div className="d-flex justify-content-between align-items-start mb-2">
            <h1 className="mb-0">{header}</h1>
            {showDeleteButton && (
              <Button
                color="danger"
                size="sm"
                onClick={() => setDeleteModalOpen(true)}
                className="ms-3"
              >
                Delete
              </Button>
            )}
          </div>
          {item && <ItemInfo item={item} itemType={itemType} showToast={showToast} showEditorFor={showEditorFor} />}
        </Col>
      </Row>
      {children}

      {/* Delete Confirmation Modal */}
      {showDeleteButton && (
        <Modal isOpen={deleteModalOpen} toggle={() => setDeleteModalOpen(false)}>
          <ModalHeader toggle={() => setDeleteModalOpen(false)}>
            Delete {itemType}
          </ModalHeader>
          <ModalBody>
            <p>Are you sure you want to delete this {itemType?.toLowerCase()}?</p>
            <p className="text-danger">This action cannot be undone.</p>
          </ModalBody>
          <ModalFooter>
            <Button
              color="danger"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
            <Button color="secondary" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </Container>
  );
};

export default Page;

