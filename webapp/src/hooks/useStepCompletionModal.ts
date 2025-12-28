import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useStepCompletion, getCurrentStepId, STEP_FLOW, StepId } from '../utils/stepProgress';

/**
 * Hook to detect when a step becomes complete and show celebration modal
 */
export function useStepCompletionModal(organisationId: string | undefined) {
  const location = useLocation();
  const completion = useStepCompletion(organisationId);
  const [showModal, setShowModal] = useState(false);
  const [completedStep, setCompletedStep] = useState<StepId | null>(null);
  const previousCompletion = useRef<Partial<Record<StepId, boolean>>>({});
  const isInitialized = useRef(false);
  const initializationTimer = useRef<NodeJS.Timeout | null>(null);

  // Initialize previous completion state after queries have loaded
  useEffect(() => {
    if (!isInitialized.current && organisationId) {
      // Clear any existing timer
      if (initializationTimer.current) {
        clearTimeout(initializationTimer.current);
      }
      // Wait for queries to settle before initializing
      initializationTimer.current = setTimeout(() => {
        previousCompletion.current = { ...completion };
        isInitialized.current = true;
      }, 300);
      return () => {
        if (initializationTimer.current) {
          clearTimeout(initializationTimer.current);
        }
      };
    }
  }, [completion, organisationId]);

  // Check for newly completed steps (only after initialization)
  useEffect(() => {
    if (!isInitialized.current) return;

    // Check all steps for newly completed ones
    let newlyCompleted: StepId | null = null;
    for (const stepId of Object.keys(completion) as StepId[]) {
      const wasComplete = previousCompletion.current[stepId];
      const isNowComplete = completion[stepId];
      if (!wasComplete && isNowComplete) {
        newlyCompleted = stepId;
        break; // Show modal for first newly completed step
      }
    }

    if (newlyCompleted) {
      setCompletedStep(newlyCompleted);
      setShowModal(true);
    }

    // Update previous completion
    previousCompletion.current = { ...completion };
  }, [completion]);

  const handleCloseModal = () => {
    setShowModal(false);
    setCompletedStep(null);
  };

  const stepInfo = completedStep
    ? STEP_FLOW.find((s) => s.id === completedStep)
    : null;

  return {
    showModal,
    completedStep,
    stepLabel: stepInfo?.label || '',
    nextStepPath: organisationId && stepInfo?.nextPath
      ? stepInfo.nextPath(organisationId)
      : undefined,
    onClose: handleCloseModal,
  };
}

