import React, { useEffect, useRef } from 'react';
import useStore from './store.js';
import ExerciseList   from './components/ExerciseList.jsx';
import ExerciseDetail from './components/ExerciseDetail.jsx';
import TerminalPanel  from './components/TerminalPanel.jsx';

const POLL_INTERVAL = 3000; // ms

export default function App() {
  const userId           = useStore((s) => s.userId);
  const sessionStatus    = useStore((s) => s.sessionStatus);
  const setSessionStatus = useStore((s) => s.setSessionStatus);
  const setExercises     = useStore((s) => s.setExercises);

  const pollingRef = useRef(null);

  // Bootstrap session on mount
  useEffect(() => {
    fetch('/api/exercises')
      .then((r) => r.json())
      .then(setExercises)
      .catch(console.error);

    initSession();
  }, []);

  async function initSession() {
    try {
      const res  = await fetch('/api/session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId }),
      });
      const data = await res.json();
      setSessionStatus(data.status);

      if (data.status !== 'ready' && data.status !== 'error') {
        startPolling();
      }
    } catch (e) {
      console.error('[session] init failed:', e);
      setSessionStatus('error', e.message);
    }
  }

  function startPolling() {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/session/status?userId=${userId}`);
        const data = await res.json();
        setSessionStatus(data.status, data.error);

        if (data.status === 'ready' || data.status === 'error') {
          stopPolling();
        }
      } catch (_) {}
    }, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  // Re-start polling when status goes back to a transient state (reset flow)
  useEffect(() => {
    const transient = ['starting', 'waiting', 'resetting'];
    if (transient.includes(sessionStatus)) {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [sessionStatus]);

  return (
    <div className="h-screen flex bg-gray-950 text-gray-100 overflow-hidden">
      {/* Left column: exercise list */}
      <div className="w-72 flex-shrink-0 flex flex-col">
        <ExerciseList />
      </div>

      {/* Right side: split vertically between detail and terminal */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Exercise detail pane (fixed height) */}
        <div className="h-80 flex-shrink-0 border-b border-gray-700 flex flex-col">
          <ExerciseDetail />
        </div>

        {/* Terminal fills remaining space */}
        <div className="flex-1 min-h-0">
          <TerminalPanel />
        </div>
      </div>
    </div>
  );
}
