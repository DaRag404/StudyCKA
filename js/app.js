(() => {
  'use strict';
  const { exercises, setup, check, installSystemResources, reconcile, attachShell } = StudyCKA;
  const $ = (id) => document.getElementById(id);
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const labKey = (id) => 'studycka_lab_v1:' + (id || 'practice');
  exercises.sort((a, b) => a.order - b.order);
  let selected = read('studycka_selected', null);
  let progress = read('studycka_progress', {});
  let lab, disconnect;
  const current = () => exercises.find((ex) => ex.id === selected);
  function node(tag, text, cls) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  }

  // Only allow the Markdown elements used for exercise text. Text from saved
  // labs (including command output) is always inserted as plain text.
  function markdown(source, inline = false) {
    const template = document.createElement('template');
    template.innerHTML = inline ? marked.parseInline(source) : marked.parse(source);
    const allowed = new Set(
      'P PRE CODE STRONG EM DEL H1 H2 H3 H4 UL OL LI TABLE THEAD TBODY TD TH TR BLOCKQUOTE HR BR A'.split(
        ' ',
      ),
    );
    for (const el of template.content.querySelectorAll('*')) {
      if (!allowed.has(el.tagName)) {
        el.replaceWith(document.createTextNode(el.textContent));
        continue;
      }
      const href = el.getAttribute('href');
      for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
      if (el.tagName === 'A' && /^https?:\/\//i.test(href)) {
        el.href = href;
        el.rel = 'noopener noreferrer';
        el.target = '_blank';
      }
    }
    for (const pre of template.content.querySelectorAll('pre')) {
      const wrapper = node('div', undefined, 'code-block');
      const copy = node('button', 'copy', 'copy');
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(pre.textContent.trimEnd());
          copy.textContent = '✓ copied';
          setTimeout(() => {
            copy.textContent = 'copy';
          }, 2000);
        } catch {
          copy.textContent = 'Copy unavailable';
        }
      };
      pre.replaceWith(wrapper);
      wrapper.append(pre, copy);
    }
    return template.content;
  }

  const buttons = new Map();
  for (const ex of exercises) {
    const button = $('exercise-row').content.firstElementChild.cloneNode(true);
    button.querySelector('.exercise-title').textContent = ex.id + '. ' + ex.title;
    button.querySelector('.metadata span').textContent = ex.category;
    const badge = button.querySelector('small');
    badge.textContent = ex.difficulty;
    badge.className = 'badge ' + ex.difficulty;
    button.onclick = () => {
      if (selected === ex.id) return;
      write(labKey(selected), lab);
      selected = ex.id;
      write('studycka_selected', selected);
      openExercise();
    };
    $('exercises').append(button);
    buttons.set(ex.id, button);
  }
  function updateProgress() {
    let passed = 0;
    for (const [id, button] of buttons) {
      const status = progress[id];
      if (status === 'passed') passed++;
      const icon = button.querySelector('.status-icon');
      icon.textContent = status === 'passed' ? '✓' : status === 'failed' ? '✗' : '○';
      icon.className = 'status-icon ' + (status || '');
      button.setAttribute('aria-current', String(id === selected));
    }
    $('passed').textContent = passed;
    $('total').textContent = exercises.length;
    $('bar').style.width = (passed / exercises.length) * 100 + '%';
  }
  function showResult(result) {
    const panel = $('result');
    panel.hidden = !result;
    panel.replaceChildren();
    if (!result) return;
    panel.className = result.passed ? 'passed' : 'failed';
    panel.append(node('h3', result.passed ? '✓ All checks passed!' : '✗ Some checks failed'));
    for (const r of result.results) {
      const item = node('div', undefined, 'check-item');
      item.append(
        node('span', r.passed ? '✓ ' : '✗ ', r.passed ? 'passed' : 'failed'),
        r.description,
      );
      if (!r.passed) {
        for (const [label, value] of [
          ['Expected: ', r.expected],
          ['Got: ', r.actual || '(empty)'],
        ]) {
          const line = node('p');
          line.append(label, node('code', value));
          item.append(line);
        }
      }
      panel.append(item);
    }
  }
  function hints(open) {
    const list = current()?.hints || [];
    $('hint-toggle').hidden = !list.length;
    $('hint-toggle').textContent = (open ? '▼' : '▶') + ' Hints (' + list.length + ')';
    $('hint-toggle').setAttribute('aria-expanded', String(open));
    $('hints').hidden = !open;
  }
  $('hint-toggle').onclick = () => hints($('hints').hidden);
  function openExercise() {
    const ex = current();
    lab = read(labKey(selected), null) || setup(ex);
    if (!lab.kubeadmLab && !lab.images) {
      installSystemResources(lab);
      reconcile(lab);
    }
    updateProgress();
    $('empty').hidden = !!ex;
    $('exercise').hidden = !ex;
    if (ex) {
      $('title').textContent = ex.title;
      $('category').textContent = ex.category;
      $('level').textContent = ex.difficulty;
      $('level').className = 'badge ' + ex.difficulty;
      $('description').replaceChildren(markdown(ex.description));
      $('hints').replaceChildren(
        ...(ex.hints || []).map((h) => {
          const li = node('li'),
            text = node('span');
          text.append(markdown(h, true));
          li.append('💡', text);
          return li;
        }),
      );
      hints(false);
      showResult(read('studycka_result:' + selected, null));
      $('reading').scrollTop = 0;
    }
    openTerminal();
  }
  $('check').onclick = () => {
    const result = check(lab, current());
    progress[selected] = result.passed ? 'passed' : 'failed';
    write('studycka_progress', progress);
    write('studycka_result:' + selected, result);
    showResult(result);
    updateProgress();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $('reset-lab').onclick = () => {
    lab = setup(current());
    write(labKey(selected), lab);
    localStorage.removeItem('studycka_result:' + selected);
    showResult(null);
    openTerminal();
  };
  $('reset-progress').onclick = () => {
    if (!confirm('Reset all exercise progress?')) return;
    progress = {};
    localStorage.removeItem('studycka_progress');
    for (const ex of exercises) localStorage.removeItem('studycka_result:' + ex.id);
    updateProgress();
    showResult(null);
  };
  function openTerminal() {
    disconnect?.();
    const terminal = new Terminal({
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
    const fit = new FitAddon.FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon.WebLinksAddon());
    terminal.open($('console'));
    fit.fit();
    terminal.focus();
    terminal.attachCustomKeyEventHandler((e) => {
      if (
        e.type === 'keydown' &&
        (['Tab', 'F5'].includes(e.key) || (e.ctrlKey && ['s', 'o', 'w'].includes(e.key)))
      )
        e.preventDefault();
      return true;
    });
    const observer = new ResizeObserver(() => {
      if ($('console').clientHeight > 8) fit.fit();
    });
    observer.observe($('console'));
    const id = selected,
      state = lab;
    const stop = attachShell(terminal, state, () => write(labKey(id), state));
    disconnect = () => {
      stop();
      observer.disconnect();
      terminal.dispose();
    };
  }
  $('reconnect').onclick = openTerminal;
  function resources(open) {
    $('resources').hidden = !open;
    $('resources-toggle').setAttribute('aria-expanded', String(open));
    localStorage.setItem('studycka_resources', String(open));
  }
  for (const link of $('resources').querySelectorAll('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  resources(localStorage.getItem('studycka_resources') === 'true');
  $('resources-toggle').onclick = () => resources($('resources').hidden);

  let clock = read('studycka_timer', { left: 7200 });
  const remaining = () =>
    clock.end ? Math.max(0, Math.ceil((clock.end - Date.now()) / 1000)) : clock.left;
  function displayClock() {
    const seconds = remaining();
    if (clock.end && !seconds) {
      clock = { left: 0 };
      write('studycka_timer', clock);
    }
    $('clock').textContent = [
      Math.floor(seconds / 3600),
      Math.floor(seconds / 60) % 60,
      seconds % 60,
    ]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    $('clock').style.color =
      seconds < 300 ? '#f87171' : seconds < 600 ? '#facc15' : clock.end ? '#e5e7eb' : '';
    $('play').title = clock.end ? 'Pause' : 'Start';
    $('play').textContent = clock.end ? '⏸' : '▶';
  }
  $('play').onclick = () => {
    clock = clock.end ? { left: remaining() } : { end: Date.now() + remaining() * 1000 };
    write('studycka_timer', clock);
    displayClock();
  };
  $('reset-time').onclick = () => {
    clock = { left: 7200 };
    write('studycka_timer', clock);
    displayClock();
  };
  displayClock();
  setInterval(displayClock, 250);
  const main = document.querySelector('main');
  function mode(value) {
    main.dataset.mode = value;
    localStorage.setItem('studycka_panel', value);
    for (const btn of main.querySelectorAll('button[data-mode]'))
      btn.disabled = btn.dataset.mode === value && value !== 'desc-max';
  }
  for (const btn of main.querySelectorAll('button[data-mode]'))
    btn.onclick = () => mode(btn.dataset.mode);
  mode(localStorage.getItem('studycka_panel') || 'split');
  function split(height) {
    const value = Math.max(120, Math.min(height, main.clientHeight - 128));
    main.style.setProperty('--split', value + 'px');
    localStorage.setItem('studycka_split', String(value));
  }
  split(Number(localStorage.getItem('studycka_split')) || Math.floor(innerHeight / 2));
  const divider = $('divider');
  divider.onpointerdown = (e) => {
    const y = e.clientY,
      height = $('detail').offsetHeight;
    divider.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
    divider.onpointermove = (ev) => split(height + ev.clientY - y);
    divider.onlostpointercapture = () => {
      divider.onpointermove = null;
      document.body.style.userSelect = '';
    };
  };
  openExercise();
})();
