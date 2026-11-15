import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import useStore from '../store.js';

import { attachShell } from '../lab/terminal.js';

export default function TerminalPanel({ onCollapse, onRestore, onExpand, terminalMode }) {
  const sessionStatus = 'ready';
  const lab = useStore((s) => s.lab),
    save = useStore((s) => s.save);
  const containerRef = useRef(null);
  const [epoch, setEpoch] = useState(0);
  const reconnect = () => setEpoch((x) => x + 1);
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      theme: {
        background: '#0a0a0f',
        foreground: '#d4d4d4',
        cursor: '#569cd6',
        black: '#1e1e2e',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#89dceb',
        white: '#cdd6f4',
        brightBlack: '#45475a',
      },
      scrollback: 5000,
      allowTransparency: false,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        (event.key === 'Tab' ||
          event.key === 'F5' ||
          (event.ctrlKey && ['s', 'o', 'w'].includes(event.key)))
      )
        event.preventDefault();
      return true;
    });
    const ro = new ResizeObserver(() => {
      if (containerRef.current?.offsetWidth) fitAddon.fit();
    });
    ro.observe(containerRef.current);
    const disconnect = attachShell(term, lab, save);
    return () => {
      disconnect();
      ro.disconnect();
      term.dispose();
    };
  }, [lab, save, epoch]);
  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Window control dots */}
          <div className="flex gap-1.5 group/dots">
            <button
              onClick={onCollapse}
              title="Collapse terminal"
              className="w-3 h-3 rounded-full bg-red-500/70 hover:bg-red-500 transition-colors flex items-center justify-center"
            >
              <span
                className="hidden group-hover/dots:block text-red-900 leading-none"
                style={{ fontSize: 8, marginTop: -1 }}
              >
                ✕
              </span>
            </button>
            <button
              onClick={onRestore}
              title="Restore split"
              className={`w-3 h-3 rounded-full transition-colors flex items-center justify-center ${
                terminalMode === 'split'
                  ? 'bg-yellow-500/30 cursor-default'
                  : 'bg-yellow-500/70 hover:bg-yellow-500'
              }`}
              disabled={terminalMode === 'split'}
            >
              <span
                className="hidden group-hover/dots:block text-yellow-900 leading-none"
                style={{ fontSize: 8, marginTop: -1 }}
              >
                ↕
              </span>
            </button>
            <button
              onClick={onExpand}
              title="Maximise terminal"
              className={`w-3 h-3 rounded-full transition-colors flex items-center justify-center ${
                terminalMode === 'term-max'
                  ? 'bg-green-500/30 cursor-default'
                  : 'bg-green-500/70 hover:bg-green-500'
              }`}
              disabled={terminalMode === 'term-max'}
            >
              <span
                className="hidden group-hover/dots:block text-green-900 leading-none"
                style={{ fontSize: 8, marginTop: -1 }}
              >
                ⤢
              </span>
            </button>
          </div>
          <span className="text-gray-500 text-xs ml-1 font-mono">bash — cka-lab</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs flex items-center gap-1 ${
              sessionStatus === 'ready'
                ? 'text-emerald-400'
                : sessionStatus === 'error'
                  ? 'text-red-400'
                  : 'text-yellow-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                sessionStatus === 'ready'
                  ? 'bg-emerald-400'
                  : sessionStatus === 'error'
                    ? 'bg-red-400'
                    : 'bg-yellow-400 animate-pulse'
              }`}
            />
            {sessionStatus === 'ready'
              ? 'Connected'
              : sessionStatus === 'error'
                ? 'Error'
                : sessionStatus === 'resetting'
                  ? 'Resetting…'
                  : 'Connecting…'}
          </span>
          <button
            onClick={sessionStatus === 'ready' ? reconnect : undefined}
            disabled={sessionStatus !== 'ready'}
            title="Reconnect terminal"
            className="text-gray-500 hover:text-gray-300 disabled:opacity-30 text-xs transition-colors"
          >
            ↺
          </button>
        </div>
      </div>

      {/* xterm.js mount point */}
      <div ref={containerRef} className="xterm-container flex-1 overflow-hidden" />
    </div>
  );
}
