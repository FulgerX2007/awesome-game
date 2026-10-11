'use strict';
// Поле чудес — wheel, board, players and the host's lines. Rules live in core.js (window.WondersCore).
(() => {
  const C = window.WondersCore;
  const { t, p: plural } = window.I18n;
  const SAVE_KEY = 'wonders.v1';
  const PREFS_KEY = 'wonders.prefs';
  const MUTE_KEY = 'wonders.mute';
  const BOARD_URL = '/api/boards/wonders/scores';
  const COLORS = ['#ff8a5c', '#5fd3ff', '#c39bff'];
  const PLAY_PHASES = ['spin', 'letter', 'plus', 'boxes', 'superPick', 'superGuess'];
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = new Intl.NumberFormat(window.I18n.locale);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  // ───────────── Sound ─────────────
  const Sound = (() => {
    let ac = null, master = null, muted = !!store.get(MUTE_KEY);
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    }
    function tone(f, { t: at = 0, d = 0.3, vol = 0.12, type = 'sine', to = 0 } = {}) {
      if (!ac || muted) return;
      const now = ac.currentTime + at;
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, now);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + d);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + d + 0.05);
    }
    return {
      init,
      get muted() { return muted; },
      set muted(v) { muted = v; store.set(MUTE_KEY, v); },
      tick() { tone(1800, { d: 0.03, vol: 0.05, type: 'square' }); },
      hit(n = 1) { for (let i = 0; i < Math.min(n, 4); i++) tone(660 * 2 ** (i * 4 / 12), { t: i * 0.12, d: 0.5, vol: 0.12, type: 'triangle' }); },
      miss() { tone(180, { d: 0.45, vol: 0.12, type: 'sawtooth', to: 120 }); },
      bankrupt() { [0, 1, 2].forEach((i) => tone(400 - i * 90, { t: i * 0.18, d: 0.3, vol: 0.12, type: 'square' })); },
      box(win) { win ? [0, 4, 7, 12].forEach((s, i) => tone(523 * 2 ** (s / 12), { t: i * 0.08, d: 0.6, vol: 0.1, type: 'triangle' })) : tone(260, { d: 0.4, vol: 0.1, to: 200 }); },
      win() { [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => tone(392 * 2 ** (s / 12), { t: i * 0.11, d: 0.9, vol: 0.1, type: 'triangle' })); },
    };
  })();

  // ───────────── Wheel ─────────────
  const Wheel = (() => {
    const cv = $('wheel'), ctx = cv.getContext('2d');
    const N = C.SECTORS.length, A = (2 * Math.PI) / N, TAU = 2 * Math.PI;
    const FILL = ['#e8453c', '#f2a531', '#2f9e5b', '#2f6fd6', '#d1488f', '#17a2b8'];
    const SPECIAL = { bankrupt: ['#111', '#ff6b6b'], zero: ['#6b7280', '#fff'], double: ['#7b3fe4', '#ffe28a'], plus: ['#0d7a43', '#fff'] };
    let rot = 0, size = 0;
    const label = (sec) => (sec.t === 'pts' ? String(sec.v) : { bankrupt: t('Б'), zero: '0', double: '×2', plus: '+' }[sec.t]);
    function resize() {
      const r = cv.getBoundingClientRect();
      if (!r.width) return;
      const d = window.devicePixelRatio || 1;
      size = r.width;
      cv.width = Math.round(r.width * d); cv.height = Math.round(r.width * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      draw();
    }
    function draw() {
      if (!size) return;
      const R = size / 2, r = R - 8;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(R, R);
      ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, TAU); ctx.fillStyle = '#c98b12'; ctx.fill();
      ctx.rotate(rot);
      let k = 0;
      C.SECTORS.forEach((sec, i) => {
        const a0 = -Math.PI / 2 + i * A;
        const [bg, fg] = SPECIAL[sec.t] || [FILL[k++ % FILL.length], '#fff'];
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, a0, a0 + A); ctx.closePath();
        ctx.fillStyle = bg; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.save();
        ctx.rotate(a0 + A / 2);
        ctx.fillStyle = fg;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const txt = label(sec);
        ctx.font = `800 ${Math.round(size * (txt.length > 3 ? 0.052 : 0.07))}px Rubik, system-ui, sans-serif`;
        ctx.fillText(txt, r - size * 0.04, 0);
        ctx.restore();
        // pegs on the rim
        ctx.beginPath(); ctx.arc(Math.cos(a0) * (r - 2), Math.sin(a0) * (r - 2), Math.max(2, size * 0.01), 0, TAU);
        ctx.fillStyle = '#ffe6a0'; ctx.fill();
      });
      ctx.restore();
      ctx.save(); ctx.translate(R, R);
      const g = ctx.createRadialGradient(-size * 0.03, -size * 0.03, 2, 0, 0, size * 0.13);
      g.addColorStop(0, '#fff2c4'); g.addColorStop(1, '#c98b12');
      ctx.beginPath(); ctx.arc(0, 0, size * 0.12, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#8a5d06'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    // Sector under the pointer: the pointer sits at the top, sector i spans [i·A, (i+1)·A) clockwise from it.
    const sectorAt = (r) => Math.floor((((-r) % TAU) + TAU) % TAU / A) % N;
    function show(idx) { rot = -(idx + 0.5) * A; draw(); }
    function spinTo(idx, onTick) {
      const start = rot;
      const center = (idx + 0.5 + (Math.random() - 0.5) * 0.7) * A;
      let delta = (((-center - start) % TAU) + TAU) % TAU;
      delta += TAU * (reduceMotion ? 1 : 4 + Math.floor(Math.random() * 2));
      const dur = reduceMotion ? 700 : 3800 + Math.random() * 800;
      return new Promise((done) => {
        const t0 = performance.now();
        let last = sectorAt(start);
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          rot = start + delta * (1 - (1 - k) ** 3);
          const cur = sectorAt(rot);
          if (cur !== last) { last = cur; onTick(); }
          draw();
          if (k < 1) requestAnimationFrame(step);
          else { rot %= TAU; done(); }
        };
        requestAnimationFrame(step);
      });
    }
    return { resize, show, spinTo, N };
  })();

  // ───────────── State ─────────────
  let s = null;            // the game, see core.js
  let busy = false;        // the wheel is spinning or a dialog is animating
  let botTimer = 0, superTimer = 0, boardWord = '';
  const prefs = Object.assign({ rounds: 3, seats: [{ name: '', bot: false }, { name: '', bot: false }, { name: '', bot: false }] }, store.get(PREFS_KEY) || {});

  const human = () => s && !s.players[s.turn].bot;
  const nameOf = (i) => s.players[i].name;
  const save = () => (s && s.phase !== 'over' ? store.set(SAVE_KEY, s) : store.del(SAVE_KEY));
  const say = (text) => { $('host').textContent = text; };
  const lettersWord = (n) => plural(n, 'букву|буквы|букв');

  // ───────────── Setup ─────────────
  function renderSeats() {
    const root = $('seats');
    root.textContent = '';
    prefs.seats.forEach((seat, i) => {
      const el = document.createElement('div');
      el.className = 'seat';
      el.style.setProperty('--c', COLORS[i]);
      const lab = document.createElement('label');
      lab.htmlFor = `seat-${i}`;
      lab.textContent = t('Игрок {n}', { n: i + 1 });
      const inp = document.createElement('input');
      inp.id = `seat-${i}`;
      inp.maxLength = 16;
      inp.value = seat.name;
      inp.placeholder = seat.bot ? t('Бот {n}', { n: i + 1 }) : t('Игрок {n}', { n: i + 1 });
      inp.addEventListener('input', () => { seat.name = inp.value; store.set(PREFS_KEY, prefs); });
      const seg = document.createElement('div');
      seg.className = 'seg';
      [[false, 'Человек'], [true, 'Компьютер']].forEach(([bot, text]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = t(text);
        b.setAttribute('aria-pressed', String(seat.bot === bot));
        b.addEventListener('click', () => { seat.bot = bot; store.set(PREFS_KEY, prefs); renderSeats(); });
        seg.appendChild(b);
      });
      el.append(lab, inp, seg);
      root.appendChild(el);
    });
  }
  function renderRounds() {
    for (const b of $('rounds').children) b.setAttribute('aria-checked', String(Number(b.dataset.n) === prefs.rounds));
  }
  $('rounds').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    prefs.rounds = Number(b.dataset.n);
    store.set(PREFS_KEY, prefs);
    renderRounds();
  });

  function showSetup() {
    clearTimeout(botTimer);
    clearInterval(superTimer);
    hideDialogs();
    $('game').hidden = true;
    $('setup').hidden = false;
    $('btn-continue').hidden = !store.get(SAVE_KEY);
    renderSeats();
    renderRounds();
  }

  function startGame() {
    Sound.init();
    const players = prefs.seats.map((seat, i) => ({
      name: seat.name.trim() || (seat.bot ? t('Бот {n}', { n: i + 1 }) : t('Игрок {n}', { n: i + 1 })),
      bot: seat.bot,
    }));
    s = C.newGame({ lang: window.I18n.lang, players, rounds: prefs.rounds, seed: (Math.random() * 2 ** 32) >>> 0 });
    enterGame();
    announceRound();
  }

  function enterGame() {
    $('setup').hidden = true;
    $('game').hidden = false;
    boardWord = '';
    buildKeys();
    Wheel.resize();
    if (s.sector >= 0) Wheel.show(s.sector);
    after();
  }

  function announceRound() {
    say(t('Раунд {r}. Первым крутит барабан {name}', { r: s.round + 1, name: nameOf(s.turn) }));
  }

  // ───────────── Rendering ─────────────
  function buildKeys() {
    const root = $('keys');
    root.textContent = '';
    for (const ch of C.ALPHABET[s.lang]) {
      const b = document.createElement('button');
      b.className = 'key';
      b.textContent = ch;
      b.dataset.k = ch;
      b.setAttribute('data-i18n-skip', '');
      b.addEventListener('click', () => pickLetter(ch));
      root.appendChild(b);
    }
  }

  function renderBoard(fresh = []) {
    const board = $('board');
    const chars = [...s.word];
    if (boardWord !== s.word) {
      boardWord = s.word;
      board.textContent = '';
      chars.forEach((ch, i) => {
        const cell = document.createElement('button');
        cell.className = 'cell';
        cell.type = 'button';
        cell.tabIndex = -1;
        cell.setAttribute('data-i18n-skip', '');
        cell.innerHTML = '<span class="face back"></span><span class="face front"></span>';
        cell.lastChild.textContent = ch;
        cell.addEventListener('click', () => pickCell(i));
        board.appendChild(cell);
      });
      sizeBoard();
    }
    const pick = s.phase === 'plus' && human() && !busy;
    board.classList.toggle('pick', pick);
    [...board.children].forEach((cell, i) => {
      cell.classList.toggle('open', s.open[i]);
      cell.tabIndex = pick && !s.open[i] ? 0 : -1;
      cell.setAttribute('aria-label', s.open[i] ? chars[i] : t('Закрытая буква {n}', { n: i + 1 }));
      if (fresh.includes(i)) {
        cell.classList.add('fresh');
        setTimeout(() => cell.classList.remove('fresh'), 1300);
      }
    });
  }
  function sizeBoard() {
    const board = $('board'), n = board.children.length;
    if (!n) return;
    const gap = 5, avail = board.clientWidth - 16 - gap * (n - 1);
    board.style.setProperty('--size', `${clamp(Math.floor(avail / n), 20, 58)}px`);
  }

  function renderPlayers() {
    const root = $('players');
    const isSuper = !!s.super;
    root.textContent = '';
    s.players.forEach((pl, i) => {
      const el = document.createElement('div');
      el.className = 'player';
      el.style.setProperty('--c', COLORS[i]);
      const active = PLAY_PHASES.includes(s.phase) && s.turn === i;
      el.classList.toggle('turn', active);
      el.classList.toggle('out', isSuper ? s.turn !== i : s.out[i]);
      const name = document.createElement('div');
      name.className = 'name';
      name.appendChild(Object.assign(document.createElement('span'), { textContent: pl.name }));
      name.firstChild.setAttribute('data-i18n-skip', '');
      if (pl.bot || (!isSuper && s.out[i])) {
        const tag = document.createElement('small');
        tag.textContent = !isSuper && s.out[i] ? t('вне раунда') : t('бот');
        name.appendChild(tag);
      }
      const nums = document.createElement('div');
      nums.className = 'nums';
      nums.innerHTML = '<span class="round"></span><span class="bank"></span>';
      if (!isSuper) {
        nums.firstChild.textContent = `${t('раунд')} `;
        nums.firstChild.appendChild(Object.assign(document.createElement('b'), { textContent: fmt.format(s.score[i]) }));
      }
      nums.lastChild.textContent = `${t('банк')} `;
      nums.lastChild.appendChild(Object.assign(document.createElement('b'), { textContent: fmt.format(pl.total) }));
      el.append(name, nums);
      root.appendChild(el);
    });
  }

  function renderControls() {
    const isSuper = !!s.super;
    const me = human() && !busy;
    $('round-label').textContent = isSuper ? t('Суперигра') : t('Раунд {r} из {n}', { r: s.round + 1, n: s.rounds });
    $('task').textContent = s.task;
    $('task').lang = s.lang;
    $('btn-spin').hidden = isSuper;
    $('btn-word').hidden = isSuper;
    $('btn-spin').disabled = !(me && s.phase === 'spin');
    $('btn-word').disabled = !(me && s.phase === 'spin');
    const letterTime = me && (s.phase === 'letter' || s.phase === 'superPick');
    const keys = $('keys');
    keys.classList.toggle('idle', !letterTime);
    const inWord = new Set(C.letters(s));
    for (const b of keys.children) {
      const k = b.dataset.k, used = s.used.includes(k);
      b.classList.toggle('hit', used && inWord.has(k));
      b.classList.toggle('miss', used && !inWord.has(k));
      b.disabled = !letterTime || used;
    }
  }

  function render(fresh) {
    if (!s) return;
    renderBoard(fresh);
    renderPlayers();
    renderControls();
  }

  // Saves, redraws and lets a bot move if it is its turn.
  function after(fresh) {
    save();
    render(fresh);
    scheduleBot();
  }

  // ───────────── Moves ─────────────
  async function doSpin() {
    if (!s || s.phase !== 'spin' || busy) return;
    busy = true;
    Sound.init();
    say(t('{name} крутит барабан…', { name: nameOf(s.turn) }));
    render();
    const game = s, idx = Math.floor(Math.random() * Wheel.N);
    await Wheel.spinTo(idx, () => Sound.tick());
    if (s !== game) return; // left to the menu mid-spin
    busy = false;
    handle(C.spin(s, idx));
  }

  function pickLetter(ch) {
    if (!s || busy) return;
    if (s.phase === 'letter') handle(C.letter(s, ch));
    else if (s.phase === 'superPick') handle(C.superLetter(s, ch));
  }

  function pickCell(i) {
    if (!s || busy || !human()) return;
    handle(C.openCell(s, i));
  }

  function nextName(ev) { return nameOf(ev.next); }

  // A pause before fn that holds input; it is dropped if the player left this game meanwhile.
  function later(fn, ms) {
    const game = s;
    busy = true;
    setTimeout(() => {
      if (s !== game) return;
      busy = false;
      fn();
    }, ms);
  }

  // Turns a rules event into the host's line, a sound and the follow-up dialog.
  function handle(ev) {
    if (!ev) return;
    const name = nameOf(ev.player);
    let line = '';
    switch (ev.type) {
      case 'pts': line = t('{v} очков на барабане! {name}, ваша буква?', { v: fmt.format(ev.value), name }); break;
      case 'double': line = t('Удвоение! {name}, назовите букву — и очки раунда удвоятся', { name }); break;
      case 'plus': line = ev.at ? t('Открываем «{l}»: {n} {letters}', { l: ev.letter, n: ev.count, letters: lettersWord(ev.count) })
        : t('Сектор «Плюс»! {name}, откройте любую букву: нажмите на клетку табло', { name }); break;
      case 'bankrupt': Sound.bankrupt(); line = t('Банкрот! {name} теряет очки раунда. Ход переходит: {next}', { name, next: nextName(ev) }); break;
      case 'zero': Sound.miss(); line = t('Ноль. Ход переходит: {next}', { next: nextName(ev) }); break;
      case 'hit':
        line = ev.double ? t('Есть такая буква «{l}»! Очки раунда удваиваются: +{gain}', { l: ev.letter, gain: fmt.format(ev.gain) })
          : t('Есть такая буква «{l}»! Откройте {n} {letters}: +{gain}', { l: ev.letter, n: ev.count, letters: lettersWord(ev.count), gain: fmt.format(ev.gain) });
        break;
      case 'miss': Sound.miss(); line = t('Нет буквы «{l}». Ход переходит: {next}', { l: ev.letter, next: nextName(ev) }); break;
      case 'repeat': Sound.miss(); line = t('Букву «{l}» уже называли. Ход переходит: {next}', { l: ev.letter, next: nextName(ev) }); break;
      case 'word':
        if (ev.ok) { Sound.win(); line = t('Абсолютно верно! {name} выигрывает раунд', { name }); }
        else {
          Sound.miss();
          line = ev.all ? t('Неверно! Все игроки выбыли, раунд остаётся без победителя')
            : t('Неверно! {name} выбывает из раунда. Ход переходит: {next}', { name, next: nextName(ev) });
        }
        break;
      case 'superLetter':
        if (ev.count) Sound.hit(ev.count); else Sound.miss();
        line = ev.count ? t('Буква «{l}»: открываем {n} {letters}', { l: ev.letter, n: ev.count, letters: lettersWord(ev.count) })
          : t('Буквы «{l}» нет', { l: ev.letter });
        if (s.phase === 'superGuess') line += ` ${t('У вас {sec} секунд, чтобы назвать слово!', { sec: C.SUPER_SECONDS })}`;
        break;
      case 'superWord':
        if (ev.ok) { Sound.win(); line = t('Это победа! {name} выигрывает суперигру: +{gain}', { name, gain: fmt.format(ev.gain) }); }
        else { Sound.miss(); line = t('Увы, суперигра проиграна. Было загадано: {w}', { w: s.word }); }
        break;
      default: break;
    }
    if (ev.type === 'hit' || (ev.type === 'plus' && ev.at)) {
      if (ev.solved) { Sound.win(); line += ` ${t('Слово открыто! {name} выигрывает раунд', { name })}`; }
      else {
        Sound.hit(ev.count);
        if (ev.boxes) line += ` ${t('Три буквы подряд — шкатулки в студию!')}`;
      }
    }
    say(line);
    after(ev.at || []);
    if (s.phase === 'roundEnd' || s.phase === 'over') {
      clearInterval(superTimer);
      $('timer').hidden = true;
      if ($('word-dlg').hidden === false) hideWordDialog();
      later(() => (s.phase === 'over' ? showFinal() : showRoundEnd()), reduceMotion ? 500 : 1500);
    } else if (s.phase === 'boxes') {
      later(showBoxes, reduceMotion ? 200 : 900);
    } else if (s.phase === 'superGuess') startSuperClock();
  }

  // ───────────── Bots ─────────────
  function scheduleBot() {
    clearTimeout(botTimer);
    if (!s || busy || $('game').hidden || !PLAY_PHASES.includes(s.phase) || !s.players[s.turn].bot) return;
    if (s.phase === 'boxes' && $('boxes-dlg').hidden) return; // the dialog opens first
    const wait = { spin: 1000, superGuess: 4000, boxes: 1400 }[s.phase] || 1300;
    botTimer = setTimeout(botStep, reduceMotion ? wait / 2 : wait);
  }
  function botStep() {
    if (!s || busy) return;
    const m = C.botMove(s);
    if (!m) return;
    const name = nameOf(s.turn);
    switch (m.act) {
      case 'spin': doSpin(); break;
      case 'word':
        say(t('{name}: «Я знаю слово! Это {w}»', { name, w: m.text }));
        later(() => handle(C.guessWord(s, m.text)), 1400);
        break;
      case 'letter': case 'superLetter': pickLetter(m.ch); break;
      case 'cell': handle(C.openCell(s, m.i)); break;
      case 'box': openBox(m.i); break;
      case 'superWord':
        say(t('{name}: «Я знаю слово! Это {w}»', { name, w: m.text }));
        later(() => handle(C.superWord(s, m.text)), 1400);
        break;
      default: break;
    }
  }

  // ───────────── Dialogs ─────────────
  function hideDialogs() {
    for (const id of ['word-dlg', 'boxes-dlg', 'end-dlg']) $(id).hidden = true;
  }

  function openWordDialog() {
    if (!s || busy || !human()) return;
    const isSuper = s.phase === 'superGuess';
    if (!isSuper && s.phase !== 'spin') return;
    $('word-title').textContent = isSuper ? t('Суперигра: ваше слово') : t('Назовите слово');
    $('word-sub').textContent = isSuper ? t('Время идёт!') : t('Ошибка — и вы выбываете из раунда.');
    $('word-cancel').hidden = isSuper;
    $('word-input').value = '';
    $('word-input').lang = s.lang;
    $('word-dlg').hidden = false;
    setTimeout(() => $('word-input').focus(), 30);
  }
  function hideWordDialog() { $('word-dlg').hidden = true; }
  $('word-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('word-input').value.trim();
    if (!text || !s) return;
    hideWordDialog();
    if (s.phase === 'superGuess') handle(C.superWord(s, text));
    else handle(C.guessWord(s, text));
  });
  $('word-cancel').addEventListener('click', hideWordDialog);

  // The super-game clock survives a reload: the deadline is part of the save.
  function startSuperClock() {
    clearInterval(superTimer);
    if (!s.deadline) { s.deadline = Date.now() + C.SUPER_SECONDS * 1000; save(); }
    const tick = () => {
      const left = Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000));
      const label = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      $('timer').hidden = false;
      $('timer').textContent = label;
      if (!$('word-dlg').hidden) $('word-sub').textContent = t('Осталось {t}', { t: label });
      if (left <= 0 && s.phase === 'superGuess') {
        clearInterval(superTimer);
        hideWordDialog();
        say(t('Время вышло!'));
        handle(C.superWord(s, ''));
      }
    };
    tick();
    superTimer = setInterval(tick, 250);
    if (human()) openWordDialog();
  }

  function showBoxes() {
    const dlg = $('boxes-dlg');
    dlg.hidden = false;
    $('boxes-sub').textContent = t('{name}, три буквы подряд! В одной из шкатулок {n} очков.', { name: nameOf(s.turn), n: fmt.format(C.BOX_PRIZE) });
    $('boxes-result').textContent = '';
    for (const b of dlg.querySelectorAll('.box')) {
      b.classList.remove('opened');
      b.disabled = !human();
    }
    if (human()) dlg.querySelector('.box').focus();
    scheduleBot();
  }
  function openBox(i) {
    if (!s || s.phase !== 'boxes' || busy) return;
    const ev = C.pickBox(s, i, Math.random());
    if (!ev) return;
    busy = true;
    const boxes = $('boxes-dlg').querySelectorAll('.box');
    boxes.forEach((b, k) => {
      b.disabled = true;
      b.querySelector('.body').dataset.prize = k === ev.prize ? fmt.format(C.BOX_PRIZE) : t('пусто');
    });
    boxes[i].classList.add('opened');
    setTimeout(() => boxes[1 - i].classList.add('opened'), 700);
    Sound.box(ev.win);
    const line = ev.win ? t('{name} находит {n} очков! Крутите дальше', { name: nameOf(ev.player), n: fmt.format(ev.gain) })
      : t('Пусто! Деньги были в другой шкатулке. Крутите дальше');
    $('boxes-result').textContent = line;
    save();
    render();
    later(() => {
      $('boxes-dlg').hidden = true;
      say(line);
      after();
    }, reduceMotion ? 1200 : 2200);
  }
  $('boxes-dlg').addEventListener('click', (e) => {
    const b = e.target.closest('.box');
    if (b && !b.disabled && human()) openBox(Number(b.dataset.i));
  });

  function fillTable(rows) {
    const ol = $('end-table');
    ol.textContent = '';
    rows.forEach((r, place) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', COLORS[r.i]);
      li.innerHTML = '<span class="place"></span><span class="who"></span><span><b></b> <small></small></span>';
      li.querySelector('.place').textContent = `${place + 1}.`;
      li.querySelector('.who').textContent = r.name;
      li.querySelector('.who').setAttribute('data-i18n-skip', '');
      li.querySelector('b').textContent = fmt.format(r.total);
      li.querySelector('small').textContent = `${r.wins} ${plural(r.wins, 'слово|слова|слов')}`;
      ol.appendChild(li);
    });
  }
  function endButtons(list) {
    const row = $('end-row');
    row.textContent = '';
    list.forEach(([text, primary, fn]) => {
      const b = document.createElement('button');
      b.className = `btn${primary ? ' primary' : ''}`;
      b.textContent = text;
      b.addEventListener('click', fn);
      row.appendChild(b);
    });
    row.lastChild.focus();
  }

  function showRoundEnd() {
    const w = s.winner;
    $('end-title').textContent = w >= 0 ? t('Победитель раунда: {name}', { name: nameOf(w) }) : t('Раунд без победителя');
    $('end-word').textContent = s.word;
    $('end-word').lang = s.lang;
    $('end-text').textContent = w >= 0 ? t('В банк: +{n}', { n: fmt.format(s.score[w]) }) : t('Очки раунда сгорели у всех.');
    fillTable(C.standings(s));
    $('end-board').textContent = '';
    const last = s.round + 1 >= s.rounds;
    $('end-dlg').hidden = false;
    endButtons([[last ? t('К суперигре') : t('Следующий раунд'), true, () => {
      $('end-dlg').hidden = true;
      C.nextRound(s);
      Wheel.show(0);
      if (s.super) say(t('Суперигра! {name}, назовите {n} буквы — и у вас будет {sec} секунд на слово', { name: nameOf(s.turn), n: C.SUPER_LETTERS, sec: C.SUPER_SECONDS }));
      else announceRound();
      after();
    }]]);
  }

  async function showFinal() {
    const pl = s.players[s.turn];
    $('end-title').textContent = t('Игра окончена');
    $('end-word').textContent = s.word;
    $('end-word').lang = s.lang;
    $('end-text').textContent = s.super.won
      ? t('{name}: суперигра выиграна, банк удвоен: +{n}', { name: pl.name, n: fmt.format(s.super.gain) })
      : t('{name}: слово суперигры не угадано, банк остаётся прежним.', { name: pl.name });
    fillTable(C.standings(s));
    $('end-board').textContent = '';
    $('end-dlg').hidden = false;
    endButtons([
      [t('В меню'), false, () => { s = null; showSetup(); }],
      [t('Сыграть ещё'), true, () => { $('end-dlg').hidden = true; startGame(); }],
    ]);
    // The finalist's bank goes to the shared leaderboard when the Go server is there and a person played.
    if (pl.bot || pl.total <= 0) return;
    const done = s;
    try {
      const res = await fetch(BOARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pl.name, score: pl.total, level: Math.max(1, pl.wins + (s.super.won ? 1 : 0)) }),
      });
      if (!res.ok || s !== done) return;
      const { rank } = await res.json();
      $('end-board').textContent = rank ? t('Место в таблице рекордов: {n}', { n: rank }) : t('В таблицу рекордов не хватило очков.');
    } catch { /* no server: the game works without it */ }
  }

  // ───────────── Wiring ─────────────
  $('btn-start').addEventListener('click', startGame);
  $('btn-continue').addEventListener('click', () => {
    const saved = store.get(SAVE_KEY);
    if (!saved || saved.v !== 1) { showSetup(); return; }
    Sound.init();
    s = saved;
    enterGame();
    say(t('Продолжаем! Ход: {name}', { name: nameOf(s.turn) }));
    if (s.phase === 'roundEnd') showRoundEnd();
    else if (s.phase === 'boxes') showBoxes();
    else if (s.phase === 'superGuess') startSuperClock();
  });
  $('btn-quit').addEventListener('click', () => { s = null; busy = false; showSetup(); });
  $('btn-spin').addEventListener('click', doSpin);
  $('btn-word').addEventListener('click', openWordDialog);
  $('btn-sound').addEventListener('click', () => {
    Sound.init();
    Sound.muted = !Sound.muted;
    renderSound();
  });
  function renderSound() {
    $('btn-sound').textContent = Sound.muted ? t('Звук: выкл') : t('Звук: вкл');
    $('btn-sound').setAttribute('aria-pressed', String(!Sound.muted));
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && !$('word-dlg').hidden && !$('word-cancel').hidden) { hideWordDialog(); return; }
    if (!s || $('game').hidden || busy || !human()) return;
    if (!$('word-dlg').hidden || !$('boxes-dlg').hidden || !$('end-dlg').hidden) return;
    // Space spins even when focus stayed on a letter or a board cell; the two action buttons handle it themselves.
    if ((e.key === ' ' || e.key === 'Enter') && s.phase === 'spin' && !['btn-spin', 'btn-word', 'btn-quit'].includes(e.target.id)) {
      e.preventDefault();
      doSpin();
      return;
    }
    const k = C.key(e.key, s.lang);
    if (k && (s.phase === 'letter' || s.phase === 'superPick') && !s.used.includes(k)) {
      e.preventDefault();
      pickLetter(k);
    }
  });

  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; Wheel.resize(); sizeBoard(); });
  });

  const actions = $('top-actions');
  actions.appendChild(window.I18n.toggle('chip'));
  if (window.GameNav) actions.appendChild(window.GameNav.home('chip'));
  renderSound();
  showSetup();
})();
