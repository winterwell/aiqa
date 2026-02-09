import React, { useMemo } from 'react';
import { Card, CardBody, CardHeader } from 'reactstrap';


// Standard English stopwords (roughly NLTK/SMART style list) kept local to avoid extra dependency.
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'ain', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'couldn',
  'd', 'did', 'didn', 'do', 'does', 'doesn', 'doing', 'don', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'hadn', 'has', 'hasn', 'have', 'haven', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', 'it', 'its', 'itself', 'just', 'll', 'm', 'ma', 'me', 'mightn',
  'more', 'most', 'mustn', 'my', 'myself', 'needn', 'no', 'nor', 'not', 'now', 'o', 'of', 'off', 'on', 'once', 'only',
  'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 're', 's', 'same', 'shan', 'she', 'should',
  'shouldn', 'so', 'some', 'such', 't', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 've', 'very', 'was',
  'wasn', 'we', 'were', 'weren', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'won', 'wouldn', 'y', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

/** Tokenize and count words; returns entries sorted by count descending. Min length 2, lowercase, no stopwords. */
export function getWordCounts(texts: string[], maxWords = 20): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  const re = /\b[a-z]{2,}\b/gi;
  texts.forEach((s) => {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(s)) !== null) {
      const w = m[0].toLowerCase();
      if (!STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  });
  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxWords);
}

interface WordcloudCardProps {
  texts: string[];
  title?: string;
}

/** Wordcloud from union of attributes.gen_ai.input.messages, attributes.input.messages, attributes.input.message */
const WordcloudCard: React.FC<WordcloudCardProps> = ({ texts, title }) => {
  const words = useMemo(() => {
    return getWordCounts(texts);
  }, [texts]);

  const { minC, maxC } = useMemo(() => {
    if (words.length === 0) return { minC: 0, maxC: 1 };
    const counts = words.map((w) => w.count);
    return { minC: Math.min(...counts), maxC: Math.max(...counts) };
  }, [words]);

  const scale = maxC > minC ? (c: number) => 0.75 + (0.75 * (c - minC)) / (maxC - minC) : () => 1;

  return (
    <Card className="mt-3">
      <CardHeader>
        <h5 className="mb-0">{title || 'Wordcloud'}</h5>
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
