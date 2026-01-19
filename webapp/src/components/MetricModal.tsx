import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter, Form, FormGroup, Button } from 'reactstrap';
import { Metric } from '../common/types/Dataset';
import PropInput from './generic/PropInput';
import {useRerender} from 'rerenderer';
import { getDefaultLLMPrompt } from '../common/llmPromptTemplate';

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
        // Ensure type is set to a valid value
        if (!metricRef.current.type || metricRef.current.type.trim() === '') {
          metricRef.current.type = 'javascript';
        }
        // Initialize prompt for LLM metrics if not present
        if (metricRef.current.type === 'llm' && !metricRef.current.parameters?.prompt) {
          if (!metricRef.current.parameters) {
            metricRef.current.parameters = {};
          }
          const metricName = metricRef.current.name || '';
          metricRef.current.parameters.prompt = getDefaultLLMPrompt(metricName);
        }
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

  // Handle type change and initialize prompt for LLM metrics
  const handleTypeChange = () => {
    if (metricRef.current.type === 'llm') {
      if (!metricRef.current.parameters) {
        metricRef.current.parameters = {};
      }
      if (!metricRef.current.parameters.prompt) {
        const metricName = metricRef.current.name || '';
        metricRef.current.parameters.prompt = getDefaultLLMPrompt(metricName);
      }
    }
    rerender();
  };

  const handleSave = () => {
    // Read directly from the current ref value to ensure we have the latest
    const currentMetric = metricRef.current;
    const name = (currentMetric.name || '').trim();
    let type = (currentMetric.type || '').trim();
    const validTypes = ['javascript', 'llm', 'number'];
    
    if (!name) {
      alert('Name is required');
      return;
    }
    
    // Ensure type is always set to a valid value (default to 'javascript' if empty/invalid)
    if (!type || !validTypes.includes(type)) {
      type = 'javascript';
      currentMetric.type = type as 'javascript' | 'llm' | 'number';
    }
    
    // Update the metric with trimmed values before saving
    currentMetric.name = name;
    currentMetric.type = type as 'javascript' | 'llm' | 'number';
    
    onSave(currentMetric as Metric);
  };


  const metric = metricRef.current;

  return (
    <Modal isOpen={isOpen} toggle={toggle}>
      <ModalHeader toggle={toggle}>
        {isEditing ? 'Edit Metric' : 'Add Metric'}
      </ModalHeader>
      <ModalBody>
        <Form onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}>
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
              onChange={handleTypeChange}
            />
          </FormGroup>
          {metric.type === 'llm' && (
            <FormGroup>
              <PropInput
                label="Prompt *"
                item={metric.parameters || {}}
                prop="prompt"
                type="textarea"
                rows={12}
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
        <Button color="primary" type="submit">
          {isEditing ? 'Save Changes' : 'Add Metric'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default MetricModal;

