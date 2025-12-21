import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter, Form, FormGroup, Button } from 'reactstrap';
import { Metric } from '../common/types/Dataset';
import PropInput from './generic/PropInput';
import {useRerender} from 'rerenderer'

interface MetricModalProps {
  isOpen: boolean;
  toggle: () => void;
  onSave: (metric: Metric) => void;
  initialMetric?: Partial<Metric>;
  isEditing: boolean;
}

const MetricModal: React.FC<MetricModalProps> = ({
  isOpen,
  toggle,
  onSave,
  initialMetric,
  isEditing,
}) => {
	
  const metricRef = useRef<Partial<Metric>>({});
  const {rerender} = useRerender();

  useEffect(() => {
    if (isOpen) {
      if (initialMetric) {
        metricRef.current = {...initialMetric};
      } else {
        metricRef.current = {
          name: '',
          description: '',
          unit: '',
          type: 'javascript',
          parameters: {},
        };
      }
      rerender();
    }
  }, [isOpen, initialMetric]);

  const handleSave = () => {
    if (!metricRef.current.name || !metricRef.current.type) {
      alert('Name and Type are required');
      return;
    }
    onSave(metricRef.current as Metric);
  };


  const metric = metricRef.current;

  return (
    <Modal isOpen={isOpen} toggle={toggle}>
      <ModalHeader toggle={toggle}>
        {isEditing ? 'Edit Metric' : 'Add Metric'}
      </ModalHeader>
      <ModalBody>
        <Form>
          <FormGroup>
            <PropInput
              label="Name *"
              item={metric}
              prop="name"
              type="text"
              placeholder="e.g., latency"
              onChange={rerender}
            />
          </FormGroup>
          <FormGroup>
            <PropInput
              label="Type"
			  required
              item={metric}
              prop="type"
              type="select"
              options={['javascript', 'llm', 'number']}
              onChange={rerender}
            />
          </FormGroup>
          {metric.type === 'llm' && (
            <FormGroup>
              <PropInput
                label="Prompt *"
                item={metric.parameters || {}}
                prop="prompt"
                type="textarea"
                rows={5}
                placeholder="Enter the prompt for LLM evaluation"
                onChange={rerender}
              />
            </FormGroup>
          )}
          {metric.type === 'javascript' && (
            <FormGroup>
              <PropInput
                label="Code *"
                item={metric.parameters || {}}
                prop="code"
                type="textarea"
                rows={5}
                placeholder="Enter JavaScript code for evaluation"
                onChange={rerender}
              />
            </FormGroup>
          )}
          <FormGroup>
            <PropInput
              label="Unit"
              item={metric}
              prop="unit"
              type="text"
              placeholder="e.g., ms, USD, tokens"
              onChange={rerender}
            />
          </FormGroup>
          <FormGroup>
            <PropInput
              label="Description"
              item={metric}
              prop="description"
              type="text"
              placeholder="Optional description"
              onChange={rerender}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={toggle}>
          Cancel
        </Button>
        <Button color="primary" onClick={handleSave}>
          {isEditing ? 'Save Changes' : 'Add Metric'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default MetricModal;

