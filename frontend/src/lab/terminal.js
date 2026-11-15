/* eslint-disable no-control-regex -- xterm sends ANSI escape sequences for special keys. */
import { createSession } from './session.js';
import { openEditor } from './editor.js';
import { getCommandNames } from 'just-bash/browser';

export function attachShell(term, lab, save) {
  let line = '',
    cursor = 0,
    lastCursor = 0,
    history = lab.history.length,
    draft = '',
    kill = '',
    continued = [];
  let reading = null;
  let controller,
    editor,
    disposed = false,
    queue = Promise.resolve();
  const prompt = () =>
    reading
      ? ''
      : continued.length
        ? '> '
        : lab.containerSession
          ? lab.containerSession.name + ':' + lab.containerSession.cwd + '# '
          : lab.host + ':' + lab.cwd.replace(/^\/root(?=\/|$)/, '~') + '# ';
  const print = (s) => term.write(s.replace(/\r?\n/g, '\r\n'));
  const record = (s) => {
    lab.transcript = ((lab.transcript || '') + s).slice(-12000);
  };
  const execute = createSession(
    lab,
    (program, name, text, commit) =>
      new Promise((resolve) => {
        if (disposed) {
          resolve();
          return;
        }
        editor = openEditor(
          term,
          program,
          name,
          text,
          async (value, filename) => {
            await commit(value, filename);
          },
          () => {
            editor = null;
            resolve();
          },
        );
      }),
  );
  function draw() {
    // xterm wraps at its current column count. Erase all occupied rows before
    // repainting, including the continuation rows of long kubectl commands.
    const width = term.cols || 80,
      prefix = prompt(),
      physical = (n) => Math.floor(Math.max(0, n - 1) / width);
    const up = physical(prefix.length + lastCursor);
    term.write((up ? '\x1b[' + up + 'A' : '') + '\r\x1b[J' + prefix + line);
    if (cursor < line.length) {
      const from = physical(prefix.length + line.length),
        to = Math.floor((prefix.length + cursor) / width);
      term.write((from > to ? '\x1b[' + (from - to) + 'A' : '') + '\r');
      const x = (prefix.length + cursor) % width;
      if (x) term.write('\x1b[' + x + 'C');
    }
    lastCursor = cursor;
  }
  if (lab.transcript) print(lab.transcript.replace(/\x1b\[32mroot@([^\x1b]+)\x1b\[0m:/g, '$1:'));
  term.write(prompt());
  async function enter(eof = false) {
    const value = line;
    if (!eof) {
      record(prompt() + value + '\n');
      term.write('\r\n');
    }
    line = '';
    cursor = lastCursor = 0;
    if (reading && !eof) {
      reading.lines.push(value + '\n');
      return;
    }
    if (reading && value) reading.lines.push(value);
    if (!reading) continued.push(value);
    const script = reading?.script ?? continued.join('\n');
    if (execute.incomplete(script) || /\\$|(?:&&|\|\||\|)\s*$/.test(value)) {
      term.write(prompt());
      return;
    }
    continued = [];
    if (
      !reading &&
      (/^\s*cat\s*(?:>{1,2}\s*[^|;&<>]+)?\s*$/.test(script) ||
        /^\s*(?:k|kubectl)\s+(?:apply|create|replace)\s+-f\s+-\s*$/.test(script))
    ) {
      reading = { script, lines: [] };
      return;
    }
    const stdin = reading?.lines.join('') || '';
    reading = null;
    if (script.trim()) {
      if (script !== lab.history.at(-1)) lab.history.push(script);
      if (lab.history.length > 200) lab.history.shift();
      controller = new AbortController();
      try {
        const out = await execute(script, controller.signal, stdin);
        if (disposed) return;
        if (out) {
          record(out);
          print(out);
        }
      } catch (e) {
        if (!disposed) {
          record(e.message + '\n');
          print(e.message + '\n');
        }
      } finally {
        controller = null;
      }
      if (disposed) return;
      try {
        save();
      } catch (e) {
        print('Unable to save lab: ' + e.message + '\n');
      }
    }
    history = lab.history.length;
    draft = '';
    term.write(prompt());
  }
  async function complete() {
    const before = line.slice(0, cursor),
      words = before.split(/\s+/),
      part = words.pop() || '';
    const files = await execute.completePath(part, words[0] === 'cd');
    const commands = [
      ...getCommandNames(),
      'kubectl',
      'crictl',
      'helm',
      'kustomize',
      'kubeadm',
      'k',
      'kgp',
      'kgd',
      'kgs',
      'kgn',
      'kga',
      'vi',
      'vim',
      'nano',
      'ssh',
      'cd',
      'export',
    ];
    const verbs =
      'apply autoscale kustomize auth cordon create delete describe drain edit exec expose get label logs patch rollout run scale set taint uncordon'.split(
        ' ',
      );
    const kinds =
      'gateway gatewayclass httproute ingress hpa configmap cronjob daemonset deployment deployments job namespace networkpolicy node nodes pod pods pv pvc role rolebinding secret service serviceaccount'.split(
        ' ',
      );
    const choices = !words.length
      ? commands
      : ['kubectl', 'k'].includes(words[0]) && words.length === 1
        ? verbs
        : words.length === 2 && ['get', 'describe', 'delete', 'edit'].includes(words[1])
          ? kinds
          : ['k', 'kubectl'].includes(words[0]) && !['-f', '--filename'].includes(words.at(-1))
            ? lab.objects.map((o) => o.metadata.name)
            : files;
    const hits = [...new Set(choices.filter((x) => x.startsWith(part)))].sort();
    if (!hits.length) return;
    let match = hits[0];
    while (!hits.every((h) => h.startsWith(match))) match = match.slice(0, -1);
    if (hits.length === 1 && !match.endsWith('/')) match += ' ';
    if (match.length === part.length) {
      term.write('\r\n' + hits.join('  ') + '\r\n');
      lastCursor = 0;
    }
    line = before.slice(0, before.length - part.length) + match + line.slice(cursor);
    cursor += match.length - part.length;
    draw();
  }
  async function input(data) {
    for (const k of data
      .replace(/\r\n/g, '\r')
      .match(/\x1b\[[0-9;]*[a-zA-Z~]|\x1bO[A-Z]|[\s\S]/gu) || []) {
      if (disposed) return;
      if (k === '\r' || k === '\n') {
        await enter();
        continue;
      }
      if (k === '\x03') {
        reading = null;
        continued = [];
        line = '';
        cursor = lastCursor = 0;
        term.write('^C\r\n' + prompt());
        continue;
      }
      if (k === '\x04' && reading) {
        await enter(true);
        continue;
      }
      if (k === '\x04' && !line && (lab.containerSession || lab.host === 'worker')) {
        line = 'exit';
        await enter();
        continue;
      }
      if (k === '\t' && !reading) {
        await complete();
        continue;
      }
      if (k === '\x1b[A' || k === '\x1b[B') {
        if (history === lab.history.length) draft = line;
        history = Math.max(0, Math.min(lab.history.length, history + (k.endsWith('A') ? -1 : 1)));
        line = lab.history[history] ?? draft;
        cursor = line.length;
      } else if (k === '\x1b[D') cursor = Math.max(0, cursor - 1);
      else if (k === '\x1b[C') cursor = Math.min(line.length, cursor + 1);
      else if (['\x01', '\x1b[H', '\x1bOH', '\x1b[1~'].includes(k)) cursor = 0;
      else if (['\x05', '\x1b[F', '\x1bOF', '\x1b[4~'].includes(k)) cursor = line.length;
      else if (k === '\x04' || k === '\x1b[3~') {
        line = line.slice(0, cursor) + line.slice(cursor + 1);
      } else if (k === '\x15' || k === '\x17') {
        const start = k === '\x15' ? 0 : line.slice(0, cursor).replace(/\S+\s*$/, '').length;
        kill = line.slice(start, cursor);
        line = line.slice(0, start) + line.slice(cursor);
        cursor = start;
      } else if (k === '\x0b') {
        kill = line.slice(cursor);
        line = line.slice(0, cursor);
      } else if (k === '\x19') {
        line = line.slice(0, cursor) + kill + line.slice(cursor);
        cursor += kill.length;
      } else if (k === '\x7f' || k === '\b') {
        if (cursor) {
          line = line.slice(0, cursor - 1) + line.slice(cursor);
          cursor--;
        }
      } else if (k === '\x0c') {
        term.write('\x1b[H\x1b[2J');
        lastCursor = 0;
      } else if (k >= ' ' && !k.startsWith('\x1b')) {
        const end = cursor === line.length;
        line = line.slice(0, cursor) + k + line.slice(cursor);
        cursor += k.length;
        if (end) {
          term.write(k);
          lastCursor = cursor;
          continue;
        }
      } else continue;
      draw();
    }
  }
  const listener = term.onData((data) => {
    if (editor) {
      editor.input(data);
      return;
    }
    if (controller && data === '\x03') {
      controller.abort();
      term.write('^C\r\n');
      return;
    }
    queue = queue.then(() => input(data));
  });
  return () => {
    disposed = true;
    controller?.abort();
    editor?.close();
    listener.dispose();
  };
}
