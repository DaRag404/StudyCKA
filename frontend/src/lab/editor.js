/* eslint-disable no-control-regex -- decode xterm input and escape control bytes before drawing. */
// Paint the editor into xterm's alternate screen, leaving shell scrollback intact.
export function openEditor(term, program, name, text, commit, finished) {
  const nano = program === 'nano',
    readonly = program === 'view';
  let saved = text,
    lines = text.replace(/\n$/, '').split('\n'),
    row = 0,
    col = 0,
    top = 0,
    left = 0;
  let mode = nano ? 'nano' : 'normal',
    entry = '',
    message = nano ? '' : name ? '"' + name + '"' : '[No Name]',
    pending = '',
    register = '',
    undo = [],
    closed = false;
  const content = () => lines.join('\n') + '\n';
  let dirty = false;
  const change = () => {
    if (readonly) {
      message = 'File is read only';
      return false;
    }
    undo.push([lines.slice(), row, col, dirty]);
    if (undo.length > 100) undo.shift();
    dirty = true;
    return true;
  };
  const move = (dy, dx) => {
    row = Math.max(0, Math.min(lines.length - 1, row + dy));
    col = Math.max(0, Math.min(lines[row].length, col + dx));
  };
  const pos = (y, x) => '\x1b[' + (y + 1) + ';' + (x + 1) + 'H';
  const safe = (s) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '?').replace(/\t/g, ' ');
  function render() {
    const width = Math.max(1, term.cols),
      height = Math.max(1, term.rows - (nano ? 4 : 1));
    top = Math.max(0, Math.min(row, Math.max(top, row - height + 1)));
    left = Math.max(0, Math.min(col, Math.max(left, col - width + 1)));
    const screen = ['\x1b[?25l\x1b[H\x1b[2J'];
    if (nano)
      screen.push(
        '\x1b[7m' +
          ('  GNU nano     ' + name + (dirty ? ' *' : '')).padEnd(width).slice(0, width) +
          '\x1b[0m',
      );
    for (let i = 0; i < height; i++)
      screen.push(
        pos(i + (nano ? 1 : 0), 0),
        lines[top + i] === undefined
          ? nano
            ? ''
            : '~'
          : safe(lines[top + i]).slice(left, left + width),
      );
    const status =
      mode === 'ex'
        ? ':' + entry
        : mode === 'search'
          ? '/' + entry
          : mode === 'write'
            ? 'File Name to Write: ' + entry
            : mode === 'confirm'
              ? 'Save modified buffer?  Y Yes  N No  ^C Cancel'
              : message || (mode === 'insert' ? '-- INSERT --' : '');
    const statusRow = nano ? term.rows - 3 : term.rows - 1;
    screen.push(pos(statusRow, 0), safe(status).slice(0, width));
    if (nano)
      screen.push(
        pos(term.rows - 2, 0),
        '^O Write Out   ^W Where Is'.slice(0, width),
        pos(term.rows - 1, 0),
        '^X Exit        ^K Cut Line'.slice(0, width),
      );
    screen.push(
      ['ex', 'search', 'write', 'confirm'].includes(mode)
        ? pos(statusRow, Math.min(width - 1, status.length))
        : pos(row - top + (nano ? 1 : 0), col - left),
      '\x1b[?25h',
    );
    term.write(screen.join(''));
  }
  function close() {
    if (closed) return;
    closed = true;
    resize.dispose();
    term.write('\x1b[?1049l');
    finished();
  }
  async function save(filename) {
    try {
      if (readonly) throw Error('File is read only');
      await commit(content(), filename);
      if (!name && filename) name = filename;
      saved = content();
      dirty = false;
      message = '"' + name + '" written';
      return true;
    } catch (e) {
      message = e.message;
      return false;
    }
  }
  function search(needle) {
    const start = lines
      .slice(row)
      .join('\n')
      .indexOf(needle, col + 1);
    const full = lines.join('\n');
    const at =
      start < 0
        ? full.indexOf(needle)
        : lines.slice(0, row).reduce((n, l) => n + l.length + 1, 0) + start;
    if (at < 0) {
      message = 'Pattern not found';
      return;
    }
    const before = full.slice(0, at).split('\n');
    row = before.length - 1;
    col = before.at(-1).length;
  }
  async function key(k) {
    if (closed) return;
    if (['ex', 'write', 'search'].includes(mode)) {
      if (k === '\x1b' || k === '\x03') {
        mode = nano ? 'nano' : 'normal';
        return;
      }
      if (k === '\x7f' || k === '\b') {
        entry = entry.slice(0, -1);
        return;
      }
      if (k !== '\r' && k !== '\n') {
        if (k.length === 1 && k >= ' ') entry += k;
        return;
      }
      const previous = mode;
      mode = nano ? 'nano' : 'normal';
      if (previous === 'write') {
        if (entry !== name) {
          message = 'Use the current filename';
          return;
        }
        await save();
        return;
      }
      if (previous === 'search') {
        search(entry);
        return;
      }
      const write = entry.match(/^(wq|w|x)(?:\s+(.+))?$/);
      if (write) {
        if ((await save(write[2])) && write[1] !== 'w') close();
      } else if (entry === 'q!' || (entry === 'q' && !dirty)) close();
      else if (entry === 'q') message = 'No write since last change (add ! to override)';
      else if (/^\d+$/.test(entry)) {
        row = Math.min(lines.length - 1, Math.max(0, +entry - 1));
        col = 0;
      } else if (/^%?s([/#|])/.test(entry)) {
        const whole = entry.startsWith('%'),
          delim = entry[whole ? 2 : 1],
          parts = entry.slice(whole ? 3 : 2).split(delim);
        try {
          const regex = new RegExp(parts[0], parts[2]?.includes('g') ? 'g' : '');
          if (change())
            lines = lines.map((l, i) =>
              whole || i === row ? l.replace(regex, parts[1] ?? '') : l,
            );
          move(0, 0);
        } catch (e) {
          message = e.message;
        }
      } else message = 'Not an editor command: ' + entry;
      return;
    }
    if (mode === 'confirm') {
      if (k.toLowerCase() === 'n') close();
      else if (k.toLowerCase() === 'y' && (await save())) close();
      else mode = 'nano';
      return;
    }
    if (k === '\x13') {
      if (await save()) close();
      return;
    }
    const arrows = { '\x1b[A': [-1, 0], '\x1b[B': [1, 0], '\x1b[C': [0, 1], '\x1b[D': [0, -1] };
    if (arrows[k]) {
      move(...arrows[k]);
      return;
    }
    if (mode === 'normal') {
      if (k === ':' || k === '/') {
        entry = '';
        mode = k === ':' ? 'ex' : 'search';
        return;
      }
      if (pending === 'g' && k === 'g') {
        row = col = 0;
        pending = '';
        return;
      }
      if (pending === 'd' && k === 'd') {
        if (change()) {
          register = lines.splice(row, 1)[0];
          if (!lines.length) lines = [''];
          move(0, 0);
        }
        pending = '';
        return;
      }
      if (pending === 'y' && k === 'y') {
        register = lines[row];
        pending = '';
        return;
      }
      pending = '';
      if ('gdy'.includes(k)) pending = k;
      else if (k === 'G') {
        row = lines.length - 1;
        col = 0;
      } else if (k === '0') col = 0;
      else if (k === '$') col = lines[row].length;
      else if (k === 'u' && undo.length) {
        [lines, row, col, dirty] = undo.pop();
      } else if (k === 'p' && change()) {
        lines.splice(++row, 0, register);
        col = 0;
      } else if (k === 'x' && change())
        lines[row] = lines[row].slice(0, col) + lines[row].slice(col + 1);
      else if (['h', 'j', 'k', 'l'].includes(k))
        move(...{ h: [0, -1], j: [1, 0], k: [-1, 0], l: [0, 1] }[k]);
      else if (['i', 'I', 'a', 'A', 'o', 'O'].includes(k) && !readonly) {
        if (k === 'I') col = 0;
        if (k === 'a') move(0, 1);
        if (k === 'A') col = lines[row].length;
        if (k === 'o' || k === 'O') {
          change();
          if (k === 'o') row++;
          lines.splice(row, 0, '');
          col = 0;
        }
        mode = 'insert';
        message = '';
      }
      return;
    }
    if (k === '\x1b' && !nano) {
      mode = 'normal';
      move(0, -1);
      return;
    }
    if (nano && k === '\x18') {
      if (dirty) mode = 'confirm';
      else close();
      return;
    }
    if (nano && k === '\x0f') {
      mode = 'write';
      entry = name;
      return;
    }
    if (nano && k === '\x17') {
      mode = 'search';
      entry = '';
      return;
    }
    if (nano && k === '\x0b' && change()) {
      register = lines.splice(row, 1)[0];
      if (!lines.length) lines = [''];
      move(0, 0);
      return;
    }
    if (k === '\r' || k === '\n') {
      if (change()) {
        lines.splice(row + 1, 0, lines[row].slice(col));
        lines[row] = lines[row].slice(0, col);
        row++;
        col = 0;
      }
    } else if (k === '\x7f' || k === '\b') {
      if (!change()) return;
      if (col) {
        lines[row] = lines[row].slice(0, col - 1) + lines[row].slice(col);
        col--;
      } else if (row) {
        col = lines[row - 1].length;
        lines[row - 1] += lines.splice(row, 1)[0];
        row--;
      }
    } else if (((k.length === 1 && k >= ' ') || k === '\t') && change()) {
      lines[row] = lines[row].slice(0, col) + k + lines[row].slice(col);
      col++;
    }
    if (content() === saved) dirty = false;
  }
  term.write('\x1b[?1049h');
  const resize = term.onResize(render);
  render();
  let queue = Promise.resolve();
  return {
    close,
    input(data) {
      queue = queue.then(async () => {
        for (const k of data.replace(/\r\n/g, '\r').match(/\x1b\[[0-9;]*[A-Za-z~]|[\s\S]/gu) || [])
          await key(k);
        if (!closed) render();
      });
    },
  };
}
