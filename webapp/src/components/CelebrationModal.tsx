import React, { useEffect, useState, useMemo } from 'react';
import { Modal, ModalBody, Button } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import './CelebrationModal.css';

interface CelebrationModalProps {
  isOpen?: boolean;
  stepLabel: string;
  nextStepPath?: string;
  onClose: () => void;
}

const CELEBRATION_EMOJIS = ['🎉', '✨', '🌟', '🎊', '🚀', '💫', '🎈', '🏆'];
const CONFETTI_COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181'];
const CONFETTI_COUNT = 30;
const CONFETTI_DURATION = 2000;

const CelebrationModal: React.FC<CelebrationModalProps> = ({
  isOpen,
  stepLabel,
  nextStepPath,
  onClose,
}) => {
  const navigate = useNavigate();
  const [showConfetti, setShowConfetti] = useState(false);
  const [emoji] = useState(() => CELEBRATION_EMOJIS[Math.floor(Math.random() * CELEBRATION_EMOJIS.length)]);

  // Generate stable confetti positions - regenerate when modal opens
  const confettiPieces = useMemo(() => {
    if (!isOpen) return [];
    return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    }));
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), CONFETTI_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleNext = () => {
    if (nextStepPath) {
      navigate(nextStepPath);
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered className="celebration-modal">
      <ModalBody className="text-center p-5">
        {showConfetti && (
          <div className="confetti-container">
            {confettiPieces.map((piece) => (
              <div
                key={piece.id}
                className="confetti"
                style={{
                  left: `${piece.left}%`,
                  animationDelay: `${piece.delay}s`,
                  backgroundColor: piece.color,
                }}
              />
            ))}
          </div>
        )}
        <div className="celebration-emoji" style={{ fontSize: '4rem', marginBottom: '1rem' }}>
          {emoji}
        </div>
        <h2 className="mb-3 celebration-title">Congratulations!</h2>
        <p className="lead mb-4">
          You've completed <strong>{stepLabel}</strong>!
        </p>
        <Button
          color="success"
          size="lg"
          onClick={nextStepPath ? handleNext : onClose}
          className="celebration-button"
        >
          {nextStepPath ? 'Continue to Next Step →' : 'Awesome!'}
        </Button>
      </ModalBody>
    </Modal>
  );
};

export default CelebrationModal;

