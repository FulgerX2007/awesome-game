'use strict';
// Искорка — screens, drawing, sound and persistence. Rules live in core.js (window.MathCore).
(() => {
  const C = window.MathCore;
  const SAVE_KEY = 'math.save';
  const CLOUD_KEY = 'math.cloud';
  const $ = (id) => document.getElementById(id);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const T = (k, v) => I18n.t(k, v);
  const P = (n, forms) => I18n.p(n, forms);
  // The default name is stored as the Russian key, so it shows up translated in either language.
  const dragonName = () => (S.name === 'Искорка' ? T('Искорка') : S.name);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  };

  let S = C.newState();
  function load() {
    try { const raw = store.get(SAVE_KEY); if (raw) S = C.migrate(JSON.parse(raw)); } catch { S = C.newState(); }
  }
  const save = () => store.set(SAVE_KEY, JSON.stringify(S));

  // ───────────── Sound: tiny synth, no files ─────────────
  let ac = null;
  function tone(freq, at, dur, type = 'sine', vol = 0.18) {
    if (!S.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch { /* audio is a nicety */ }
  }
  const sfx = {
    tap: () => tone(660, 0, 0.06, 'triangle', 0.06),
    good: () => { tone(784, 0, 0.18, 'triangle'); tone(1175, 0.09, 0.28, 'triangle'); },
    bad: () => { tone(330, 0, 0.18, 'sine', 0.14); tone(262, 0.12, 0.25, 'sine', 0.12); },
    combo: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.06, 0.22, 'triangle', 0.14)),
    hit: () => { tone(180, 0, 0.2, 'sawtooth', 0.08); tone(120, 0.05, 0.25, 'square', 0.05); },
    star: (i) => tone(880 + i * 220, 0, 0.3, 'triangle', 0.16),
    chest: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.35, 'triangle', 0.15)),
    grow: () => [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.4, 'sine', 0.15)),
  };

  // ───────────── Pictures ─────────────
  function dragonSVG(opts = {}) {
    const stage = opts.stage ?? C.stage(S);
    const col = C.COLORS[opts.color || S.color] || C.COLORS.green;
    const eq = opts.equip || S.equip;
    const mood = opts.mood || 'happy';
    const ink = '#2b2340';
    if (stage === 0) {
      return `<svg viewBox="0 -20 200 220" role="img" aria-label="${T('Яйцо дракончика')}"><g class="egg">
        <ellipse cx="100" cy="190" rx="50" ry="8" fill="rgba(43,35,64,.12)"/>
        <ellipse cx="100" cy="124" rx="52" ry="66" fill="${col.belly}" stroke="${col.dark}" stroke-width="4"/>
        <ellipse cx="78" cy="98" rx="12" ry="9" fill="${col.main}"/><ellipse cx="122" cy="132" rx="15" ry="11" fill="${col.main}"/>
        <ellipse cx="88" cy="160" rx="10" ry="7" fill="${col.main}"/><ellipse cx="118" cy="82" rx="7" ry="5" fill="${col.main}"/>
        <path d="M70 70 Q78 60 86 66" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/></g></svg>`;
    }
    const s = [0, 0.74, 0.86, 0.95, 1.05][stage];
    const wings = stage >= 2 ? (() => {
      const w = stage >= 4 ? 'scale(1.25)' : '';
      const wing = `<path d="M64 128 Q18 84 26 138 Q40 128 46 144 Q56 132 66 142 Z" fill="${col.dark}" stroke="${col.dark}" stroke-width="3" stroke-linejoin="round"/>`;
      return `<g transform="translate(64 128) ${w} translate(-64 -128)">${wing}</g><g transform="translate(200 0) scale(-1 1) translate(64 128) ${w} translate(-64 -128)">${wing}</g>`;
    })() : '';
    const horns = stage >= 3
      ? `<path d="M76 54 L66 24 L90 46 Z" fill="#fff2c9" stroke="#d9b75a" stroke-width="3" stroke-linejoin="round"/><path d="M124 54 L134 24 L110 46 Z" fill="#fff2c9" stroke="#d9b75a" stroke-width="3" stroke-linejoin="round"/>`
      : '';
    const spikes = stage >= 2 ? `<path d="M88 46 L94 32 L100 44 L106 32 L112 46 Z" fill="${col.dark}"/>` : '';
    const mouth = mood === 'wow'
      ? `<ellipse cx="100" cy="109" rx="7" ry="6" fill="${ink}"/><ellipse cx="100" cy="111" rx="4" ry="2.5" fill="#ff8fa3"/>`
      : mood === 'sad'
        ? `<path d="M92 110 Q100 104 108 110" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`
        : `<path d="M90 105 Q100 115 110 105" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    let head = '', face = '', neck = '';
    if (eq.head === 'bow') head = `<g transform="translate(130 50)"><path d="M0 0 L-17 -11 L-15 11 Z M0 0 L17 -11 L15 11 Z" fill="#ff6fa8" stroke="#d94c86" stroke-width="2" stroke-linejoin="round"/><circle r="5" fill="#ff8fbd" stroke="#d94c86" stroke-width="2"/></g>`;
    if (eq.head === 'hat') head = `<path d="M68 52 L104 -14 L132 52 Z" fill="#4b5bd6" stroke="#3441a8" stroke-width="3" stroke-linejoin="round"/><ellipse cx="100" cy="52" rx="42" ry="9" fill="#3a47b0"/><text x="92" y="28" font-size="14" fill="#ffd23f">★</text><text x="106" y="44" font-size="10" fill="#ffd23f">★</text>`;
    if (eq.head === 'crown') head = `<path d="M70 52 L70 26 L84 40 L100 18 L116 40 L130 26 L130 52 Z" fill="#ffd23f" stroke="#c9921c" stroke-width="3" stroke-linejoin="round"/><circle cx="100" cy="40" r="5" fill="#ff5d73"/><circle cx="82" cy="46" r="3.5" fill="#4aa8ff"/><circle cx="118" cy="46" r="3.5" fill="#4aa8ff"/>`;
    if (eq.face === 'glasses') face = `<g fill="rgba(255,255,255,.18)" stroke="${ink}" stroke-width="3.5"><circle cx="84" cy="80" r="15"/><circle cx="116" cy="80" r="15"/></g><path d="M99 80 Q100 76 101 80" stroke="${ink}" stroke-width="3.5" fill="none"/>`;
    if (eq.neck === 'scarf') neck = `<rect x="64" y="113" width="72" height="15" rx="7.5" fill="#e8463c"/><rect x="112" y="118" width="13" height="28" rx="5" fill="#d23a31" transform="rotate(-12 118 118)"/><path d="M70 120 H130" stroke="#ff8a7f" stroke-width="3" stroke-dasharray="6 6"/>`;
    return `<svg viewBox="0 -20 200 220" role="img" aria-label="${T('Дракончик')}"><g class="breathe"><g transform="translate(100 190) scale(${s}) translate(-100 -190)">
      <ellipse cx="100" cy="190" rx="52" ry="8" fill="rgba(43,35,64,.12)"/>
      <path d="M132 160 Q176 168 172 132 Q170 118 180 112" stroke="${col.main}" stroke-width="15" fill="none" stroke-linecap="round"/>
      <path d="M174 102 L194 106 L182 122 Z" fill="${col.dark}"/>
      ${wings}
      <ellipse cx="100" cy="146" rx="47" ry="42" fill="${col.main}"/>
      <ellipse cx="100" cy="153" rx="29" ry="29" fill="${col.belly}"/>
      <path d="M84 142 H116 M82 154 H118 M86 166 H114" stroke="${col.main}" stroke-width="2.5" opacity=".35" stroke-linecap="round"/>
      <ellipse cx="62" cy="146" rx="9" ry="14" fill="${col.main}" transform="rotate(25 62 146)"/>
      <ellipse cx="138" cy="146" rx="9" ry="14" fill="${col.main}" transform="rotate(-25 138 146)"/>
      <ellipse cx="78" cy="186" rx="15" ry="8" fill="${col.dark}"/><ellipse cx="122" cy="186" rx="15" ry="8" fill="${col.dark}"/>
      ${horns}${spikes}
      <circle cx="100" cy="82" r="41" fill="${col.main}"/>
      ${neck}
      <ellipse cx="84" cy="80" rx="11" ry="12.5" fill="#fff"/><ellipse cx="116" cy="80" rx="11" ry="12.5" fill="#fff"/>
      <circle cx="86" cy="83" r="6.5" fill="${ink}"/><circle cx="114" cy="83" r="6.5" fill="${ink}"/>
      <circle cx="88.5" cy="80" r="2.3" fill="#fff"/><circle cx="116.5" cy="80" r="2.3" fill="#fff"/>
      <ellipse cx="70" cy="98" rx="7" ry="4.5" fill="#ff9fb0" opacity=".75"/><ellipse cx="130" cy="98" rx="7" ry="4.5" fill="#ff9fb0" opacity=".75"/>
      <ellipse cx="100" cy="100" rx="16" ry="10" fill="${col.belly}"/>
      <circle cx="95" cy="98" r="1.8" fill="${col.dark}"/><circle cx="105" cy="98" r="1.8" fill="${col.dark}"/>
      ${mouth}${face}${head}
    </g></g></svg>`;
  }

  function monsterSVG(kind, mood) {
    const ink = '#2b2340';
    const c = kind === 'troll'
      ? { body: '#8fae7e', dark: '#6b8a5c', belly: '#c8dcb8' }
      : { body: '#a9d8f5', dark: '#6fa9d6', belly: '#e6f6ff' };
    const happy = mood === 'happy';
    const brows = happy
      ? `<path d="M66 70 Q78 62 90 68 M110 68 Q122 62 134 70" stroke="${ink}" stroke-width="4" fill="none" stroke-linecap="round"/>`
      : `<path d="M64 64 L90 74 M136 64 L110 74" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    const mouth = happy
      ? `<path d="M74 118 Q100 142 126 118" stroke="${ink}" stroke-width="4" fill="#ff8fa3" stroke-linejoin="round"/>`
      : `<path d="M74 126 Q100 112 126 126" stroke="${ink}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M80 124 L84 110 L89 121 Z M111 121 L116 110 L120 124 Z" fill="#fff" stroke="${ink}" stroke-width="2"/>`;
    const top = kind === 'troll'
      ? `<path d="M60 44 L50 14 L76 36 Z M140 44 L150 14 L124 36 Z" fill="#e9dcc0" stroke="#b9a57e" stroke-width="3" stroke-linejoin="round"/><path d="M92 30 Q100 6 108 30" stroke="${c.dark}" stroke-width="6" fill="none" stroke-linecap="round"/>`
      : `<path d="M44 58 Q60 18 100 20 Q140 18 156 58 Q140 46 126 54 Q112 40 100 52 Q86 40 74 54 Q60 46 44 58 Z" fill="#fff"/><path d="M62 160 L66 176 L72 160 M96 166 L100 184 L104 166 M128 160 L134 176 L138 160" fill="#fff" stroke="#cfeaff" stroke-width="2"/>`;
    const cheeks = happy ? `<ellipse cx="64" cy="104" rx="10" ry="6" fill="#ff9fb0" opacity=".8"/><ellipse cx="136" cy="104" rx="10" ry="6" fill="#ff9fb0" opacity=".8"/>` : '';
    return `<svg viewBox="0 0 200 200" role="img" aria-label="${esc(T(C.BOSSES[kind].name))}">
      <ellipse cx="100" cy="190" rx="60" ry="8" fill="rgba(43,35,64,.12)"/>
      <ellipse cx="34" cy="120" rx="16" ry="26" fill="${c.dark}" transform="rotate(-20 34 120)"/>
      <ellipse cx="166" cy="120" rx="16" ry="26" fill="${c.dark}" transform="rotate(20 166 120)"/>
      <path d="M36 110 Q30 30 100 32 Q170 30 164 110 Q166 178 100 182 Q34 178 36 110 Z" fill="${c.body}"/>
      <ellipse cx="100" cy="146" rx="40" ry="28" fill="${c.belly}"/>
      ${top}
      <ellipse cx="78" cy="88" rx="13" ry="14" fill="#fff"/><ellipse cx="122" cy="88" rx="13" ry="14" fill="#fff"/>
      <circle cx="${happy ? 78 : 80}" cy="90" r="7" fill="${ink}"/><circle cx="${happy ? 122 : 120}" cy="90" r="7" fill="${ink}"/>
      <circle cx="81" cy="87" r="2.4" fill="#fff"/><circle cx="125" cy="87" r="2.4" fill="#fff"/>
      ${brows}${cheeks}
      <ellipse cx="100" cy="106" rx="9" ry="7" fill="${c.dark}"/>
      ${mouth}
      <ellipse cx="72" cy="182" rx="18" ry="8" fill="${c.dark}"/><ellipse cx="128" cy="182" rx="18" ry="8" fill="${c.dark}"/>
    </svg>`;
  }

  // ───────────── Toasts & floating numbers ─────────────
  let toastT = 0;
  function toast(text, secs = 2.6) {
    const t = $('toast');
    t.textContent = text; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), secs * 1000);
  }
  function floatText(text, el) {
    const r = el.getBoundingClientRect(), f = document.createElement('div');
    f.className = 'float'; f.textContent = text;
    f.style.left = `${r.left + r.width / 2 - 20}px`; f.style.top = `${r.top - 8}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }
  function bump(id) { const el = $(id); el.parentElement.classList.remove('bump'); void el.offsetWidth; el.parentElement.classList.add('bump'); }

  // ───────────── Screens ─────────────
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    document.body.classList.toggle('playing', id === 'scr-play');
    window.scrollTo(0, 0);
  }
  function renderTop() {
    $('top-stars').textContent = C.totalStars(S);
    $('top-crystals').textContent = S.crystals;
    $('btn-sound').textContent = S.sound ? '🔊' : '🔈';
    $('btn-sound').setAttribute('aria-pressed', String(S.sound));
    $('btn-sound').setAttribute('aria-label', T('Звук'));
  }

  // ───────────── Map ─────────────
  const ZIG = [0, 70, 105, 70, 0, -70, -105, -70];
  const ROW = 128;
  function renderHome() {
    const st = C.stage(S), t = C.totalStars(S);
    $('home-dragon').innerHTML = dragonSVG();
    $('home-name').textContent = dragonName();
    $('home-stage').textContent = T(C.STAGES[st].name);
    const next = C.STAGES[st + 1];
    if (next) {
      const from = C.STAGES[st].at, need = next.at - t;
      $('grow-bar').style.width = `${Math.round(((t - from) / (next.at - from)) * 100)}%`;
      $('home-next').textContent = st === 0
        ? T('Пройди первый уровень, и дракончик вылупится!')
        : T('Ещё {n} {stars} — и станет «{stage}»', { n: need, stars: P(need, 'звезда|звезды|звёзд'), stage: T(next.name) });
    } else {
      $('grow-bar').style.width = '100%';
      $('home-next').textContent = T('Твой дракон вырос самым большим!');
    }
    const have = Object.keys(S.stickers).length;
    $('album-count').textContent = `${have}/${C.STICKERS.length}`;
    const rev = Object.keys(S.review).length;
    $('btn-practice').hidden = rev === 0;
    $('practice-count').textContent = rev;
  }
  function renderMap() {
    renderTop();
    renderHome();
    const box = $('regions');
    box.innerHTML = '';
    const width = box.clientWidth || Math.min(588, window.innerWidth - 32);
    const k = Math.min(1, (width - 140) / 220);
    const cur = C.currentLevel(S);
    for (const r of C.REGIONS) {
      const open = C.regionUnlocked(S, r.id);
      const sec = document.createElement('section');
      sec.className = `region ${r.id}`;
      const got = r.levels.reduce((a, l) => a + (S.stars[l.id] || 0), 0);
      sec.innerHTML = `<h2>${esc(T(r.name))}</h2><p class="sub">⭐ ${esc(T('{n} из {m}', { n: got, m: r.levels.length * 3 }))}</p>`;
      const path = document.createElement('div');
      path.className = 'path';
      path.style.height = `${r.levels.length * ROW + 40}px`;
      const pts = r.levels.map((l, i) => ({ x: width / 2 + ZIG[i % ZIG.length] * k, y: 20 + i * ROW + (l.boss ? 43 : 35) }));
      let d = `M${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], my = (a.y + b.y) / 2;
        d += ` C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`;
      }
      path.innerHTML = `<svg class="trail" viewBox="0 0 ${width} ${r.levels.length * ROW + 40}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="14" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${r.id === 'forest' ? '#a6d79c' : '#a9c1ef'}" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round"/></svg>`;
      const decos = r.id === 'forest' ? ['🌲', '🌳', '🌷', '🍀', '🌲', '🌻'] : ['🏔️', '⛰️', '☁️', '🌨️', '🏔️', '☁️'];
      r.levels.forEach((l, i) => {
        const side = ZIG[i % ZIG.length] >= 0 ? -1 : 1;
        if (i % 2 === 0) {
          const dc = document.createElement('span');
          dc.className = 'deco';
          dc.textContent = decos[i % decos.length];
          dc.style.left = `${width / 2 + side * Math.min(width / 2 - 26, 150 * Math.max(k, 0.75))}px`;
          dc.style.top = `${pts[i].y + 10}px`;
          path.appendChild(dc);
        }
        const unlocked = C.isUnlocked(S, l.id), stars = S.stars[l.id] || 0;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `node${l.boss ? ' boss' : ''}${unlocked ? '' : ' locked'}${stars ? ' done' : ''}${l.id === cur ? ' cur' : ''}`;
        b.style.left = `${pts[i].x}px`;
        b.style.top = `${20 + i * ROW}px`;
        b.dataset.id = l.id;
        const st = [1, 2, 3].map((n) => `<span class="${n <= stars ? '' : 'off'}">⭐</span>`).join('');
        b.innerHTML = `<span class="disc">${unlocked ? l.icon : '🔒'}${l.boss ? '' : `<span class="num">${i + 1}</span>`}</span>
          <span class="st">${unlocked && !l.boss || stars ? st : ''}</span>
          <span class="lbl">${esc(T(l.name))}<small>${esc(T(l.skill))}</small></span>`;
        b.setAttribute('aria-label', `${T(l.name)}: ${T(l.skill)}. ${unlocked ? T('{n} из 3 звёзд', { n: stars }) : T('закрыто')}`);
        b.addEventListener('click', () => {
          if (!C.isUnlocked(S, l.id)) { toast(l.index === 0 ? T(r.unlockText) : T('Сначала пройди предыдущий уровень')); return; }
          startLevel(l.id);
        });
        path.appendChild(b);
      });
      if (!open && r.unlockText) {
        const wall = document.createElement('div');
        wall.className = 'lockwall';
        wall.textContent = `🔒 ${T(r.unlockText)}`;
        path.appendChild(wall);
      }
      sec.appendChild(path);
      box.appendChild(sec);
    }
  }
  function showMap(scrollToCurrent) {
    stopRun();
    show('scr-map');
    renderMap();
    if (scrollToCurrent) {
      const node = document.querySelector('.node.cur');
      if (node) {
        const y = node.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2 + 60;
        if (y > 120) window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    }
  }

  // ───────────── Play ─────────────
  const PRAISE = ['Молодец!', 'Точно!', 'Супер!', 'Ура!', 'Здорово!', 'Отлично!', 'Верно!', 'Так держать!', 'Умница!', 'Ты лучше всех!'];
  const AFTER_FIX = ['Получилось!', 'Вот видишь!', 'Теперь запомним!', 'Справились!'];
  const OOPS = ['Почти! Давай посмотрим вместе.', 'Не спеши, вот подсказка.', 'Хм, проверим ещё раз?', 'Ошибаться можно! Смотри подсказку.'];
  const FOE_LAUGH = ['Хи-хи! Не то!', 'Ага, промах!', 'Хо-хо!'];
  const FOE_OUCH = ['Ой!', 'Ай-ай!', 'Ух!', 'Ох!'];

  let run = null, level = null, typed = '', locked = false, quitArmed = 0, timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  function stopRun() { timers.forEach(clearTimeout); timers = []; run = null; locked = false; }

  function startLevel(id) {
    stopRun();
    level = id === 'practice' ? null : C.LEVEL[id];
    const problems = id === 'practice' ? C.makePractice(S) : C.makeRound(S, id);
    if (!problems.length) { toast(T('Сначала пройди хотя бы один уровень')); return; }
    run = C.newRun(id, problems);
    show('scr-play');
    renderTop();
    const region = level ? level.region : 'forest';
    $('arena').dataset.region = region;
    $('foe').hidden = !run.boss;
    if (run.boss) {
      $('foe-body').innerHTML = monsterSVG(run.boss, 'grumpy');
      $('hp-bar').style.width = '100%';
    }
    $('play-dragon').innerHTML = dragonSVG({ mood: 'happy' });
    say(run.boss
      ? T(run.boss === 'troll' ? 'Тролль не пускает нас! Решай примеры — и он подобреет.' : 'Великан замёрз и сердится. Согреем его огоньком!')
      : id === 'practice' ? T('Повторим трудные примеры!') : T('Идём: {name}!', { name: T(level.name) }));
    resetQuit();
    nextProblem();
  }

  function say(text) { $('bubble').textContent = text; }
  function foeSay(text) {
    const el = $('foe-say');
    el.textContent = text; el.classList.add('on');
    later(() => el.classList.remove('on'), 1100);
  }
  function anim(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  function renderTrack() {
    const tr = $('track');
    tr.innerHTML = run.queue.map((p, i) => {
      let c = '';
      if (i < run.i) c = p.solvedFirst ? 'ok' : 'fix';
      else if (i === run.i) c = 'now';
      return `<i class="${c}${p.again ? ' again' : ''}"></i>`;
    }).join('');
    $('run-crystals').textContent = run.crystals;
  }

  function exprHTML(p) {
    const slot = `<span class="slot${typed ? ' filled' : ' caret'}" id="slot">${esc(typed)}</span>`;
    const n = (x) => `<span>${x}</span>`;
    if (p.form === 'missB') return `${n(p.a)}${n('+')}${slot}${n('=')}${n(p.a + p.b)}`;
    if (p.form === 'missA') return `${slot}${n('+')}${n(p.b)}${n('=')}${n(p.a + p.b)}`;
    if (p.form === 'repeat') return `${Array(p.a).fill(n(p.b)).join(n('+'))}${n('=')}${slot}`;
    return `${n(p.a)}${n(p.op)}${n(p.b)}${n('=')}${slot}`;
  }
  function captionFor(p) {
    if (p.form === 'repeat') return C.timesBy(p.a, p.b);
    if (p.op === '×' && run.id === 'm1') return T('{a} × {b} — это {times}', { a: p.a, b: p.b, times: C.timesBy(p.a, p.b) });
    if (p.form === 'missA' || p.form === 'missB') return T('Какое число спряталось?');
    if (p.again) return T('Этот пример уже был. Теперь получится!');
    return '';
  }
  function nextProblem() {
    const p = C.current(run);
    typed = '';
    locked = false;
    $('level-name').textContent = level ? `${T(level.name)} · ${T(level.skill)}` : T('Тренировка');
    $('expr').innerHTML = exprHTML(p);
    $('caption').textContent = captionFor(p);
    $('hint').hidden = true;
    $('hint').innerHTML = '';
    renderTrack();
    if (window.scrollY > 0) window.scrollTo(0, 0);
  }
  function refreshSlot() {
    const el = $('slot');
    if (!el) return;
    el.textContent = typed;
    el.className = `slot${typed ? ' filled' : ' caret'}`;
  }

  function vizHTML(v) {
    if (v.type === 'frame') {
      let h = '';
      for (let i = 0; i < v.total; i++) h += `<span class="${i < v.filled ? 'a' : ''}"></span>`;
      return `<div class="frames">${h}</div>`;
    }
    if (v.type === 'dots') {
      const [a, b] = v.parts, cells = Math.ceil((a + b) / 10) * 10;
      let h = '';
      for (let i = 0; i < cells; i++) h += `<span class="${i < a ? 'a' : i < a + b ? 'b' : ''}"></span>`;
      return `<div class="frames">${h}</div>`;
    }
    if (v.type === 'blocks') {
      return v.parts.map((x, j) => {
        const c = j ? 'var(--b)' : 'var(--a)';
        const rods = '<span class="rod"></span>'.repeat(Math.floor(x / 10));
        const ones = '<span class="one"></span>'.repeat(x % 10);
        return `<div class="blocks" style="--c:${c}">${rods}${ones ? `<span class="ones">${ones}</span>` : ''}</div>`;
      }).join('<span class="plus">+</span>');
    }
    if (v.type === 'grid') {
      let h = '';
      for (let r = 1; r <= v.rows; r++) h += `<div class="row">${'<i></i>'.repeat(v.cols)}<b>${r < v.rows ? r * v.cols : '?'}</b></div>`;
      return `<div class="grid">${h}</div>`;
    }
    return '';
  }
  function showHint(p, revealIt) {
    const h = C.hint(p);
    const el = $('hint');
    el.innerHTML = `<div class="viz">${vizHTML(h.visual)}</div>${h.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${revealIt ? `<p class="reveal">${esc(C.reveal(p))}</p>` : ''}`;
    el.hidden = false;
  }

  function press(k) {
    if (!run || locked) return;
    if (k === 'del') { typed = typed.slice(0, -1); refreshSlot(); sfx.tap(); return; }
    if (k === 'ok') { submit(); return; }
    if (typed.length >= 3) return;
    typed = (typed === '0' ? '' : typed) + k;
    sfx.tap();
    refreshSlot();
  }
  function submit() {
    if (!typed) { anim($('slot'), 'bump'); return; }
    const p = C.current(run);
    const res = C.answer(S, run, Number(typed));
    if (!res) return;
    save();
    const dragon = $('play-dragon');
    if (!res.ok) {
      sfx.bad();
      anim($('card'), 'wrong');
      dragon.innerHTML = dragonSVG({ mood: 'sad' });
      anim(dragon, 'sad');
      say(T(res.reveal ? 'Ничего страшного! Посмотри ответ и набери его.' : pick(OOPS)));
      showHint(p, res.reveal);
      if (run.boss) foeSay(T(pick(FOE_LAUGH)));
      typed = '';
      later(() => { refreshSlot(); dragon.innerHTML = dragonSVG({ mood: 'happy' }); }, 450);
      renderTrack();
      return;
    }
    p.solvedFirst = res.first;
    locked = true;
    $('slot').classList.add('right');
    anim($('card'), 'good');
    dragon.innerHTML = dragonSVG({ mood: res.combo ? 'wow' : 'happy' });
    anim(dragon, 'hop');
    if (res.combo) { sfx.combo(); say(T('Огненная серия! {n} подряд! +3 💎', { n: run.streak })); } else { sfx.good(); say(T(res.first ? pick(PRAISE) : pick(AFTER_FIX))); }
    floatText(`+${res.gain} 💎`, $('run-crystals'));
    renderTrack();
    let wait = 650;
    if (run.boss) {
      const fb = $('fireball'), foe = $('foe-body');
      const dx = foe.getBoundingClientRect().left - fb.getBoundingClientRect().left + 20;
      fb.style.setProperty('--dx', `${dx}px`);
      anim(fb, 'fly');
      later(() => {
        sfx.hit(); anim(foe, 'hit');
        $('hp-bar').style.width = `${(run.hp / run.original) * 100}%`;
        foeSay(T(run.hp ? pick(FOE_OUCH) : 'Сдаюсь!'));
      }, 480);
      wait = 900;
    }
    later(() => {
      if (res.done) finishLevel();
      else nextProblem();
    }, wait);
  }

  // ───────────── Result ─────────────
  let result = null, lastId = null;
  function finishLevel() {
    const id = run.id;
    lastId = id;
    const r = C.finish(S, run);
    result = r;
    save();
    stopRun();
    show('scr-result');
    renderTop();
    $('res-title').textContent = T(id === 'practice' ? 'Тренировка окончена!' : C.LEVEL[id].boss ? 'Победа дружбой!' : 'Уровень пройден!');
    const fr = $('res-friend');
    if (C.LEVEL[id] && C.LEVEL[id].boss) {
      fr.hidden = false;
      fr.innerHTML = `${monsterSVG(C.LEVEL[id].boss, 'happy')}<p>${esc(T(r.friend || 'Вы снова встретились — и снова друзья!'))}</p>`;
    } else fr.hidden = true;
    const starsEl = $('res-stars');
    if (id === 'practice') {
      starsEl.innerHTML = '🎯';
      $('res-note').textContent = T('Трудных примеров осталось: {n}', { n: Object.keys(S.review).length });
    } else {
      starsEl.innerHTML = [1, 2, 3].map(() => '<span>⭐</span>').join('');
      [...starsEl.children].forEach((s, i) => later(() => {
        s.className = i < r.stars ? 'on' : 'off';
        if (i < r.stars) sfx.star(i);
      }, 300 + i * 350));
      const missed = r.stars === 3 ? 'Почти без ошибок!' : r.stars === 2 ? 'Хорошо! Ещё чуть-чуть — и будет три звезды.' : 'Пройдено! Сыграй ещё раз, чтобы получить больше звёзд.';
      $('res-note').textContent = r.newBest && !r.firstClear ? `${T('Новый рекорд!')} ${T(missed)}` : T(missed);
    }
    $('res-crystals').textContent = r.crystals;
    $('chest').hidden = false;
    $('chest-tip').hidden = false;
    $('prize').hidden = true;
    $('grew').hidden = true;
    const nxt = nextAfter(id);
    $('btn-next').hidden = !nxt;
    $('btn-next').textContent = T(nxt && C.LEVEL[nxt].index === 0 ? 'В горы!' : 'Дальше');
    $('btn-again').hidden = id === 'practice' && Object.keys(S.review).length === 0;
  }
  function nextAfter(id) {
    if (id === 'practice') return null;
    const i = C.LEVELS.findIndex((l) => l.id === id);
    const n = C.LEVELS[i + 1];
    return n && C.isUnlocked(S, n.id) ? n.id : null;
  }
  function openChest() {
    if (!result) return;
    sfx.chest();
    $('chest').hidden = true;
    $('chest-tip').hidden = true;
    const p = $('prize'), c = result.chest;
    if (c.kind === 'sticker') {
      p.className = `prize r-${c.rarity}`;
      p.innerHTML = `<span class="e">${c.e}</span><span class="r">${T(C.RARITY[c.rarity] + ' наклейка!')}</span><small>${T('Она уже в альбоме')}</small>`;
    } else {
      p.className = 'prize';
      p.innerHTML = `<span class="e">💎</span><span class="r">+${c.n} ${P(c.n, 'кристалл|кристалла|кристаллов')}</span><small>${T('Все наклейки уже собраны!')}</small>`;
    }
    p.hidden = false;
    if (result.stageAfter !== result.stageBefore) {
      later(() => {
        sfx.grow();
        const g = $('grew');
        g.innerHTML = `${dragonSVG({ mood: 'wow' })}${esc(result.stageBefore === 0 ? T('Из яйца вылупился дракончик! Его зовут {name}.', { name: dragonName() }) : T('{name} подрос! Теперь это «{stage}».', { name: dragonName(), stage: T(C.STAGES[result.stageAfter].name) }))}`;
        g.hidden = false;
        g.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }, 700);
    }
    renderTop();
  }

  // ───────────── Shop ─────────────
  const ITEM_ICON = { bow: '🎀', glasses: '👓', scarf: '🧣', hat: '🎩', crown: '👑' };
  function renderShop() {
    $('shop-dragon').innerHTML = dragonSVG({ stage: Math.max(1, C.stage(S)) });
    $('shop-crystals').textContent = S.crystals;
    $('swatches').innerHTML = Object.entries(C.COLORS).map(([id, c]) => {
      const own = id === 'green' || S.owned.includes(id);
      const lbl = own ? T(c.name) : `💎 ${c.price}`;
      return `<button type="button" class="swatch${S.color === id ? ' on' : ''}${!own && S.crystals < c.price ? ' cant' : ''}" data-buy="${id}" aria-label="${T(c.name)}${own ? '' : `, ${c.price} ${P(c.price, 'кристалл|кристалла|кристаллов')}`}"><span class="dot" style="background:${c.main}"></span>${lbl}</button>`;
    }).join('');
    $('items').innerHTML = Object.entries(C.ITEMS).map(([id, it]) => {
      const own = S.owned.includes(id), on = S.equip[it.slot] === id;
      const sub = own ? T(on ? 'Надето · снять' : 'Надеть') : `💎 ${it.price}`;
      return `<button type="button" class="item${on ? ' on' : ''}${!own && S.crystals < it.price ? ' cant' : ''}" data-buy="${id}"><span class="ic">${ITEM_ICON[id]}</span><span>${T(it.name)}<small>${sub}</small></span></button>`;
    }).join('');
  }
  function shopClick(e) {
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    const id = b.dataset.buy;
    const owned = id === 'green' || S.owned.includes(id);
    if (owned) { C.use(S, id); sfx.tap(); }
    else if (C.buy(S, id)) { sfx.chest(); toast(T('Куплено!')); }
    else {
      const price = (C.COLORS[id] || C.ITEMS[id]).price;
      toast(T('Нужно ещё {n} 💎 — решай примеры!', { n: price - S.crystals }));
      return;
    }
    save(); renderShop(); renderTop(); renderHome();
  }

  // ───────────── Album ─────────────
  function renderAlbum() {
    const have = Object.keys(S.stickers).length;
    $('album-sub').textContent = T('Собрано {n} из {m}. Наклейки лежат в сундуках за каждый пройденный уровень.', { n: have, m: C.STICKERS.length });
    $('album').innerHTML = C.STICKERS.map((s) => (S.stickers[s.e]
      ? `<div class="r-${s.rarity}" title="${T(C.RARITY[s.rarity])}">${s.e}</div>`
      : `<div class="no r-${s.rarity}" title="${T(C.RARITY[s.rarity])}">?</div>`)).join('');
  }

  // ───────────── Parents ─────────────
  let gateAnswer = 0;
  function openParents() {
    const a = 6 + Math.floor(Math.random() * 4), b = 6 + Math.floor(Math.random() * 4);
    gateAnswer = a * b;
    $('gate-q').textContent = T('Сколько будет {a} × {b}?', { a, b });
    $('gate-a').value = '';
    $('gate').hidden = false;
    $('parents').hidden = true;
    $('dlg-parents').showModal();
  }
  function renderParents() {
    const t = S.totals;
    const acc = t.solved ? Math.round((t.firstTry / t.solved) * 100) : 0;
    $('stats').innerHTML = [
      [t.solved, 'примеров решено'], [`${acc}%`, 'с первой попытки'], [t.bestStreak, 'лучшая серия'],
      [`${C.totalStars(S)}/${C.maxStars()}`, 'звёзд'], [t.rounds, 'раундов'], [Object.keys(S.review).length, 'на повторении'],
    ].map(([v, l]) => `<div><b>${v}</b><span>${T(l)}</span></div>`).join('');
    const hard = C.hardest(S);
    $('hard').textContent = hard.length ? hard.map((h) => `${h.fact.replace('+', ' + ').replace('×', ' × ')} (${h.count})`).join(', ') : T('Пока ошибок нет.');
    $('levels').innerHTML = C.LEVELS.map((l) => `<tr><td>${l.icon} ${esc(T(l.name))} <span class="muted">· ${esc(T(l.skill))}</span></td><td>${'⭐'.repeat(S.stars[l.id] || 0) || '—'}</td><td>${S.plays[l.id] || 0} ${P(S.plays[l.id] || 0, 'раз|раза|раз')}</td></tr>`).join('');
    $('opt-unlock').checked = S.unlockAll;
  }

  let resetArmed = 0;
  function bindParents() {
    $('btn-parents').addEventListener('click', openParents);
    $('gate').addEventListener('submit', (e) => {
      e.preventDefault();
      if (Number($('gate-a').value) === gateAnswer) { $('gate').hidden = true; $('parents').hidden = false; renderParents(); }
      else { $('gate-a').value = ''; $('gate-q').textContent += ` ${T('Попробуйте ещё раз.')}`; }
    });
    $('opt-unlock').addEventListener('change', (e) => { S.unlockAll = e.target.checked; save(); renderMap(); });
    $('btn-reset').addEventListener('click', () => {
      const b = $('btn-reset');
      if (!resetArmed) {
        b.textContent = T('Точно? Нажмите ещё раз');
        resetArmed = setTimeout(() => { resetArmed = 0; b.textContent = T('Начать заново'); }, 4000);
        return;
      }
      clearTimeout(resetArmed); resetArmed = 0; b.textContent = T('Начать заново');
      const sound = S.sound;
      S = C.newState(); S.sound = sound; save();
      $('dlg-parents').close();
      showMap(false);
    });
  }

  // ───────────── Cloud saves (only when served by the Go backend) ─────────────
  async function initCloud() {
    try {
      const res = await fetch('/healthz');
      if (!res.ok || (await res.text()).trim() !== 'ok') return;
    } catch { return; }
    $('cloud').hidden = false;
    const pretty = (c) => c.match(/.{1,4}/g).join('-');
    let code = store.get(CLOUD_KEY);
    if (code) $('cloud-code').textContent = pretty(code);
    const put = async () => {
      const res = await fetch(`/api/saves/${code}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
      if (!res.ok) throw new Error(await res.text());
    };
    $('btn-cloud-save').addEventListener('click', async () => {
      if (!code) {
        const abc = 'abcdefghjkmnpqrstuvwxyz23456789', bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        code = Array.from(bytes, (b) => abc[b % abc.length]).join('');
      }
      try {
        await put();
        store.set(CLOUD_KEY, code);
        $('cloud-code').textContent = pretty(code);
        $('cloud-msg').textContent = T('Сохранено. Введите этот код на другом устройстве.');
      } catch (err) { $('cloud-msg').textContent = T('Не удалось сохранить: {e}', { e: err.message }); }
    });
    $('cloud-load').addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = $('cloud-input').value.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (c.length !== 16) { $('cloud-msg').textContent = T('Код состоит из 16 букв и цифр.'); return; }
      try {
        const res = await fetch(`/api/saves/${c}`);
        if (res.status === 404) { $('cloud-msg').textContent = T('Сохранения с таким кодом нет.'); return; }
        if (!res.ok) throw new Error(await res.text());
        S = C.migrate(await res.json());
        code = c; store.set(CLOUD_KEY, c); $('cloud-code').textContent = pretty(c);
        save(); renderParents(); renderMap();
        $('cloud-msg').textContent = T('Загружено.');
      } catch (err) { $('cloud-msg').textContent = T('Не удалось загрузить: {e}', { e: err.message }); }
    });
    setInterval(() => { if (code) put().catch(() => {}); }, 60000);
  }

  // ───────────── Wiring ─────────────
  function resetQuit() { quitArmed = 0; $('btn-quit').textContent = '✕'; $('btn-quit').classList.remove('armed'); }
  $('btn-quit').addEventListener('click', () => {
    if (!quitArmed) {
      $('btn-quit').textContent = T('Выйти?');
      $('btn-quit').classList.add('armed');
      quitArmed = setTimeout(resetQuit, 3000);
      return;
    }
    clearTimeout(quitArmed);
    resetQuit();
    showMap(true);
  });
  $('pad').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) press(b.dataset.k);
  });
  document.addEventListener('keydown', (e) => {
    if ($('scr-play').hidden || document.querySelector('dialog[open]')) return;
    let k = null;
    if (/^[0-9]$/.test(e.key)) k = e.key;
    else if (e.key === 'Backspace') k = 'del';
    else if (e.key === 'Enter') k = 'ok';
    if (!k) return;
    e.preventDefault();
    const btn = document.querySelector(`.pad [data-k="${k}"]`);
    if (btn) { btn.classList.add('press'); setTimeout(() => btn.classList.remove('press'), 120); }
    press(k);
  });
  $('btn-home').addEventListener('click', () => { if ($('scr-play').hidden) showMap(true); });
  $('btn-sound').addEventListener('click', () => { S.sound = !S.sound; save(); renderTop(); sfx.tap(); });
  $('btn-practice').addEventListener('click', () => startLevel('practice'));
  $('chest').addEventListener('click', openChest);
  $('btn-next').addEventListener('click', () => { const n = nextAfter(lastId); if (n) startLevel(n); });
  $('btn-again').addEventListener('click', () => startLevel(lastId));
  $('btn-map').addEventListener('click', () => showMap(true));
  $('btn-shop').addEventListener('click', () => { renderShop(); $('name-input').value = dragonName(); $('dlg-shop').showModal(); });
  $('dlg-shop').addEventListener('click', shopClick);
  $('dlg-shop').addEventListener('close', () => renderMap());
  $('name-input').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    S.name = v && v !== T('Искорка') ? v : 'Искорка';
    save();
  });
  $('btn-album').addEventListener('click', () => { renderAlbum(); $('dlg-album').showModal(); });
  // Close a dialog by clicking the dimmed backdrop.
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }
  let rT = 0;
  window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (!$('scr-map').hidden) renderMap(); }, 150); });
  // Opening the chest is part of the reward; if the child leaves first, the prize is still theirs (it was saved in finish()).
  window.addEventListener('pagehide', save);

  load();
  document.querySelector('.chips').appendChild(I18n.toggle('chip icon lang'));
  bindParents();
  showMap(true);
  initCloud();
})();
