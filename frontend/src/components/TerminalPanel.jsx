import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import useStore from '../store.js';

export default function TerminalPanel() {
  const userId        = useStore((s) => s.userId);
  const sessionStatus = useStore((s) => s.sessionStatus);

  const containerRef = useRef(null);
  const termRef      = useRef(null);
  const fitRef       = useRef(null);
  const wsRef        = useRef(null);
  const roRef        = useRef(null);

  /** Build the WebSocket URL (works for both http and https hosts). */
  function buildWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/terminal?userId=${userId}`;
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

    termRef.current = term;
    fitRef.current  = fitAddon;

    // Resize observer — keep terminal size in sync with DOM
    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            data: { cols: term.cols, rows: term.rows },
          }));
        }
      } catch (_) {}
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
      // Send current terminal size immediately
      ws.send(JSON.stringify({
        type: 'resize',
        data: { cols: term.cols, rows: term.rows },
      }));
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
    if (sessionStatus === 'ready') {
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
  }, [sessionStatus, connectWs]);

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <span className="w-3 h-3 rounded-full bg-green-500/70" />
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
