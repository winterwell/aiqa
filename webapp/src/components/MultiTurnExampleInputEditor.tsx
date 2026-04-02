import React from 'react';
import { Button, Input } from 'reactstrap';
import type { MultiTurnRole, MultiTurnTurn } from '../utils/multiTurnExampleInput';

/**
 * Edit {@link Example.input} when stored as &lt;user&gt;/&lt;assistant&gt; tagged multi-turn text.
 */
export default function MultiTurnExampleInputEditor({
  turns,
  onChange,
}: {
  turns: MultiTurnTurn[];
  onChange: (next: MultiTurnTurn[]) => void;
}) {
  const updateTurn = (index: number, patch: Partial<MultiTurnTurn>) => {
    const next = turns.map((t, i) => (i === index ? { ...t, ...patch } : t));
    onChange(next);
  };

  const removeTurn = (index: number) => {
    onChange(turns.filter((_, i) => i !== index));
  };

  const append = (role: MultiTurnRole) => {
    onChange([...turns, { role, content: '' }]);
  };

  return (
    <div>
      {turns.map((turn, index) => (
        <div key={index} className="mb-3 border rounded p-2 bg-light">
          <div className="d-flex align-items-center justify-content-between mb-1 flex-wrap gap-2">
            <Input
              type="select"
              bsSize="sm"
              className="w-auto"
              value={turn.role}
              onChange={(e) => updateTurn(index, { role: e.target.value as MultiTurnRole })}
            >
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
            </Input>
            <Button
              color="link"
              size="sm"
              className="p-0 text-danger"
              onClick={() => removeTurn(index)}
              disabled={turns.length <= 1}
              title={turns.length <= 1 ? 'Keep at least one turn' : 'Remove this turn'}
            >
              Remove
            </Button>
          </div>
          <Input
            type="textarea"
            rows={4}
            value={turn.content}
            onChange={(e) => updateTurn(index, { content: e.target.value })}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
      ))}
      <div className="d-flex flex-wrap gap-2">
        <Button color="primary" size="sm" outline onClick={() => append('user')}>
          + User message
        </Button>
        <Button color="secondary" size="sm" outline onClick={() => append('assistant')}>
          + Assistant message
        </Button>
      </div>
    </div>
  );
}
