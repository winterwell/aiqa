import React, { useMemo } from 'react';
import { Card, CardBody, CardHeader } from 'reactstrap';
import { Span } from '../../common/types';
import { extractMessageTextsFromSpans, getWordCounts } from '../../utils/wordcloud-utils';

interface WordcloudCardProps {
  spans: Span[];
}

/** Wordcloud from union of attributes.gen_ai.input.messages, attributes.input.messages, attributes.input.message */
const WordcloudCard: React.FC<WordcloudCardProps> = ({ spans }) => {
  const words = useMemo(() => {
    const texts = extractMessageTextsFromSpans(spans);
    return getWordCounts(texts);
  }, [spans]);

  const { minC, maxC } = useMemo(() => {
    if (words.length === 0) return { minC: 0, maxC: 1 };
    const counts = words.map((w) => w.count);
    return { minC: Math.min(...counts), maxC: Math.max(...counts) };
  }, [words]);

  const scale = maxC > minC ? (c: number) => 0.75 + (0.75 * (c - minC)) / (maxC - minC) : () => 1;

  return (
    <Card className="mt-3">
      <CardHeader>
        <h5 className="mb-0">Input wordcloud</h5>
      </CardHeader>
      <CardBody>
        {words.length === 0 ? (
          <p className="text-muted small mb-0">No message content in attributes (gen_ai.input.messages, input.messages, input.message).</p>
        ) : (
          <div className="d-flex flex-wrap gap-2 align-items-baseline" style={{ lineHeight: 1.8 }}>
            {words.map(({ word, count }) => (
              <span
                key={word}
                style={{ fontSize: `${scale(count)}rem` }}
                className="text-secondary"
                title={`${count}`}
              >
                {word}
              </span>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
};

export default WordcloudCard;
