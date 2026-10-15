'use strict';
// Рубеж — client: screens, input, effects and the Canvas 2D art of the front line. The rules live in core.js
// (window.FrontCore), the levels in levels.js (window.FrontLevels), pure helpers in view.js (window.FrontView).
(() => {
  const F = window.FrontCore;
  const V = window.FrontView;
  const { LEVELS } = window.FrontLevels;
  const { t } = window.I18n;
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const SAVE_EVERY = 10;

  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Names: chop, mine, build, built, recruit, clash, arrow, wall, horn, fort, order, win, lose.
  const Sound = window.FrontAudio;
  const sfx = (name, opts) => Sound.play(name, opts);

  const canvas = $('field');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let progress = F.loadProgress(storage, LEVELS.length);
  let g = null;            // the game in play
  let levelIdx = 0;
  let screen = 'menu';     // menu | levels | play | result
  let paused = false;
  let overlay = null;      // build | alloc | pause | null
  let target = null;       // the plot or chasm the build panel is for
  let speed = 1;
  let cam = V.camera({ w: 640, h: 360 }, 100);
  let view = { w: 640, h: 360, dpr: 1 };
  let sinceSave = 0;
  let drag = null;
  let fx = { floats: [], shots: [], puffs: [], shake: 0 };
  let time = 0, last = 0;

  const UNIT_NAME = { worker: 'Рабочий', soldier: 'Мечник', archer: 'Лучник', knight: 'Рыцарь', catapult: 'Катапульта' };
  const BUILD_NAME = { house: 'Дом', barracks: 'Казарма', wall: 'Стена', tower: 'Башня', forge: 'Кузница', bridge: 'Мост', stonewall: 'Каменная стена' };
  const BUILD_DESC = {
    house: 'Ещё трое рабочих', barracks: 'Мечники и лучники', wall: 'Держит врагов: войско стоит за ней',
    tower: 'Стреляет по врагам издалека', forge: 'Рыцари, катапульты, мечники сильнее', bridge: 'Путь через пропасть и к её богатствам',
    stonewall: 'Стена втрое крепче',
  };
  const RES_NAME = { wood: 'Дерево', stone: 'Камень', metal: 'Металл' };
  const RES_COLOR = { wood: '#b07a3c', stone: '#a9adb3', metal: '#cfd8e2' };

  // ───────────── Canvas size ─────────────
  function resize() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const w = Math.max(200, Math.floor(stage.clientWidth - padX));
    const h = Math.max(150, Math.floor(Math.min(stage.clientHeight - padY, w * (w < 500 ? 1.1 : 0.7))));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    view = { w, h, dpr };
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    cam = V.camera(view, g ? g.L : 100, cam.x0);
  }

  // ───────────── Saving ─────────────
  function persist() { F.saveProgress(storage, progress); }
  function saveCurrent() {
    if (!g || g.status !== 'playing') return;
    progress.current = { level: levelIdx, state: F.snapshot(g) };
    persist();
    sinceSave = 0;
  }

  // ───────────── Levels ─────────────
  function startLevel(i, state) {
    levelIdx = i;
    g = state ? F.restore(state) : F.newGame(LEVELS[i], (Date.now() % 1e9) >>> 0);
    if (!g) g = F.newGame(LEVELS[i], 1);
    screen = 'play';
    paused = false;
    overlay = null;
    speed = 1;
    fx = { floats: [], shots: [], puffs: [], shake: 0 };
    cam = V.camera(view, g.L, 0);
    show(null);
    $('hud').hidden = false;
    $('bottombar').hidden = false;
    if (!state) saveCurrent();
    renderAll();
    banner(t('Уровень {n}: {name}', { n: i + 1, name: t(LEVELS[i].name) }), 2);
    canvas.focus({ preventScroll: true });
  }

  function finish() {
    const won = g.status === 'won';
    const stars = F.stars(g);
    if (won) F.recordStars(progress, levelIdx, stars);
    progress.current = null;
    persist(); // the stars land the moment the level is decided
    sfx(won ? 'win' : 'lose');
    screen = 'result';
    overlay = null;
    $('bottombar').hidden = true;
    const title = $('res-title');
    title.textContent = won ? t('Крепость взята!') : t('Крепость пала');
    title.classList.toggle('won', won);
    title.classList.toggle('lost', !won);
    $('res-stars').textContent = won ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
    $('res-main').textContent = t('Время: {t} · контрольное: {par}', { t: V.clock(g.t), par: V.clock(LEVELS[levelIdx].par) });
    $('res-note').textContent = won
      ? t('Твоя крепость: {p}% · лучшее: {s} из 3 звёзд', { p: Math.round((g.keep.hp / g.keep.maxHp) * 100), s: progress.stars[levelIdx] })
      : t('Построй стены и башни перед своими рабочими.');
    $('btn-res-next').hidden = !won || levelIdx >= LEVELS.length - 1;
    show('result');
    (won && levelIdx < LEVELS.length - 1 ? $('btn-res-next') : $('btn-res-retry')).focus({ preventScroll: true });
  }

  // ───────────── Effects ─────────────
  function banner(text, seconds = 1.6) {
    const b = $('banner');
    b.textContent = text;
    b.hidden = false;
    fx.banner = seconds;
  }

  function float(x, text, color, y = 3) {
    fx.floats.push({ x, y, text, color, t: 0, life: 0.9 });
  }

  function handle(events) {
    for (const e of events) {
      switch (e.type) {
        case 'gather': sfx(e.res === 'wood' ? 'chop' : 'mine'); break;
        case 'deposit': break;
        case 'build': sfx('build'); break;
        case 'built': sfx('built'); fx.puffs.push({ x: e.x, t: 0, color: '#d8c8a0' }); renderBottom(); break;
        case 'bridged': banner(t('Мост готов')); break;
        case 'recruit': sfx('recruit'); renderBottom(); break;
        case 'queue': renderBottom(); break;
        case 'hit': if (e.side === 'own') float(e.x, `−${e.dmg}`, '#ff8a7a'); if (e.by === 'soldier' || e.by === 'knight') sfx('clash'); break;
        case 'shot': fx.shots.push({ from: e.from, to: e.to, kind: e.kind, foe: e.side === 'foe', t: 0 }); sfx('arrow'); break;
        case 'kill': fx.puffs.push({ x: e.x, t: 0, color: e.side === 'foe' ? '#c85a4a' : '#7fa0d8' }); break;
        case 'wallHit': sfx('wall'); fx.shake = Math.min(4, fx.shake + 1); break;
        case 'wallDown': banner(t('Стена рухнула!')); break;
        case 'keepHit': fx.shake = Math.min(6, fx.shake + 2); sfx('wall'); break;
        case 'fortHit': float(g.L - F.FORT_W + 2, `−${e.dmg}`, '#ffd34d', 6); sfx('fort'); break;
        case 'wave': sfx('horn'); banner(e.last ? t('Последняя волна!') : t('Волна {n} идёт!', { n: e.n })); break;
        case 'patrol': sfx('horn'); break;
        case 'order': sfx('order'); renderBottom(); break;
        default: break;
      }
    }
  }

  // ───────────── HUD & bars ─────────────
  function renderHUD() {
    if (!g) return;
    for (const r of F.RES) $(`res-${r}`).textContent = V.fmt(g.res[r]);
    $('hud-workers').textContent = `${F.count(g, 'worker')}/${F.workerCap(g)}`;
    $('keep-fill').style.width = `${(g.keep.hp / g.keep.maxHp) * 100}%`;
    $('fort-fill').style.width = `${(g.fort.hp / g.fort.maxHp) * 100}%`;
    $('keep-bar').title = t('Твоя крепость: {n}', { n: Math.ceil(g.keep.hp) });
    $('fort-bar').title = t('Вражеская крепость: {n}', { n: Math.ceil(g.fort.hp) });
    $('hud-clock').textContent = V.clock(g.t);
    $('btn-pause').textContent = paused ? t('Дальше') : t('Пауза');
    $('btn-speed').textContent = `×${speed}`;
  }

  const costText = (cost) => F.RES.filter((r) => cost[r]).map((r) => `${cost[r]} ${t(RES_NAME[r]).toLowerCase()}`).join(', ');

  let bottomKey = '';
  function renderBottom() {
    if (!g) return;
    const box = $('recruit');
    const kinds = Object.keys(F.UNITS);
    const key = kinds.map((k) => `${F.canRecruit(g, k)}:${g.queue.filter((q) => q === k).length}`).join('|') + g.order;
    if (key === bottomKey) return;
    bottomKey = key;
    box.innerHTML = '';
    kinds.forEach((k, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'unit';
      const state = F.canRecruit(g, k);
      b.disabled = state === 'locked' || state === 'cap';
      const q = g.queue.filter((x) => x === k).length;
      const why = state === 'locked' ? t(F.UNITS[k].need === 'forge' ? 'Нужна кузница' : 'Нужна казарма')
        : state === 'cap' ? t(k === 'worker' ? 'Нужен дом' : 'Войско в сборе') : costText(F.UNITS[k].cost);
      b.title = `${t(UNIT_NAME[k])} (${i + 1}): ${why}`;
      b.setAttribute('aria-label', b.title);
      b.innerHTML = `<span>${t(UNIT_NAME[k])}</span><small>${why}</small>${q ? `<span class="q">${q}</span>` : ''}`;
      b.addEventListener('click', () => { Sound.unlock(); recruit(k); });
      box.append(b);
    });
    const o = $('btn-order');
    o.textContent = g.order === 'attack' ? t('В атаку!') : t('Держать рубеж');
    o.classList.toggle('attack', g.order === 'attack');
    o.setAttribute('aria-pressed', String(g.order === 'attack'));
  }

  function recruit(kind) {
    if (!g || screen !== 'play') return;
    const r = F.recruit(g, kind);
    if (r === 'nores') banner(t('Не хватает: {list}', { list: costText(F.missing(g, F.UNITS[kind].cost)) }), 1.2);
    handle(F.drain(g));
    renderAll();
  }

  function renderAll() { renderHUD(); renderBottom(); }

  // ───────────── Screens ─────────────
  const SCREENS = ['menu', 'levels', 'build', 'alloc', 'result', 'pause'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name && name !== 'pause' && name !== 'build' && name !== 'alloc');
  }

  function showMenu() {
    if (g && g.status === 'playing' && screen === 'play') saveCurrent();
    screen = 'menu';
    g = null;
    overlay = null;
    $('hud').hidden = true;
    $('bottombar').hidden = true;
    $('banner').hidden = true;
    const total = progress.stars.reduce((a, b) => a + b, 0);
    $('records').textContent = total ? t('Звёзд: {n} из {m}', { n: total, m: LEVELS.length * 3 }) : '';
    renderSound();
    show('menu');
    $('btn-play').focus({ preventScroll: true });
  }

  function showLevels() {
    if (g && g.status === 'playing' && screen === 'play') saveCurrent();
    screen = 'levels';
    g = null;
    overlay = null;
    $('hud').hidden = true;
    $('bottombar').hidden = true;
    const grid = $('level-grid');
    grid.innerHTML = '';
    LEVELS.forEach((l, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const open = F.unlocked(progress, i);
      const cur = progress.current && progress.current.level === i;
      b.className = 'lvl' + (cur ? ' current' : '');
      b.disabled = !open;
      const st = progress.stars[i];
      b.innerHTML = `${i + 1}<small>${t(l.name)}</small><span class="st">${open ? '★'.repeat(st) + '☆'.repeat(3 - st) : '🔒'}</span>`;
      b.setAttribute('aria-label', `${i + 1}. ${t(l.name)}${open ? '' : ` — ${t('закрыт')}`}`);
      b.addEventListener('click', () => {
        Sound.unlock();
        const resume = progress.current && progress.current.level === i ? progress.current.state : null;
        startLevel(i, resume);
      });
      grid.append(b);
    });
    show('levels');
    const first = grid.children[F.firstUnfinished(progress)];
    if (first) first.focus({ preventScroll: true });
  }

  function openBuild(tg) {
    if (!g || screen !== 'play' || !tg) return;
    target = tg;
    overlay = 'build';
    renderBuild();
    show('build');
  }

  function renderBuild() {
    const list = $('build-list');
    list.innerHTML = '';
    const opts = V.buildMenu(g, target);
    const p = target.plot != null ? g.plots[target.plot] : null;
    $('build-title').textContent = target.chasm != null ? t('Пропасть') : p && p.b ? t(BUILD_NAME[p.b.stone ? 'stonewall' : p.b.id]) : t('Пустой участок');
    $('build-lead').textContent = !opts.length ? (p && p.b && !p.b.done ? t('Идёт стройка…') : t('Здесь уже ничего не построить.'))
      : opts.every((o) => o.state === 'locked') ? t('Сначала построй мост: участок за пропастью.') : t('Выбери, что строить.');
    for (const o of opts) {
      const row = document.createElement('div');
      row.className = 'item';
      const miss = costText(o.missing);
      row.innerHTML = `<b>${t(BUILD_NAME[o.id])}</b><small>${t(BUILD_DESC[o.id])} · ${costText(o.cost)}</small>${o.state === 'nores' ? `<small class="miss">${t('Не хватает: {list}', { list: miss })}</small>` : ''}`;
      const acts = document.createElement('div');
      acts.className = 'acts';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = t('Строить');
      b.disabled = o.state !== 'ok';
      b.addEventListener('click', () => {
        if (F.build(g, target, o.id) !== 'ok') return;
        handle(F.drain(g));
        closeOverlay();
        renderAll();
        saveCurrent();
      });
      acts.append(b);
      row.append(acts);
      list.append(row);
    }
  }

  function openAlloc() {
    if (!g || screen !== 'play') return;
    overlay = 'alloc';
    renderAlloc();
    show('alloc');
  }

  function renderAlloc() {
    const list = $('alloc-list');
    list.innerHTML = '';
    const workers = F.count(g, 'worker');
    const set = F.RES.reduce((a, r) => a + (r === 'wood' ? 0 : g.alloc[r]), 0);
    $('alloc-lead').textContent = t('Рабочих: {n}. Кого не позвали к камню и металлу, рубят лес.', { n: workers });
    for (const r of ['stone', 'metal']) {
      const row = document.createElement('div');
      row.className = 'item';
      const reach = F.reachableNodes(g, r).length;
      row.innerHTML = `<b>${t(RES_NAME[r])}</b><small>${reach ? t('Рабочих: {n}', { n: g.alloc[r] }) : t('Нет пути: построй мост')}</small>`;
      const acts = document.createElement('div');
      acts.className = 'acts';
      const mk = (label, d, aria) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = label;
        b.setAttribute('aria-label', aria);
        b.disabled = !reach || (d < 0 ? g.alloc[r] <= 0 : set >= workers);
        b.addEventListener('click', () => { F.setAlloc(g, r, g.alloc[r] + d); renderAlloc(); });
        return b;
      };
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(g.alloc[r]);
      acts.append(mk('−', -1, t('Меньше: {res}', { res: t(RES_NAME[r]) })), n, mk('+', 1, t('Больше: {res}', { res: t(RES_NAME[r]) })));
      row.append(acts);
      list.append(row);
    }
    const wood = document.createElement('div');
    wood.className = 'item';
    wood.innerHTML = `<b>${t(RES_NAME.wood)}</b><small>${t('Рабочих: {n}', { n: Math.max(0, workers - set) })}</small>`;
    list.append(wood);
  }

  function closeOverlay() {
    overlay = null;
    target = null;
    if (screen === 'play') show(paused ? 'pause' : null);
    canvas.focus({ preventScroll: true });
  }

  function togglePause() {
    if (screen !== 'play') return;
    paused = !paused;
    overlay = paused ? 'pause' : null;
    show(paused ? 'pause' : null);
    if (paused) saveCurrent();
    renderHUD();
  }

  function setOrder(o) {
    if (!g || screen !== 'play') return;
    F.setOrder(g, o);
    handle(F.drain(g));
    if (o === 'attack') cam = V.centerOn(cam, Math.max(...g.units.filter((u) => u.kind !== 'worker').map((u) => u.x), cam.x0 + cam.span / 2));
  }

  function renderSound() {
    const on = !!Sound.enabled;
    const label = on ? t('Звук: вкл') : t('Звук: выкл');
    $('btn-sound-menu').textContent = label;
    $('btn-sound-menu').setAttribute('aria-pressed', String(on));
    const b = $('btn-sound');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  function toggleSound() {
    Sound.setEnabled(!Sound.enabled);
    Sound.unlock();
    renderSound();
  }

  // ───────────── Drawing ─────────────
  const sx = (x) => (x - cam.x0) * cam.scale;
  const gy = () => cam.ground;

  function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, cam.ground);
    sky.addColorStop(0, '#2b4a6b');
    sky.addColorStop(1, '#a9c4b0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, view.w, view.h);
    // far hills move slower than the line
    for (const [k, color, hgt] of [[0.25, '#6d8a6a', 0.32], [0.55, '#4f6c48', 0.2]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, cam.ground);
      for (let x = 0; x <= view.w + 20; x += 20) {
        const wx = x + cam.x0 * cam.scale * k;
        ctx.lineTo(x, cam.ground - view.h * hgt * (0.6 + 0.4 * Math.sin(wx / 90) * Math.cos(wx / 37)));
      }
      ctx.lineTo(view.w, cam.ground);
      ctx.fill();
    }
    ctx.fillStyle = '#3e5a2c';
    ctx.fillRect(0, cam.ground, view.w, view.h - cam.ground);
    ctx.fillStyle = '#5a7a3a';
    ctx.fillRect(0, cam.ground, view.w, 4);
  }

  function drawChasms() {
    const s = cam.scale;
    for (const c of g.chasms) {
      const a = sx(c.x0), b = sx(c.x1);
      if (b < 0 || a > view.w) continue;
      ctx.fillStyle = '#1a140e';
      ctx.fillRect(a, cam.ground, b - a, view.h - cam.ground);
      ctx.fillStyle = '#2b2117';
      ctx.beginPath(); ctx.moveTo(a, cam.ground); ctx.lineTo(a + s * 0.6, view.h); ctx.lineTo(a, view.h); ctx.fill();
      ctx.beginPath(); ctx.moveTo(b, cam.ground); ctx.lineTo(b - s * 0.6, view.h); ctx.lineTo(b, view.h); ctx.fill();
      // planks, segment by segment, the one in work half-done
      for (let k = 0; k < c.segments; k++) {
        const done = k < c.built || c.bridged;
        const partial = !done && c.busy && k === c.built ? c.work / F.BUILD.bridge.time : 0;
        if (!done && !partial) continue;
        const x0 = sx(c.x0 + k * F.CELL), w = F.CELL * s * (done ? 1 : partial);
        ctx.fillStyle = '#8a5a2c';
        ctx.fillRect(x0, cam.ground - 3, w, 6);
        ctx.fillStyle = '#5c3a1a';
        for (let p = 0; p < w; p += 6) ctx.fillRect(x0 + p, cam.ground - 3, 1.5, 6);
      }
    }
  }

  function drawNodes() {
    const s = cam.scale;
    for (const n of g.nodes) {
      const x = sx(n.x);
      if (x < -40 || x > view.w + 40) continue;
      const y = cam.ground;
      if (n.res === 'wood') {
        for (const [dx, hh] of [[-1.2, 4.2], [0.4, 5.2], [1.5, 3.8]]) {
          ctx.fillStyle = '#5a3c22';
          ctx.fillRect(x + dx * s - 2, y - hh * s * 0.35, 4, hh * s * 0.35);
          ctx.fillStyle = '#2f6b33';
          ctx.beginPath(); ctx.moveTo(x + dx * s - s * 0.9, y - hh * s * 0.3); ctx.lineTo(x + dx * s, y - hh * s); ctx.lineTo(x + dx * s + s * 0.9, y - hh * s * 0.3); ctx.fill();
        }
      } else if (n.res === 'stone') {
        ctx.fillStyle = '#8d9196';
        ctx.beginPath(); ctx.ellipse(x - s * 0.6, y, s * 1.1, s * 0.9, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#a9adb3';
        ctx.beginPath(); ctx.ellipse(x + s * 0.7, y, s * 0.8, s * 0.65, 0, Math.PI, 0); ctx.fill();
      } else {
        ctx.fillStyle = '#4a3b2c';
        ctx.beginPath(); ctx.ellipse(x, y, s * 1.6, s * 1.4, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#16100a';
        ctx.beginPath(); ctx.ellipse(x, y, s * 0.6, s * 0.8, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#cfd8e2';
        ctx.fillRect(x + s * 0.9, y - s * 0.4, s * 0.4, s * 0.3);
      }
    }
  }

  function drawBuilding(p, i) {
    const s = cam.scale, x = sx(p.x), y = cam.ground;
    if (x < -60 || x > view.w + 60) return;
    if (!p.b) {
      const locked = p.x >= F.frontier(g);
      ctx.strokeStyle = locked ? 'rgba(255,255,255,.25)' : (target && target.plot === i ? '#ffd34d' : 'rgba(255,255,230,.7)');
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - s * 1.4, y - s * 1.6, s * 2.8, s * 1.6);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,230,.8)';
      ctx.font = `700 ${Math.round(s * 1.1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(locked ? '·' : '+', x, y - s * 0.8);
      return;
    }
    const b = p.b, k = b.done ? 1 : Math.min(1, b.work / b.need);
    ctx.save();
    if (!b.done) ctx.globalAlpha = 0.45 + 0.4 * k;
    switch (b.id) {
      case 'house':
        ctx.fillStyle = '#9a6b3c'; ctx.fillRect(x - s * 1.2, y - s * 1.6, s * 2.4, s * 1.6);
        ctx.fillStyle = '#7a2e22'; ctx.beginPath(); ctx.moveTo(x - s * 1.5, y - s * 1.6); ctx.lineTo(x, y - s * 2.7); ctx.lineTo(x + s * 1.5, y - s * 1.6); ctx.fill();
        ctx.fillStyle = '#3b2412'; ctx.fillRect(x - s * 0.3, y - s * 0.9, s * 0.6, s * 0.9);
        break;
      case 'barracks':
        ctx.fillStyle = '#7d6a4a'; ctx.fillRect(x - s * 1.5, y - s * 1.8, s * 3, s * 1.8);
        ctx.fillStyle = '#5a4a32'; ctx.fillRect(x - s * 1.6, y - s * 2.1, s * 3.2, s * 0.35);
        ctx.fillStyle = '#4a6fb3'; ctx.fillRect(x + s * 1.1, y - s * 3.4, s * 0.8, s * 0.5);
        ctx.fillStyle = '#3b2b1b'; ctx.fillRect(x + s * 1.05, y - s * 3.4, s * 0.08, s * 1.4);
        break;
      case 'forge':
        ctx.fillStyle = '#6a6460'; ctx.fillRect(x - s * 1.3, y - s * 1.5, s * 2.6, s * 1.5);
        ctx.fillStyle = '#4a4440'; ctx.fillRect(x + s * 0.5, y - s * 2.8, s * 0.6, s * 1.4);
        ctx.fillStyle = `rgba(255,140,60,${0.5 + 0.3 * Math.sin(time * 6)})`; ctx.fillRect(x - s * 0.8, y - s * 0.9, s * 0.8, s * 0.6);
        if (b.done) { ctx.fillStyle = 'rgba(200,200,200,.35)'; ctx.beginPath(); ctx.arc(x + s * 0.8 + Math.sin(time) * 3, y - s * 3.2 - (time * 8 % 10), s * 0.4, 0, TAU); ctx.fill(); }
        break;
      case 'tower':
        ctx.fillStyle = '#8a8a86'; ctx.fillRect(x - s * 0.7, y - s * 4, s * 1.4, s * 4);
        ctx.fillStyle = '#6e6e6a';
        for (let q = -1; q <= 1; q++) ctx.fillRect(x + q * s * 0.5 - s * 0.2, y - s * 4.4, s * 0.4, s * 0.4);
        ctx.fillStyle = '#4a6fb3'; ctx.beginPath(); ctx.arc(x, y - s * 4.6, s * 0.25, 0, TAU); ctx.fill();
        break;
      case 'wall': {
        const stone = b.stone && b.done;
        ctx.fillStyle = stone ? '#9a9a94' : '#8a5a2c';
        const hh = s * 2.6;
        if (stone) {
          ctx.fillRect(x - s * 0.8, y - hh, s * 1.6, hh);
          ctx.fillStyle = '#7a7a74';
          for (let r = 0; r < 4; r++) ctx.fillRect(x - s * 0.8, y - hh + r * hh / 4, s * 1.6, 1.2);
        } else {
          for (let q = -2; q <= 2; q++) {
            ctx.fillRect(x + q * s * 0.32 - s * 0.14, y - hh, s * 0.28, hh);
            ctx.beginPath(); ctx.moveTo(x + q * s * 0.32 - s * 0.14, y - hh); ctx.lineTo(x + q * s * 0.32, y - hh - s * 0.4); ctx.lineTo(x + q * s * 0.32 + s * 0.14, y - hh); ctx.fill();
          }
        }
        if (b.done && b.hp < b.maxHp) {
          ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - s, y - hh - s * 1.2, s * 2, 4);
          ctx.fillStyle = '#8fd17a'; ctx.fillRect(x - s, y - hh - s * 1.2, s * 2 * (b.hp / b.maxHp), 4);
        }
        break;
      }
      default: break;
    }
    ctx.restore();
    if (!b.done) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - s, y + 4, s * 2, 4);
      ctx.fillStyle = '#ffd34d'; ctx.fillRect(x - s, y + 4, s * 2 * k, 4);
    }
  }

  function drawKeep(x, own) {
    const s = cam.scale, y = cam.ground;
    const hp = own ? g.keep.hp / g.keep.maxHp : g.fort.hp / g.fort.maxHp;
    const base = own ? '#9aa0a6' : '#4a4048';
    const w = F.FORT_W * s * (own ? 0.75 : 1);
    const left = own ? x : x - w;
    ctx.fillStyle = base;
    ctx.fillRect(left, y - s * 6, w, s * 6);
    ctx.fillStyle = own ? '#7d838a' : '#3a3038';
    for (let q = 0; q < 5; q++) ctx.fillRect(left + q * w / 5 + 1, y - s * 6.6, w / 10, s * 0.6);
    ctx.fillRect(left + (own ? w * 0.6 : 0), y - s * 9, w * 0.4, s * 3);
    ctx.fillStyle = own ? '#4a6fb3' : '#b3322b';
    const fx0 = left + (own ? w * 0.8 : w * 0.2);
    ctx.fillRect(fx0, y - s * 11, 2, s * 2);
    // the flag flies toward the other side
    const wave = Math.sin(time * 4 + (own ? 0 : 1)) * s * 0.15;
    ctx.beginPath(); ctx.moveTo(fx0 + 2, y - s * 11); ctx.lineTo(fx0 + 2 + s * 1.2 * (own ? 1 : -1), y - s * 10.5 + wave); ctx.lineTo(fx0 + 2, y - s * 10); ctx.fill();
    ctx.fillStyle = '#1a1410';
    ctx.beginPath(); ctx.arc(left + w / 2, y - s * 1.3, s * 1.1, Math.PI, 0); ctx.fill();
    ctx.fillRect(left + w / 2 - s * 1.1, y - s * 1.3, s * 2.2, s * 1.3);
    // cracks by damage
    ctx.strokeStyle = 'rgba(20,10,10,.7)';
    ctx.lineWidth = 1.5;
    if (hp < 0.7) { ctx.beginPath(); ctx.moveTo(left + w * 0.3, y - s * 5.5); ctx.lineTo(left + w * 0.4, y - s * 4); ctx.lineTo(left + w * 0.32, y - s * 3); ctx.stroke(); }
    if (hp < 0.35) { ctx.beginPath(); ctx.moveTo(left + w * 0.7, y - s * 5.8); ctx.lineTo(left + w * 0.62, y - s * 4.2); ctx.lineTo(left + w * 0.75, y - s * 2.5); ctx.stroke(); }
    if (!own) for (let k = 0; k < g.fort.towers; k++) {
      ctx.fillStyle = '#3a3038';
      ctx.fillRect(left - s * 0.4 + k * s * 1.5, y - s * 8, s * 1, s * 2);
    }
  }

  function drawUnit(u, foe) {
    const s = cam.scale, x = sx(u.x), y = cam.ground;
    if (x < -30 || x > view.w + 30) return;
    const step = Math.sin(time * 9 + u.id) * s * 0.12;
    const kind = u.kind;
    const big = kind === 'ogre' ? 2 : kind === 'brute' || kind === 'knight' ? 1.25 : kind === 'catapult' ? 1.3 : 1;
    const h = s * 1.6 * big;
    const dir = foe ? -1 : 1;
    if (kind === 'catapult') {
      ctx.fillStyle = '#7a5530';
      ctx.fillRect(x - s * 1.1, y - s * 0.8, s * 2.2, s * 0.4);
      ctx.fillStyle = '#3b2a1a';
      ctx.beginPath(); ctx.arc(x - s * 0.7, y - s * 0.3, s * 0.3, 0, TAU); ctx.arc(x + s * 0.7, y - s * 0.3, s * 0.3, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(x - s * 0.3, y - s * 0.8); ctx.rotate(-0.9 + Math.max(0, Math.sin(time * 2 + u.id)) * 0.6);
      ctx.fillStyle = '#8a5a2c'; ctx.fillRect(0, -2, s * 1.6, 4); ctx.restore();
      return;
    }
    // legs, body, head
    ctx.fillStyle = foe ? '#4a2626' : '#2b3550';
    ctx.fillRect(x - s * 0.18 + step * 0.3, y - h * 0.35, s * 0.14 * big, h * 0.35);
    ctx.fillRect(x + s * 0.04 - step * 0.3, y - h * 0.35, s * 0.14 * big, h * 0.35);
    const body = foe ? (kind === 'ogre' ? '#5f7a46' : kind === 'brute' ? '#8a3a2a' : '#b84a3a') : kind === 'worker' ? '#8a6a48' : kind === 'knight' ? '#c0c8d0' : '#3d64b0';
    ctx.fillStyle = body;
    ctx.fillRect(x - s * 0.25 * big, y - h * 0.82, s * 0.5 * big, h * 0.5);
    ctx.fillStyle = kind === 'ogre' ? '#6f8a54' : '#e8c49a';
    ctx.beginPath(); ctx.arc(x, y - h * 0.92, s * 0.2 * big, 0, TAU); ctx.fill();
    if (kind === 'knight' || kind === 'soldier') { ctx.fillStyle = '#9aa4ad'; ctx.beginPath(); ctx.arc(x, y - h * 0.95, s * 0.21 * big, Math.PI, 0); ctx.fill(); }
    // tool or weapon
    ctx.strokeStyle = kind === 'archer' || kind === 'slinger' ? '#8a5a2c' : '#c9d0d8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (kind === 'archer') { ctx.arc(x + dir * s * 0.35, y - h * 0.6, s * 0.35, -Math.PI / 2, Math.PI / 2, dir < 0); }
    else if (kind === 'worker') { ctx.moveTo(x + s * 0.3, y - h * 0.4); ctx.lineTo(x + s * 0.3, y - h * 0.9); }
    else { ctx.moveTo(x + dir * s * 0.3, y - h * 0.5); ctx.lineTo(x + dir * s * 0.75 * big, y - h * 0.85); }
    ctx.stroke();
    if (kind === 'worker' && u.load) {
      ctx.fillStyle = RES_COLOR[u.carry] || '#b07a3c';
      ctx.fillRect(x - s * 0.5, y - h * 0.95, s * 0.35, s * 0.35);
    }
    if (u.hp < u.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - s * 0.4, y - h - 6, s * 0.8, 3);
      ctx.fillStyle = foe ? '#ff8a7a' : '#8fd17a'; ctx.fillRect(x - s * 0.4, y - h - 6, s * 0.8 * Math.max(0, u.hp / u.maxHp), 3);
    }
  }

  function drawFx(dt) {
    const s = cam.scale;
    fx.shots = fx.shots.filter((p) => (p.t += dt) < 0.35);
    for (const p of fx.shots) {
      const k = p.t / 0.35;
      const x = sx(p.from + (p.to - p.from) * k);
      const y = cam.ground - s * (2.5 + Math.sin(k * Math.PI) * (p.kind === 'catapult' ? 5 : 1.5));
      ctx.fillStyle = p.kind === 'catapult' ? '#6a6460' : p.foe ? '#ff8a7a' : '#f2e6c8';
      if (p.kind === 'catapult') { ctx.beginPath(); ctx.arc(x, y, s * 0.35, 0, TAU); ctx.fill(); }
      else ctx.fillRect(x - 3, y - 1, 6, 2);
    }
    fx.puffs = fx.puffs.filter((p) => (p.t += dt) < 0.6);
    for (const p of fx.puffs) {
      ctx.globalAlpha = 1 - p.t / 0.6;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(sx(p.x), cam.ground - s * 1, s * (0.4 + p.t * 2), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    fx.floats = fx.floats.filter((f) => (f.t += dt) < f.life);
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of fx.floats) {
      ctx.globalAlpha = 1 - f.t / f.life;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx(f.x), cam.ground - s * f.y - f.t * 26);
    }
    ctx.globalAlpha = 1;
  }

  function drawWorld(dt) {
    drawSky();
    drawChasms();
    drawNodes();
    drawKeep(sx(0), true);
    drawKeep(sx(g.L), false);
    g.plots.forEach(drawBuilding);
    for (const u of g.units) drawUnit(u, false);
    for (const f of g.foes) drawUnit(f, true);
    drawFx(dt);
    // the edges of the line: arrows to what is off screen
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    if (cam.x0 > 0.5) { ctx.textAlign = 'left'; ctx.fillText('◀', 6, cam.ground * 0.5); }
    if (cam.x0 + cam.span < g.L - 0.5) { ctx.textAlign = 'right'; ctx.fillText('▶', view.w - 6, cam.ground * 0.5); }
    const foesOff = g.foes.filter((f) => sx(f.x) > view.w).length;
    if (foesOff) { ctx.fillStyle = '#ff8a7a'; ctx.textAlign = 'right'; ctx.fillText(`${foesOff} ▶`, view.w - 6, cam.ground * 0.5 + 18); }
  }

  function drawMenuScene() {
    cam = V.camera(view, 140, (time * 3) % 60);
    drawSky();
    const s = cam.scale;
    ctx.fillStyle = '#2f6b33';
    for (let x = 10; x < 140; x += 17) {
      const px = sx(x);
      ctx.beginPath(); ctx.moveTo(px - s, cam.ground); ctx.lineTo(px, cam.ground - s * 3); ctx.lineTo(px + s, cam.ground); ctx.fill();
    }
  }

  // ───────────── Frame ─────────────
  function frame(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    time += dt;
    if (fx.banner > 0) { fx.banner -= dt; if (fx.banner <= 0) $('banner').hidden = true; }
    fx.shake = Math.max(0, fx.shake - dt * 15);
    if (screen === 'play' && g && !paused && overlay !== 'build') {
      for (let k = 0; k < speed; k++) F.step(g, dt);
      handle(F.drain(g));
      sinceSave += dt;
      if (sinceSave >= SAVE_EVERY) saveCurrent();
      if (keys.ArrowLeft) cam = V.pan(cam, dt * 400);
      if (keys.ArrowRight) cam = V.pan(cam, -dt * 400);
      if (g.status !== 'playing') finish();
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    if (fx.shake > 0) ctx.translate((Math.random() - 0.5) * fx.shake, 0);
    if (g) drawWorld(dt);
    else drawMenuScene();
    if (g && Math.floor(time * 4) !== Math.floor((time - dt) * 4)) { renderHUD(); renderBottom(); if (overlay === 'build') renderBuild(); }
    requestAnimationFrame(frame);
  }

  // ───────────── Input ─────────────
  // A drag pans the camera; a tap (little movement) opens the build panel at a plot or a chasm.
  canvas.addEventListener('pointerdown', (e) => {
    if (screen !== 'play' || !g) return;
    Sound.unlock();
    drag = { id: e.pointerId, x0: e.clientX, x: e.clientX, moved: 0 };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    drag.moved += Math.abs(dx);
    if (drag.moved > 8) cam = V.pan(cam, dx);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const tapped = drag.moved <= 8;
    drag = null;
    if (!tapped || screen !== 'play') return;
    const r = canvas.getBoundingClientRect();
    const tg = V.plotAt(cam, g, e.clientX - r.left, e.clientY - r.top);
    if (tg) openBuild(tg);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; });

  let keys = {};
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code;
    if (k === 'KeyM') { toggleSound(); return; }
    if (k === 'Escape') {
      if (overlay === 'build' || overlay === 'alloc') { closeOverlay(); return; }
      if (screen === 'play') { if (!paused) togglePause(); else showLevels(); return; }
      if (screen === 'levels' || screen === 'result') showMenu();
      return;
    }
    if (screen !== 'play' || !g) return;
    Sound.unlock();
    if (k === 'ArrowLeft' || k === 'ArrowRight') { keys[k] = true; e.preventDefault(); return; }
    if (k === 'Space') { togglePause(); e.preventDefault(); return; }
    if (paused) return;
    if (/^Digit[1-5]$/.test(k)) { recruit(Object.keys(F.UNITS)[Number(k.slice(5)) - 1]); return; }
    if (k === 'KeyA') setOrder('attack');
    else if (k === 'KeyH') setOrder('hold');
    else if (k === 'KeyB') {
      // the plot nearest the middle of the view
      const mid = cam.x0 + cam.span / 2;
      let best = null, bd = Infinity;
      g.plots.forEach((p, i) => { const d = Math.abs(p.x - mid); if (d < bd) { bd = d; best = { plot: i }; } });
      g.chasms.forEach((c, i) => { if (!c.bridged && Math.abs((c.x0 + c.x1) / 2 - mid) < bd) { bd = Math.abs((c.x0 + c.x1) / 2 - mid); best = { chasm: i }; } });
      openBuild(best);
    }
  });
  document.addEventListener('keyup', (e) => { delete keys[e.code]; });
  window.addEventListener('blur', () => { keys = {}; drag = null; if (screen === 'play' && !paused) togglePause(); });

  $('btn-play').addEventListener('click', () => { Sound.unlock(); showLevels(); });
  $('btn-levels-back').addEventListener('click', showMenu);
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-build-close').addEventListener('click', closeOverlay);
  $('btn-alloc').addEventListener('click', openAlloc);
  $('btn-alloc-close').addEventListener('click', closeOverlay);
  $('btn-order').addEventListener('click', () => setOrder(g && g.order === 'attack' ? 'hold' : 'attack'));
  $('btn-speed').addEventListener('click', () => { speed = speed === 1 ? 2 : 1; renderHUD(); });
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-pause-menu').addEventListener('click', showLevels);
  $('btn-pause-retry').addEventListener('click', () => { progress.current = null; persist(); startLevel(levelIdx); });
  $('btn-res-levels').addEventListener('click', showLevels);
  $('btn-res-retry').addEventListener('click', () => startLevel(levelIdx));
  $('btn-res-next').addEventListener('click', () => startLevel(Math.min(LEVELS.length - 1, levelIdx + 1)));

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  window.addEventListener('pagehide', saveCurrent);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveCurrent(); });

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  // The game on screen, for the browser smoke test. Read-only use only.
  window.frontDebugGame = () => g;
  window.frontDebugCam = () => cam;
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
