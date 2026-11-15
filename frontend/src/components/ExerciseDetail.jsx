import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useStore from '../store.js';

function CopyPre({ children }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef(null);

  const handleCopy = () => {
    const text = preRef.current?.innerText ?? '';
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div className="relative group mb-2">
      <pre
        ref={preRef}
        className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 overflow-x-auto text-xs"
      >
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white px-1.5 py-0.5 rounded transition-all"
      >
        {copied ? '✓ copied' : 'copy'}
      </button>
    </div>
  );
}

const mdComponents = {
  h1: ({ children }) => <h1 className="text-base font-bold text-white mt-3 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold text-white mt-3 mb-1">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-gray-200 mt-2 mb-1">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-2 text-gray-300 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc list-inside mb-2 space-y-0.5 text-gray-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside mb-2 space-y-0.5 text-gray-300">{children}</ol>
  ),
  li: ({ children }) => <li className="text-gray-300">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
  // Inline code vs fenced code block — react-markdown wraps blocks in <pre><code>
  pre: ({ children }) => <CopyPre>{children}</CopyPre>,
  code: ({ children, className }) => {
    // Fenced code block: has a language className, or children contains a newline (no-language fences)
    const isBlock = className || (typeof children === 'string' && children.includes('\n'));
    if (isBlock) {
      const content = typeof children === 'string' ? children.replace(/\n$/, '') : children;
      return (
        <code className={`text-green-300 font-mono${className ? ` ${className}` : ''}`}>
          {content}
        </code>
      );
    }
    // Inline code
    return (
      <code className="bg-gray-800 text-blue-300 px-1 py-0.5 rounded text-xs font-mono">
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="text-left text-gray-400 font-semibold border-b border-gray-600 pb-1 pr-4">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="text-gray-300 border-b border-gray-800 py-1 pr-4">{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-blue-500 pl-3 my-2 text-gray-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-gray-700 my-3" />,
};

// Hints are single-line — render <p> as inline <span> to avoid block margins
const hintMdComponents = {
  ...mdComponents,
  p: ({ children }) => <span>{children}</span>,
};

export default function ExerciseDetail() {
  const exercise = useStore((s) => s.exercises.find((x) => x.id === s.selectedExerciseId));
  const selectedId = exercise?.id;
  const checkResult = useStore((s) => s.checkResult);
  const handleCheck = useStore((s) => s.checkAnswer);
  const handleReset = useStore((s) => s.resetLab);
  const [showHints, setShowHints] = useState(false);
  const checkResultRef = useRef(null);
  useEffect(() => setShowHints(false), [selectedId]);
  useEffect(() => {
    checkResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [checkResult]);
  if (!selectedId || !exercise) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        {selectedId ? 'Loading…' : 'Select an exercise from the list'}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-900">
      {/* Exercise header */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              {exercise.category}
            </span>
            <h2 className="text-white font-semibold text-base mt-0.5">{exercise.title}</h2>
          </div>
          <span
            className={[
              'text-xs px-2 py-1 rounded font-medium flex-shrink-0 mt-1',
              exercise.difficulty === 'easy'
                ? 'bg-emerald-900 text-emerald-300'
                : exercise.difficulty === 'medium'
                  ? 'bg-yellow-900 text-yellow-300'
                  : 'bg-red-900 text-red-300',
            ].join(' ')}
          >
            {exercise.difficulty}
          </span>
        </div>
      </div>

      {/* Description (scrollable) */}
      <div
        className={`flex-1 overflow-y-auto px-5 py-4 text-sm text-gray-300 leading-relaxed transition-opacity duration-200 opacity-100`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {exercise.description}
        </ReactMarkdown>

        {/* Hints */}
        {exercise.hints?.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowHints((v) => !v)}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
            >
              <span>{showHints ? '▼' : '▶'}</span> Hints ({exercise.hints.length})
            </button>
            {showHints && (
              <ul className="mt-2 space-y-1.5">
                {exercise.hints.map((h, i) => (
                  <li key={i} className="flex gap-2 text-gray-400 text-xs">
                    <span className="text-blue-500 flex-shrink-0">💡</span>
                    <span className="text-gray-300">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={hintMdComponents}>
                        {h}
                      </ReactMarkdown>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Check result */}
        {checkResult && (
          <div
            ref={checkResultRef}
            className={`mt-4 rounded-lg border p-3 ${
              checkResult.passed ? 'border-emerald-700 bg-emerald-950' : 'border-red-800 bg-red-950'
            }`}
          >
            <p
              className={`font-semibold text-sm mb-2 ${checkResult.passed ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {checkResult.passed ? '✓ All checks passed!' : '✗ Some checks failed'}
            </p>
            <div className="space-y-1.5">
              {checkResult.results.map((r, i) => (
                <div key={i} className="text-xs">
                  <div className="flex items-start gap-1.5">
                    <span className={r.passed ? 'text-emerald-400' : 'text-red-400'}>
                      {r.passed ? '✓' : '✗'}
                    </span>
                    <span className="text-gray-300">{r.description}</span>
                  </div>
                  {!r.passed && (
                    <div className="ml-4 mt-0.5 space-y-0.5 text-gray-500">
                      <div>
                        Expected: <code className="text-yellow-400">{r.expected}</code>
                      </div>
                      <div>
                        Got: <code className="text-red-400">{r.actual || '(empty)'}</code>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-5 py-3 border-t border-gray-700 flex gap-2 flex-shrink-0">
        <button
          onClick={handleCheck}
          className={[
            'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
            'bg-blue-600 hover:bg-blue-500 text-white',
          ].join(' ')}
        >
          ✓ Check Answer
        </button>
        <button
          onClick={handleReset}
          className={[
            'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
            'bg-gray-700 hover:bg-gray-600 text-gray-200',
          ].join(' ')}
        >
          ↺ Reset Environment
        </button>
      </div>
    </div>
  );
}
