import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import useStore from '../store.js';

export default function TerminalPanel({ onCollapse, onRestore, onExpand, terminalMode }) {
  const userId        = useStore((s) => s.userId);
  const sessionStatus = useStore((s) => s.sessionStatus);
  const setupStatus   = useStore((s) => s.setupStatus);

  const containerRef = useRef(null);
  const termRef      = useRef(null);
  const fitRef       = useRef(null);
  const wsRef        = useRef(null);
  const roRef        = useRef(null);

  /** Build the WebSocket URL — includes current terminal dimensions so the
   *  backend can start the PTY exec at the right size immediately. */
  function buildWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    try { fitRef.current?.fit(); } catch (_) {}
    const cols = termRef.current?.cols ?? 220;
    const rows = termRef.current?.rows ?? 50;
    return `${proto}://${window.location.host}/terminal?userId=${userId}&cols=${cols}&rows=${rows}`;
  }

  /** Mount xterm.js once on first render. */
  useEffect(() => {
    const term = new Terminal({
      cursorBlink:       true,
      fontSize:          14,
      fontFamily:        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      theme: {
        background:  '#0a0a0f',
        foreground:  '#d4d4d4',
        cursor:      '#569cd6',
        black:       '#1e1e2e',
        red:         '#f38ba8',
        green:       '#a6e3a1',
        yellow:      '#f9e2af',
        blue:        '#89b4fa',
        magenta:     '#cba6f7',
        cyan:        '#89dceb',
        white:       '#cdd6f4',
        brightBlack: '#45475a',
      },
      scrollback:        5000,
      allowTransparency: false,
    });

    const fitAddon      = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

    // Prevent Edge/Chrome from stealing Tab (for browser focus navigation)
    // and other special keys before xterm.js can process them.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === 'keydown' && (ev.key === 'Tab' || ev.key === 'F5')) {
        ev.preventDefault();
      }
      return true;
    });

    termRef.current = term;
    fitRef.current  = fitAddon;

    // Resize observer — debounced so rapid DOM changes don't flood the PTY
    // with SIGWINCH signals (which corrupt readline's cursor tracking).
    let resizeTimer = null;
    let lastCols = term.cols;
    let lastRows = term.rows;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitAddon.fit();
          if (
            wsRef.current?.readyState === WebSocket.OPEN &&
            (term.cols !== lastCols || term.rows !== lastRows)
          ) {
            lastCols = term.cols;
            lastRows = term.rows;
            wsRef.current.send(JSON.stringify({
              type: 'resize',
              data: { cols: term.cols, rows: term.rows },
            }));
          }
        } catch (_) {}
      }, 80);
    });
    ro.observe(containerRef.current);
    roRef.current = ro;

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, []);

  /** Open / re-open WebSocket whenever session becomes ready. */
  const connectWs = useCallback(() => {
    if (!termRef.current) return;

    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const term = termRef.current;
    term.clear();
    term.writeln('\r\n\x1b[33mConnecting to cluster terminal…\x1b[0m\r\n');

    const ws = new WebSocket(buildWsUrl());
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      term.clear();
      term.focus();
      const sendSize = () => {
        try { fitRef.current?.fit(); } catch (_) {}
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', data: { cols: term.cols, rows: term.rows } }));
        }
      };
      sendSize();
      // Re-send after layout settles to correct any race with flex sizing
      setTimeout(sendSize, 150);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31m[Connection error]\x1b[0m\r\n');
    };

    ws.onclose = (ev) => {
      if (ev.code !== 1000) {
        term.writeln(`\r\n\x1b[33m[Disconnected — ${ev.reason || 'connection lost'}]\x1b[0m`);
        term.writeln('\x1b[33mWaiting for environment to be ready…\x1b[0m\r\n');
      }
      wsRef.current = null;
    };

    // Wire terminal input → WebSocket
    const disposeOnData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Clean up listener when ws closes
    ws.addEventListener('close', () => disposeOnData.dispose(), { once: true });
  }, [userId]);

  useEffect(() => {
    // Only connect when both session and exercise setup are ready
    if (sessionStatus === 'ready' && setupStatus !== 'running') {
      connectWs();
    }
    if (sessionStatus === 'resetting' || sessionStatus === 'starting' || sessionStatus === 'waiting') {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (termRef.current) {
        termRef.current.clear();
        const msgs = {
          starting:  '\x1b[33mStarting your Kubernetes cluster (this takes ~30s)…\x1b[0m',
          waiting:   '\x1b[33mWaiting for k3s to be ready…\x1b[0m',
          resetting: '\x1b[33mResetting the environment…\x1b[0m',
        };
        termRef.current.writeln(`\r\n${msgs[sessionStatus] ?? ''}\r\n`);
      }
    }
    if (sessionStatus === 'error') {
      if (termRef.current) {
        termRef.current.writeln('\r\n\x1b[31m[Cluster error — try resetting the environment]\x1b[0m\r\n');
      }
    }
  }, [sessionStatus, setupStatus, connectWs]);

  // Lock the terminal while exercise preconditions are being applied
  useEffect(() => {
    if (setupStatus === 'running') {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (termRef.current) {
        termRef.current.clear();
        termRef.current.writeln('\r\n\x1b[33mPreparing exercise environment…\x1b[0m\r\n');
      }
    } else if (setupStatus === 'done' && sessionStatus === 'ready') {
      connectWs();
    }
  }, [setupStatus, sessionStatus, connectWs]);

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
              <span className="hidden group-hover/dots:block text-red-900 leading-none" style={{ fontSize: 8, marginTop: -1 }}>✕</span>
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
              <span className="hidden group-hover/dots:block text-yellow-900 leading-none" style={{ fontSize: 8, marginTop: -1 }}>↕</span>
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
              <span className="hidden group-hover/dots:block text-green-900 leading-none" style={{ fontSize: 8, marginTop: -1 }}>⤢</span>
            </button>
          </div>
          <span className="text-gray-500 text-xs ml-1 font-mono">bash — cka-lab</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs flex items-center gap-1 ${
            sessionStatus === 'ready'    ? 'text-emerald-400' :
            sessionStatus === 'error'    ? 'text-red-400'     :
                                           'text-yellow-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              sessionStatus === 'ready'    ? 'bg-emerald-400' :
              sessionStatus === 'error'    ? 'bg-red-400'     :
                                             'bg-yellow-400 animate-pulse'
            }`} />
            {sessionStatus === 'ready' ? 'Connected' :
             sessionStatus === 'error' ? 'Error' :
             sessionStatus === 'resetting' ? 'Resetting…' : 'Connecting…'}
          </span>
          <button
            onClick={sessionStatus === 'ready' ? connectWs : undefined}
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
