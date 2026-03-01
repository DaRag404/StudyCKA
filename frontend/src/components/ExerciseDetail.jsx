import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useStore from '../store.js';

const mdComponents = {
  h1: ({ children }) => <h1 className="text-base font-bold text-white mt-3 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold text-white mt-3 mb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-200 mt-2 mb-1">{children}</h3>,
  p:  ({ children }) => <p className="mb-2 text-gray-300 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5 text-gray-300">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5 text-gray-300">{children}</ol>,
  li: ({ children }) => <li className="text-gray-300">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
  // Inline code vs fenced code block — react-markdown wraps blocks in <pre><code>
  pre: ({ children }) => (
    <pre className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mb-2 overflow-x-auto text-xs">
      {children}
    </pre>
  ),
  code: ({ children, className }) => {
    // If className is set (e.g. language-bash) it came from a fenced block → no extra styling
    if (className) return <code className="text-green-300 font-mono">{children}</code>;
    // Otherwise it's inline code
    return <code className="bg-gray-800 text-blue-300 px-1 py-0.5 rounded text-xs font-mono">{children}</code>;
  },
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="text-left text-gray-400 font-semibold border-b border-gray-600 pb-1 pr-4">{children}</th>,
  td: ({ children }) => <td className="text-gray-300 border-b border-gray-800 py-1 pr-4">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-blue-500 pl-3 my-2 text-gray-400 italic">{children}</blockquote>
  ),
  hr: () => <hr className="border-gray-700 my-3" />,
};

export default function ExerciseDetail() {
  const userId            = useStore((s) => s.userId);
  const selectedId        = useStore((s) => s.selectedExerciseId);
  const sessionStatus     = useStore((s) => s.sessionStatus);
  const setupStatus       = useStore((s) => s.setupStatus);
  const checkResult       = useStore((s) => s.checkResult);
  const setCheckResult    = useStore((s) => s.setCheckResult);
  const clearCheckResult  = useStore((s) => s.clearCheckResult);
  const setSessionStatus  = useStore((s) => s.setSessionStatus);

  const [exercise, setExercise]   = useState(null);
  const [checking, setChecking]   = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showHints, setShowHints] = useState(false);

  // Load exercise detail when selection changes
  useEffect(() => {
    if (!selectedId) { setExercise(null); return; }
    setShowHints(false);
    clearCheckResult();
    fetch(`/api/exercises/${selectedId}`)
      .then((r) => r.json())
      .then(setExercise)
      .catch(console.error);
  }, [selectedId]);

  const settingUp = setupStatus === 'running';
  const isReady   = sessionStatus === 'ready' && !settingUp;

  async function handleCheck() {
    if (!isReady || !selectedId) return;
    setChecking(true);
    try {
      const res  = await fetch(`/api/check/${selectedId}?userId=${userId}`, { method: 'POST' });
      const data = await res.json();
      setCheckResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setChecking(false);
    }
  }

  async function handleReset() {
    if (!selectedId) return;
    setResetting(true);
    clearCheckResult();
    setSessionStatus('resetting');
    try {
      await fetch(`/api/reset/${selectedId}?userId=${userId}`, { method: 'POST' });
      // Poll for ready
      await pollStatus();
    } catch (e) {
      console.error(e);
      setResetting(false);
    }
  }

  async function pollStatus() {
    for (let i = 0; i < 60; i++) {
      await sleep(3000);
      try {
        const res  = await fetch(`/api/session/status?userId=${userId}`);
        const data = await res.json();
        setSessionStatus(data.status, data.error);
        if (data.status === 'ready' || data.status === 'error') break;
      } catch (_) {}
    }
    setResetting(false);
  }

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
          <span className={[
            'text-xs px-2 py-1 rounded font-medium flex-shrink-0 mt-1',
            exercise.difficulty === 'easy'   ? 'bg-emerald-900 text-emerald-300' :
            exercise.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-300'  :
                                               'bg-red-900 text-red-300',
          ].join(' ')}>
            {exercise.difficulty}
          </span>
        </div>
      </div>

      {/* Environment preparation banner */}
      {settingUp && (
        <div className="flex-shrink-0 bg-blue-900/60 border-b border-blue-700 px-5 py-3 flex items-center gap-3">
          <svg className="animate-spin h-4 w-4 text-blue-400 flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
          </svg>
          <div>
            <p className="text-blue-300 text-xs font-semibold">Preparing environment…</p>
            <p className="text-blue-400/70 text-xs mt-0.5">
              Cleaning previous lab resources and setting up <span className="text-blue-300 font-medium">{exercise.title}</span>
            </p>
          </div>
        </div>
      )}

      {/* Description (scrollable) */}
      <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-gray-300 leading-relaxed">
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
                    <code className="text-gray-300">{h}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Check result */}
        {checkResult && (
          <div className={`mt-4 rounded-lg border p-3 ${
            checkResult.passed
              ? 'border-emerald-700 bg-emerald-950'
              : 'border-red-800 bg-red-950'
          }`}>
            <p className={`font-semibold text-sm mb-2 ${checkResult.passed ? 'text-emerald-400' : 'text-red-400'}`}>
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
                      <div>Expected: <code className="text-yellow-400">{r.expected}</code></div>
                      <div>Got:      <code className="text-red-400">{r.actual || '(empty)'}</code></div>
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
          disabled={!isReady || checking}
          className={[
            'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
            isReady && !checking
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed',
          ].join(' ')}
        >
          {checking ? 'Checking…' : '✓ Check Answer'}
        </button>
        <button
          onClick={handleReset}
          disabled={resetting || settingUp || sessionStatus === 'starting' || sessionStatus === 'waiting'}
          className={[
            'flex-1 py-2 px-3 rounded text-sm font-medium transition-colors',
            !resetting && !settingUp
              ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed',
          ].join(' ')}
        >
          {resetting ? 'Resetting…' : settingUp ? 'Setting up…' : '↺ Reset Environment'}
        </button>
      </div>
    </div>
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
