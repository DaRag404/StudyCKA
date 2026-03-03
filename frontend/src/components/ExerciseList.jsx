import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store.js';

const EXAM_SECONDS = 2 * 60 * 60; // 2 hours

function useExamTimer() {
  const [seconds, setSeconds] = useState(EXAM_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running && seconds > 0) {
      intervalRef.current = setInterval(() => setSeconds((s) => s - 1), 1000);
    } else {
      clearInterval(intervalRef.current);
      if (seconds === 0) setRunning(false);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, seconds]);

  const toggle = () => setRunning((r) => !r);
  const reset  = () => { setRunning(false); setSeconds(EXAM_SECONDS); };

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const display = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const color = seconds === 0      ? 'text-red-500 animate-pulse'
              : seconds < 5 * 60   ? 'text-red-400'
              : seconds < 10 * 60  ? 'text-yellow-400'
              : running             ? 'text-gray-200'
                                   : 'text-gray-500';

  return { display, running, toggle, reset, color, done: seconds === 0 };
}

const RESOURCES = [
  { label: 'Kubernetes Docs',      url: 'https://kubernetes.io/docs/home/' },
  { label: 'kubectl Cheat Sheet',  url: 'https://kubernetes.io/docs/reference/kubectl/cheatsheet/' },
  { label: 'CKA Exam Info',        url: 'https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/' },
  { label: 'CKA Curriculum',       url: 'https://github.com/cncf/curriculum' },
];

const DIFFICULTY_COLORS = {
  easy:   'bg-emerald-900 text-emerald-300',
  medium: 'bg-yellow-900 text-yellow-300',
  hard:   'bg-red-900 text-red-300',
};

const PROGRESS_ICONS = {
  passed: { icon: '✓', cls: 'text-emerald-400' },
  failed: { icon: '✗', cls: 'text-red-400' },
  none:   { icon: '○', cls: 'text-gray-600' },
};

export default function ExerciseList() {
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const timer = useExamTimer();
  const exercises         = useStore((s) => s.exercises);
  const selectedId        = useStore((s) => s.selectedExerciseId);
  const progress          = useStore((s) => s.exerciseProgress);
  const selectExercise    = useStore((s) => s.selectExercise);
  const sessionStatus     = useStore((s) => s.sessionStatus);
  const resetProgress     = useStore((s) => s.resetProgress);

  const passed = Object.values(progress).filter((v) => v === 'passed').length;

  return (
    <aside className="flex flex-col h-full bg-gray-900 border-r border-gray-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⎈</span>
          <div>
            <h1 className="text-white font-bold text-sm leading-tight">StudyCKA</h1>
            <p className="text-gray-400 text-xs">Kubernetes Lab</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-gray-400">
            Progress:{' '}
            <span className="text-emerald-400 font-semibold">{passed}</span>
            <span className="text-gray-600"> / {exercises.length}</span>
          </div>
          <button
            onClick={() => {
              if (window.confirm('Reset all exercise progress?')) resetProgress();
            }}
            title="Reset progress"
            className="text-gray-600 hover:text-red-400 text-xs transition-colors"
          >
            ↺ Reset
          </button>
        </div>
        {/* Progress bar */}
        <div className="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: exercises.length ? `${(passed / exercises.length) * 100}%` : '0%' }}
          />
        </div>

        {/* Exam timer */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600 text-xs">⏱</span>
            <span className={`font-mono text-xs font-semibold tabular-nums ${timer.color}`}>
              {timer.display}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={timer.toggle}
              title={timer.running ? 'Pause' : 'Start'}
              className="text-gray-500 hover:text-gray-300 text-xs transition-colors px-1"
            >
              {timer.running ? '⏸' : '▶'}
            </button>
            <button
              onClick={timer.reset}
              title="Reset timer"
              className="text-gray-600 hover:text-gray-400 text-xs transition-colors px-1"
            >
              ↺
            </button>
          </div>
        </div>

        {/* Resources dropdown */}
        <div className="mt-2">
          <button
            onClick={() => setResourcesOpen((o) => !o)}
            className="w-full flex items-center justify-between text-xs text-gray-500 hover:text-gray-300 transition-colors py-0.5"
          >
            <span className="flex items-center gap-1.5">
              <span>📚</span>
              <span>Resources</span>
            </span>
            <span className={`transition-transform duration-200 text-base ${resourcesOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {resourcesOpen && (
            <ul className="mt-1 space-y-0.5">
              {RESOURCES.map(({ label, url }) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-400 transition-colors py-0.5 pl-1"
                  >
                    <span className="text-gray-600">↗</span>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Exercise list */}
      <nav className="flex-1 overflow-y-auto py-2">
        {exercises.length === 0 ? (
          <p className="text-gray-500 text-xs px-4 py-4">Loading exercises…</p>
        ) : (
          exercises.map((ex) => {
            const pState = progress[ex.id] ?? 'none';
            const { icon, cls } = PROGRESS_ICONS[pState] ?? PROGRESS_ICONS.none;
            const isSelected = ex.id === selectedId;
            const disabled   = sessionStatus !== 'ready';

            return (
              <button
                key={ex.id}
                onClick={() => !disabled && selectExercise(ex.id)}
                disabled={disabled}
                className={[
                  'w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors',
                  isSelected
                    ? 'bg-blue-900/50 border-l-2 border-blue-400'
                    : 'border-l-2 border-transparent hover:bg-gray-800',
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                ].join(' ')}
              >
                {/* Progress icon */}
                <span className={`text-sm mt-0.5 flex-shrink-0 ${cls}`}>{icon}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-xs font-medium truncate ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                      {ex.order.toString().padStart(2, '0')}. {ex.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-gray-500 text-xs truncate">{ex.category}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${DIFFICULTY_COLORS[ex.difficulty] ?? 'bg-gray-700 text-gray-300'}`}>
                      {ex.difficulty}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </nav>

      {/* Session status footer */}
      <div className={[
        'px-4 py-2 border-t border-gray-700 text-xs flex items-center gap-2',
        sessionStatus === 'ready'     ? 'text-emerald-400' :
        sessionStatus === 'error'     ? 'text-red-400'     :
                                        'text-yellow-400',
      ].join(' ')}>
        <span className={[
          'w-2 h-2 rounded-full flex-shrink-0',
          sessionStatus === 'ready'     ? 'bg-emerald-400 animate-pulse' :
          sessionStatus === 'error'     ? 'bg-red-400' :
                                          'bg-yellow-400 animate-pulse',
        ].join(' ')} />
        {{
          none:       'Not connected',
          starting:   'Starting cluster…',
          waiting:    'Waiting for k3s…',
          ready:      'Cluster ready',
          resetting:  'Resetting environment…',
          error:      'Cluster error',
        }[sessionStatus] ?? sessionStatus}
      </div>
    </aside>
  );
}
