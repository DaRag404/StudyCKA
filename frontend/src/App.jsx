import React, { useEffect, useRef, useState, useCallback } from 'react';
import ExerciseList from './components/ExerciseList.jsx';
import ExerciseDetail from './components/ExerciseDetail.jsx';
import TerminalPanel from './components/TerminalPanel.jsx';

const MIN_PANEL_PX = 120; // minimum height for either panel
const TOOLBAR_H = 34; // px — height of the terminal toolbar

export default function App() {
  const rightColRef = useRef(null);
  const [descHeight, setDescHeight] = useState(() =>
    Math.min(
      window.innerHeight - MIN_PANEL_PX,
      Number(localStorage.getItem('studycka_split')) || Math.floor(window.innerHeight / 2),
    ),
  ); // px, used in 'split' mode
  const [terminalMode, setTerminalMode] = useState(
    () => localStorage.getItem('studycka_panel') || 'split',
  ); // 'split' | 'term-max' | 'desc-max'

  useEffect(() => {
    localStorage.setItem('studycka_split', String(descHeight));
    localStorage.setItem('studycka_panel', terminalMode);
  }, [descHeight, terminalMode]);

  // ── Drag-to-resize (only active in 'split' mode) ──────────────────────────
  const startResize = useCallback(
    (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = descHeight;

      const onMove = (ev) => {
        const containerH = rightColRef.current?.clientHeight ?? 800;
        const newH = Math.min(
          containerH - MIN_PANEL_PX - 8,
          Math.max(MIN_PANEL_PX, startH + ev.clientY - startY),
        );
        setDescHeight(newH);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [descHeight],
  );

  // ── Terminal window controls ──────────────────────────────────────────────
  const collapseTerminal = useCallback(() => setTerminalMode('desc-max'), []);
  const restoreSplit = useCallback(() => setTerminalMode('split'), []);
  const maximizeTerminal = useCallback(() => setTerminalMode('term-max'), []);

  // ── Layout styles per mode ────────────────────────────────────────────────
  const descStyle = {
    split: { height: descHeight, flexShrink: 0 },
    'term-max': { height: 0, flexShrink: 0, overflow: 'hidden' },
    'desc-max': { flex: '1 1 0', minHeight: 0 },
  }[terminalMode];

  const termStyle = {
    split: { flex: '1 1 0', minHeight: 0 },
    'term-max': { flex: '1 1 0', minHeight: 0 },
    'desc-max': { height: TOOLBAR_H, flexShrink: 0 },
  }[terminalMode];

  return (
    <div className="h-screen flex bg-gray-950 text-gray-100 overflow-hidden">
      {/* Left column: exercise list */}
      <div className="w-72 flex-shrink-0 flex flex-col">
        <ExerciseList />
      </div>

      {/* Right side: vertically resizable split */}
      <div ref={rightColRef} className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Exercise detail panel */}
        <div style={descStyle} className="overflow-hidden flex flex-col">
          <ExerciseDetail />
        </div>

        {/* Drag handle — only visible in split mode */}
        {terminalMode === 'split' && (
          <div
            onMouseDown={startResize}
            className="group relative flex items-center justify-center flex-shrink-0 cursor-row-resize select-none"
            style={{ height: 8 }}
          >
            <div className="absolute inset-0 bg-gray-700 group-hover:bg-blue-600 transition-colors duration-150" />
            <div className="relative z-10 flex gap-1">
              <span className="w-1 h-1 rounded-full bg-gray-500 group-hover:bg-blue-200" />
              <span className="w-1 h-1 rounded-full bg-gray-500 group-hover:bg-blue-200" />
              <span className="w-1 h-1 rounded-full bg-gray-500 group-hover:bg-blue-200" />
            </div>
          </div>
        )}

        {/* Terminal panel */}
        <div style={termStyle} className="overflow-hidden">
          <TerminalPanel
            onCollapse={collapseTerminal}
            onRestore={restoreSplit}
            onExpand={maximizeTerminal}
            terminalMode={terminalMode}
          />
        </div>
      </div>
    </div>
  );
}
