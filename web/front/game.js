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
  let fx = { shots: [], corpses: [], end: null, camTo: null };
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
    fx = { shots: [], corpses: [], end: null, camTo: null };
    particles.clear();
    floaters.list = [];
    anims.clear();
    shake.trauma = 0;
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
    endFx(won);
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

  // Floating numbers in world px, so they stay over their spot while the camera pans.
  function float(x, text, color, y = 3, size = 14) {
    floaters.add(text, wpx(x), cam.ground - cam.scale * y, { color, size });
    if (floaters.list.length > 36) floaters.list.shift();
  }
  function flash(id) { const a = anims.get(id); if (a) a.fl = 1; }
  function hitFx(h) {
    if (h.side === 'own') float(h.x, `−${h.dmg}`, '#ff8a7a', 2.6, 14);
    else float(h.x, `−${h.dmg}`, '#ffe14d', 2.5, 13);
    flash(h.id);
    if (h.dmg >= 25) shake.add(0.25);
  }
  const plotIndexAt = (x) => g.plots.findIndex((p) => Math.abs(p.x - x) < 0.01);
  function dust(x, n, big = 1) {
    const s = cam.scale, G = cam.ground;
    emit(x, G, n, { speed: s * 3 * big, angle: -Math.PI / 2, spread: 3.2, life: 0.9, size: s * 0.3 * big, grow: s * 0.7 * big, colors: ['#e2d2ac', '#cdb98e', '#f0e4c8'], shape: 'smoke', drag: 0.85 });
  }
  function chips(x, y, n, colors) {
    emit(x, y, n, { speed: cam.scale * 5, angle: -Math.PI / 2, spread: 2.8, life: 0.6, size: cam.scale * 0.14, colors, shape: 'chunk', gravity: cam.scale * 22, spin: 12 });
  }
  function endFx(won) {
    const s = cam.scale, G = cam.ground, x = won ? g.L - F.FORT_W / 2 : F.KEEP_X / 2;
    fx.end = { won, t: 0 };
    fx.camTo = won ? g.L - cam.span * 0.85 : -cam.span * 0.1;
    for (let k = 0; k < 4; k++) dust(x - 3 + k * 2, 8, 1.8);
    chips(x, G - s * 3, 16, won ? ['#7d6f78', '#5a4f56', '#c63a2c'] : ['#c2bbad', '#9a948a', '#3b6fd4']);
    if (won) emit(x, G - s * 6, 30, { speed: s * 9, life: 1.2, size: 4, colors: ['#ffd34d', '#ffffff', '#6fdc8c'], shape: 'star', gravity: s * 6, spin: 6 });
    shake.add(0.8);
  }

  function handle(events) {
    const s = cam.scale, G = cam.ground;
    let pend = [];
    for (const e of events) {
      switch (e.type) {
        case 'gather': sfx(e.res === 'wood' ? 'chop' : 'mine'); float(e.x, `+${F.GATHER.load}`, RES_COLOR[e.res], 2.6, 12); break;
        case 'deposit': break;
        case 'build': {
          sfx('build');
          const tg = e.target, c = tg && tg.chasm != null ? g.chasms[tg.chasm] : null;
          const x = c ? c.x0 : tg && g.plots[tg.plot] ? g.plots[tg.plot].x : null;
          if (x != null) dust(x, 8);
          break;
        }
        case 'built': {
          sfx('built');
          dust(e.x, e.id === 'bridge' ? 6 : 14, e.id === 'bridge' ? 0.8 : 1.3);
          if (e.id !== 'bridge') {
            emit(e.x, G - s * 2, 12, { speed: s * 6, angle: -Math.PI / 2, spread: 2.4, life: 0.9, size: Math.max(3, s * 0.22), colors: ['#ffd34d', '#fff6c0'], shape: 'star', gravity: s * 8, spin: 6 });
            particles.emit({ x: wpx(e.x), y: G, life: 0.45, size: s * 0.5, grow: s * 7, color: 'rgba(255, 245, 210, .9)', shape: 'ring' });
            const i = plotIndexAt(e.x);
            if (i >= 0) plotAnim(i).pop = time;
          }
          renderBottom();
          break;
        }
        case 'bridged': banner(t('Мост готов')); break;
        case 'recruit':
          sfx('recruit');
          emit(F.KEEP_X, G - s * 1.2, 10, { speed: s * 4, life: 0.7, size: Math.max(2.5, s * 0.16), colors: ['#ffd34d', '#ffffff', '#7fb8ff'], shape: 'star', spin: 6, drag: 0.6 });
          renderBottom();
          break;
        case 'queue': renderBottom(); break;
        case 'hit': {
          const h = { side: e.side, id: e.id, dmg: e.dmg, x: e.x };
          if (e.side === 'foe' && (e.by === 'soldier' || e.by === 'knight' || e.by === 'worker')) {
            hitFx(h);
            emit(e.x - 0.4, G - s * 1.0, 5, { speed: s * 4, life: 0.25, size: Math.max(1, s * 0.07), color: '#fff2b0', shape: 'spark' });
          } else pend.push(h);
          if (e.by === 'soldier' || e.by === 'knight') sfx('clash');
          break;
        }
        case 'shot': {
          addShot(e);
          const sh = fx.shots[fx.shots.length - 1];
          sh.hits = pend.filter((h) => Math.abs(h.x - e.to) < 0.01);
          pend = pend.filter((h) => !sh.hits.includes(h));
          sfx('arrow');
          break;
        }
        case 'kill': {
          const foe = e.side === 'foe';
          fx.corpses.push({ id: e.id, kind: e.kind, foe, x: e.x + (e.kind === 'worker' ? 0 : sway(e.id)), dir: foe ? -1 : 1, t: 0 });
          emit(e.x, G - s * 0.8, 8, { speed: s * 2.5, life: 0.8, size: s * 0.3, grow: s * 0.6, colors: foe ? ['#e0d0c8', '#c8b0a8'] : ['#d8e0f0', '#b8c4dc'], shape: 'smoke', drag: 0.8 });
          if (e.kind === 'ogre' || e.kind === 'catapult') { dust(e.x, 10, 1.4); shake.add(0.35); }
          break;
        }
        case 'wallHit': {
          sfx('wall');
          shake.add(0.1);
          const i = plotIndexAt(e.x), p = g.plots[i];
          if (i >= 0) plotAnim(i).hit = time;
          chips(e.x + 0.6, G - s * 1.6, 4, p && p.b && p.b.stone ? ['#b8b0a2', '#8a847a'] : ['#b98652', '#6b4424']);
          break;
        }
        case 'wallDown':
          banner(t('Стена рухнула!'));
          dust(e.x, 16, 1.6);
          chips(e.x, G - s * 1.5, 14, ['#b98652', '#6b4424', '#b8b0a2']);
          shake.add(0.5);
          break;
        case 'keepHit':
          shake.add(0.2);
          sfx('wall');
          chips(F.KEEP_X - 0.6, G - s * 2, 4, ['#c2bbad', '#9a948a']);
          break;
        case 'fortHit':
          float(g.L - F.FORT_W + 2, `−${e.dmg}`, '#ffd34d', 6, 16);
          chips(g.L - F.FORT_W + 0.3, G - s * 3, 3, ['#7d6f78', '#5a4f56']);
          sfx('fort');
          break;
        case 'wave': sfx('horn'); banner(e.last ? t('Последняя волна!') : t('Волна {n} идёт!', { n: e.n })); dust(g.L - F.FORT_W + 1.6, 10, 1.2); break;
        case 'patrol': sfx('horn'); break;
        case 'order': sfx('order'); renderBottom(); break;
        default: break;
      }
    }
    for (const h of pend) hitFx(h);
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
    stage.classList.toggle('res', name === 'result');
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
  // A 2.5D diorama seen from the side and a little from above: a baked parallax sky (clouds, mountains, two hill
  // ranges), a ground strip with a lit top surface and a soil front face (baked in chunks, chasms cut into it), and
  // lit buildings, figures and effects on top. All art below is drawn in metres: art(c, …) runs inside
  // translate(x, ground) · scale(px per metre), so it is the same code at every zoom. Light comes from the top left
  // (window.Fx). Input never reads any of this: the camera and hit-testing are view.js'.
  const Fx = window.Fx;
  const { shade, mix, withAlpha, ease } = Fx;
  const sx = (x) => (x - cam.x0) * cam.scale;
  const BACK = 0.75, FRONT = 0.85;      // the ground's top surface: metres behind / in front of the line units walk on
  const DX = 0.3, DY = -0.6;            // the depth axis of buildings (oblique: back is up and to the right)
  const CW = 256;                       // terrain chunk width, css px
  const particles = new Fx.Particles(320);
  const floaters = new Fx.Floaters();
  const shake = new Fx.Shake(9, 2.2);
  const anims = new Map();              // per unit / building: walk phase, attack swing, hit flash, pop-in
  const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let q = a; q = Math.imul(q ^ (q >>> 15), q | 1); q ^= q + Math.imul(q ^ (q >>> 7), q | 61); return ((q ^ (q >>> 14)) >>> 0) / 4294967296; };
  }
  function makeCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }
  // Particles live in "world px" (metres × scale) so they stay put while the camera pans.
  const wpx = (x) => x * cam.scale;
  function emit(xm, y, n, o) { particles.burst(wpx(xm), y, n, o); }

  // ── Shared lit primitives (metres) ──
  // An oblique box: front face (x … x+w, bottom yb, height h), a lit top and a shaded right side of depth d.
  function box(c, x, yb, w, h, d, col, o = {}) {
    const ox = DX * d, oy = DY * d, yt = yb - h;
    c.fillStyle = shade(col, -0.38);
    c.beginPath(); c.moveTo(x + w, yb); c.lineTo(x + w + ox, yb + oy); c.lineTo(x + w + ox, yt + oy); c.lineTo(x + w, yt); c.closePath(); c.fill();
    if (o.top !== false) {
      c.fillStyle = shade(o.topColor || col, 0.32);
      c.beginPath(); c.moveTo(x, yt); c.lineTo(x + ox, yt + oy); c.lineTo(x + w + ox, yt + oy); c.lineTo(x + w, yt); c.closePath(); c.fill();
    }
    const gr = c.createLinearGradient(x, yt, x + w * 0.6, yb);
    gr.addColorStop(0, shade(col, 0.14));
    gr.addColorStop(1, shade(col, -0.16));
    c.fillStyle = gr;
    c.fillRect(x, yt, w, h);
    c.fillStyle = 'rgba(255, 250, 235, .22)';
    c.fillRect(x, yt, w, Math.min(0.06, h * 0.1));
    c.fillRect(x, yt, Math.min(0.05, w * 0.1), h);
  }
  // Stone courses over a front face: staggered blocks with a lit top edge and a dark joint.
  function courses(c, x, y, w, h, row = 0.42, len = 0.75, seed = 1) {
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    let r = 0;
    for (let yy = y + h; yy > y - 0.01; yy -= row, r++) {
      const off = (r % 2) * len * 0.5;
      for (let xx = x - off; xx < x + w; xx += len) {
        const v = hash(seed * 31 + r * 7.3 + Math.round(xx * 10));
        c.fillStyle = v > 0.5 ? `rgba(255, 245, 225, ${((v - 0.5) * 0.22).toFixed(3)})` : `rgba(20, 12, 30, ${((0.5 - v) * 0.2).toFixed(3)})`;
        c.fillRect(xx, yy - row, len, row);
        c.fillStyle = 'rgba(255, 250, 235, .16)';
        c.fillRect(xx + 0.03, yy - row + 0.02, len - 0.06, 0.04);
        c.fillStyle = 'rgba(25, 15, 25, .32)';
        c.fillRect(xx, yy - row, 0.035, row);
      }
      c.fillStyle = 'rgba(25, 15, 25, .3)';
      c.fillRect(x, yy - 0.03, w, 0.04);
    }
    c.restore();
  }
  // A round stone tower: lit cylinder with brick rows, a crenellated ring and a cone roof.
  function roundTower(c, cx, top, rx, h, col, roof, roofH, seed = 1) {
    Fx.cylinder(c, cx, top, rx, h, col, { ry: rx * 0.28, cap: false });
    c.save();
    c.beginPath(); c.rect(cx - rx, top, rx * 2, h); c.clip();
    c.strokeStyle = 'rgba(30, 20, 30, .28)';
    c.lineWidth = 0.04;
    let r = 0;
    for (let y = top + h; y > top; y -= 0.45, r++) {
      c.beginPath(); c.ellipse(cx, y, rx, rx * 0.28, 0, 0, Math.PI); c.stroke();
      for (let a = (r % 2) * 0.35 + 0.2; a < Math.PI; a += 0.7) {
        const xx = cx + Math.cos(a) * rx;
        c.beginPath(); c.moveTo(xx, y + Math.sin(a) * rx * 0.28); c.lineTo(xx, y - 0.45 + Math.sin(a) * rx * 0.28); c.stroke();
      }
    }
    c.restore();
    // the ring of merlons
    const rr = rx * 1.14, ry = rr * 0.28, ty = top - 0.15;
    Fx.cylinder(c, cx, ty, rr, 0.55, shade(col, 0.04), { ry, cap: false });
    c.fillStyle = 'rgba(20, 12, 30, .3)';
    c.beginPath(); c.ellipse(cx, ty + 0.55, rr, ry, 0, 0, Math.PI); c.lineTo(cx - rr, ty + 0.62); c.ellipse(cx, ty + 0.68, rr * 0.98, ry, 0, Math.PI, 0, true); c.fill();
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.1 + i * 0.2), mx = cx - Math.cos(a) * rr * 0.86;
      box(c, mx - rr * 0.13, ty + Math.sin(a) * ry * 0.6, rr * 0.26, 0.45, 0.25, col);
    }
    if (roof) {
      const by = ty - 0.3, bw = rr * 1.12;
      const gr = c.createLinearGradient(cx - bw, 0, cx + bw, 0);
      gr.addColorStop(0, shade(roof, 0.35)); gr.addColorStop(0.35, roof); gr.addColorStop(1, shade(roof, -0.5));
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(cx - bw, by); c.lineTo(cx, by - roofH); c.lineTo(cx + bw, by); c.ellipse(cx, by, bw, bw * 0.28, 0, 0, Math.PI); c.fill();
      c.strokeStyle = 'rgba(20, 10, 30, .25)';
      c.lineWidth = 0.05;
      for (let k = 1; k < 4; k++) { const f = k / 4; c.beginPath(); c.ellipse(cx, by - roofH * (1 - f), bw * f, bw * 0.28 * f, 0, 0, Math.PI); c.stroke(); }
      c.fillStyle = shade(roof, -0.55);
      c.beginPath(); c.ellipse(cx, by, bw, bw * 0.28, 0, 0, Math.PI); c.lineTo(cx - bw, by + 0.06); c.ellipse(cx, by + 0.1, bw, bw * 0.28, 0, Math.PI, 0, true); c.fill();
      Fx.sphere(c, cx, by - roofH, 0.12, '#e8c25a', { gloss: false });
    }
  }
  // A waving flag on a pole whose foot is at (x, y): it flies towards `dir`.
  function flag(c, x, y, pole, w, col, dir, ph) {
    c.strokeStyle = '#5a3c22'; c.lineWidth = 0.09; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - pole); c.stroke();
    Fx.sphere(c, x, y - pole - 0.08, 0.1, '#e8c25a', { gloss: false });
    const top = y - pole + 0.05, hgt = w * 0.62, n = 6;
    const pt = (i, edge) => { const f = i / n, wv = Math.sin(time * 5 + ph - f * 3.2) * 0.14 * f * w; return [x + dir * f * w, top + edge * hgt + wv + f * 0.1 * w]; };
    c.beginPath();
    for (let i = 0; i <= n; i++) { const [px, py] = pt(i, 0); if (i) c.lineTo(px, py); else c.moveTo(px, py); }
    for (let i = n; i >= 0; i--) { const [px, py] = pt(i, i === n ? 0.5 : 1); c.lineTo(px, py); }
    c.closePath();
    const gr = c.createLinearGradient(x, 0, x + dir * w, 0);
    for (let i = 0; i <= 4; i++) gr.addColorStop(i / 4, shade(col, Math.sin(time * 5 + ph - i * 0.8) * 0.22));
    c.fillStyle = gr;
    c.fill();
  }
  const withMetres = (x, y, s, fn) => { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); fn(ctx); ctx.restore(); };

  // ── Backdrop: sky, clouds, mountains, hills (baked tiles, scrolled with parallax) ──
  let bgc = null;
  function backdrop() {
    const W = view.w, d = view.dpr, back = Math.round(cam.ground - cam.scale * BACK);
    const key = `${W}|${view.h}|${d}|${back}`;
    if (bgc && bgc.key === key) return bgc;
    const TW = Math.max(512, Math.ceil(W));
    const layer = (w, h, paint) => { const cv = makeCanvas(w * d, h * d); const c = cv.getContext('2d'); c.scale(d, d); paint(c, w, h); return cv; };
    const rnd = seeded(11);
    const wrap = (fn, x, w) => { for (const o of [-w, 0, w]) fn(x + o); };
    const sky = layer(W, back + 4, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#2c69c9'); gr.addColorStop(0.5, '#62a1e2'); gr.addColorStop(0.84, '#b4dcf0'); gr.addColorStop(1, '#f4ecd2');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      const R = Math.max(w, h) * 0.55, px = w * 0.13, py = h * 0.15;
      const sg = c.createRadialGradient(px, py, 0, px, py, R);
      sg.addColorStop(0, 'rgba(255, 248, 220, .95)'); sg.addColorStop(0.12, 'rgba(255, 240, 200, .5)'); sg.addColorStop(1, 'rgba(255, 240, 200, 0)');
      c.fillStyle = sg; c.fillRect(0, 0, w, h);
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const a0 = 0.25 + i * 0.22, a1 = a0 + 0.06 + (i % 2) * 0.04;
        c.fillStyle = 'rgba(255, 245, 215, .025)';
        const L = Math.min(R * 3, h * 1.2);
        c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a0) * L, py + Math.sin(a0) * L); c.lineTo(px + Math.cos(a1) * L, py + Math.sin(a1) * L); c.fill();
      }
      c.restore();
    });
    const ch = Math.round(back * 0.62);
    const clouds = layer(TW, ch, (c, w, h) => {
      for (let i = 0; i < 6; i++) {
        const cx = (i + rnd() * 0.7) / 6 * w, cw = Math.min(120, Math.max(32, back * (0.22 + rnd() * 0.26))), cy = Math.max(cw * 0.5 + 4, h * (0.18 + rnd() * 0.55)), puffs = [];
        for (let k = 0; k < 6; k++) puffs.push([(k / 5 - 0.5) * cw, -Math.sin((k / 5) * Math.PI) * cw * 0.22 - rnd() * 6, cw * (0.16 + rnd() * 0.1)]);
        wrap((x) => {
          c.beginPath();
          for (const [dx, dy, r] of puffs) { c.moveTo(x + dx + r, cy + dy); c.arc(x + dx, cy + dy, r, 0, TAU); }
          c.moveTo(x - cw * 0.55, cy - cw * 0.12); c.lineTo(x + cw * 0.55, cy - cw * 0.12); c.lineTo(x + cw * 0.55, cy + cw * 0.06); c.lineTo(x - cw * 0.55, cy + cw * 0.06); c.closePath();
          const gr = c.createLinearGradient(0, cy - cw * 0.45, 0, cy + cw * 0.08);
          gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#f4f8ff'); gr.addColorStop(1, '#c9d8ee');
          c.fillStyle = gr; c.fill('nonzero');
          c.fillStyle = 'rgba(255, 255, 255, .35)';
          for (const [dx, dy, r] of puffs) { c.beginPath(); c.arc(x + dx - r * 0.25, cy + dy - r * 0.3, r * 0.45, 0, TAU); c.fill(); }
        }, cx, w);
      }
    });
    const mountains = layer(TW, back + 4, (c, w, h) => {
      const base = h, peaks = [];
      for (let i = 0; i < 7; i++) {
        const hg = back * (0.2 + rnd() * 0.24) * (1 + 0.45 * Fx.clamp((back / W - 0.3) / 0.5, 0, 1));
        peaks.push({ x: (i + rnd() * 0.6) / 7 * w, hg, wl: hg * (1.1 + rnd() * 0.5), wr: hg * (1.2 + rnd() * 0.6) });
      }
      // a faint far ridge first
      c.fillStyle = '#b9c8e6';
      c.beginPath(); c.moveTo(0, base);
      const far = 1 + 0.6 * Fx.clamp((back / W - 0.3) / 0.5, 0, 1);
      for (let x = 0; x <= w; x += 8) c.lineTo(x, base - back * far * (0.16 + 0.05 * Math.sin(TAU * 3 * x / w + 1) + 0.03 * Math.sin(TAU * 7 * x / w)));
      c.lineTo(w, base); c.fill();
      peaks.sort((a, b) => b.hg - a.hg);
      for (const p of peaks) wrap((x) => {
        const top = base - p.hg, split = x + p.wr * 0.18;
        c.fillStyle = '#a3b3da';
        c.beginPath(); c.moveTo(x - p.wl, base); c.lineTo(x, top); c.lineTo(split, base); c.fill();
        c.fillStyle = '#7180b2';
        c.beginPath(); c.moveTo(split, base); c.lineTo(x, top); c.lineTo(x + p.wr, base); c.fill();
        const f = 0.3, sl = x - p.wl * f, sr = x + p.wr * f, sy = top + p.hg * f;
        c.fillStyle = '#f6f8ff';
        c.beginPath(); c.moveTo(x, top); c.lineTo(sl, sy);
        c.lineTo(sl + (x - sl) * 0.35, sy - p.hg * 0.05); c.lineTo(sl + (x - sl) * 0.6, sy + p.hg * 0.03); c.lineTo(x + p.wr * 0.06, sy - p.hg * 0.06);
        c.lineTo(x + p.wr * 0.1, sy); c.closePath(); c.fill();
        c.fillStyle = '#c4cdec';
        c.beginPath(); c.moveTo(x, top); c.lineTo(x + p.wr * 0.06, sy - p.hg * 0.06); c.lineTo(x + p.wr * 0.12, sy + p.hg * 0.02); c.lineTo(sr, sy - p.hg * 0.02); c.closePath(); c.fill();
      }, p.x, w);
      const hz = c.createLinearGradient(0, base - back * 0.32, 0, base);
      hz.addColorStop(0, 'rgba(214, 232, 242, 0)'); hz.addColorStop(1, 'rgba(226, 238, 240, .92)');
      c.fillStyle = hz; c.fillRect(0, base - back * 0.32, w, back * 0.32);
    });
    const hills = (amp, lift, top, bot, rim, treeCol, nTrees, treeH, round) => layer(TW, back + 4, (c, w, h) => {
      const base = h;
      const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
      const fy = (x) => base - back * (lift + amp * (0.55 + 0.25 * Math.sin(TAU * 2 * x / w + ph[0]) + 0.14 * Math.sin(TAU * 5 * x / w + ph[1]) + 0.06 * Math.sin(TAU * 11 * x / w + ph[2])));
      const gr = c.createLinearGradient(0, base - back * (lift + amp), 0, base);
      gr.addColorStop(0, top); gr.addColorStop(1, bot);
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(0, base);
      for (let x = 0; x <= w; x += 4) c.lineTo(x, fy(x));
      c.lineTo(w, base); c.fill();
      c.strokeStyle = rim; c.lineWidth = 2;
      c.beginPath();
      for (let x = 0; x <= w; x += 4) { if (x) c.lineTo(x, fy(x) + 1.5); else c.moveTo(x, fy(x) + 1.5); }
      c.stroke();
      for (let i = 0; i < nTrees; i++) {
        const tx = (i + rnd()) / nTrees * w, th = treeH * (0.7 + rnd() * 0.6);
        if (rnd() < 0.35) continue;
        wrap((x) => {
          const y = fy(((x % w) + w) % w) + th * 0.25;
          if (round) {
            c.fillStyle = shade(treeCol, -0.2); c.beginPath(); c.arc(x + th * 0.08, y - th * 0.45, th * 0.42, 0, TAU); c.fill();
            c.fillStyle = treeCol; c.beginPath(); c.arc(x, y - th * 0.5, th * 0.38, 0, TAU); c.fill();
            c.fillStyle = shade(treeCol, 0.25); c.beginPath(); c.arc(x - th * 0.12, y - th * 0.62, th * 0.17, 0, TAU); c.fill();
          } else {
            c.fillStyle = shade(treeCol, 0.18);
            c.beginPath(); c.moveTo(x - th * 0.32, y); c.lineTo(x, y - th); c.lineTo(x, y); c.fill();
            c.fillStyle = shade(treeCol, -0.18);
            c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - th); c.lineTo(x + th * 0.32, y); c.fill();
          }
        }, tx, w);
      }
    });
    const mid = hills(0.2, 0.0, '#8cbf73', '#6fa463', '#b4dc93', '#5b9460', 46, Math.max(8, back * 0.05), false);
    const near = hills(0.1, 0.0, '#69a650', '#4f8d40', '#97cc6e', '#3f7d36', 40, Math.max(9, back * 0.055), true);
    bgc = { key, TW, back, sky, layers: [{ cv: clouds, k: 0.03, drift: 4, y: 0 }, { cv: mountains, k: 0.08, drift: 0, y: null }, { cv: mid, k: 0.24, drift: 0, y: null }, { cv: near, k: 0.5, drift: 0, y: null }] };
    return bgc;
  }
  function drawBackdrop() {
    const B = backdrop(), W = view.w;
    ctx.drawImage(B.sky, 0, 0, W, B.back + 4);
    for (const L of B.layers) {
      if (L.k > 0.05 && !B.sunDone) {
        B.sunDone = true;
        const R = Math.max(W, B.back) * 0.55, px = W * 0.13, py = B.back * 0.15;
        Fx.glow(ctx, px, py, R * 0.22, '#fff2c8', 0.75);
        ctx.fillStyle = '#fffdf2'; ctx.beginPath(); ctx.arc(px, py, Math.max(9, R * 0.055), 0, TAU); ctx.fill();
      }
      const lw = L.cv.width / view.dpr, lh = L.cv.height / view.dpr;
      let off = -((cam.x0 * cam.scale * L.k + time * L.drift) % B.TW);
      if (off > 0) off -= B.TW;
      const y = L.y == null ? B.back + 4 - lh : L.y;
      for (let x = off; x < W; x += B.TW) ctx.drawImage(L.cv, x, y, lw, lh);
    }
    B.sunDone = false;
  }

  // ── Ground: the lit top surface, the soil face and the chasms, baked in chunks ──
  let chunks = { key: '', map: new Map() };
  function tuft(c, x, y, z, col) {
    c.strokeStyle = col;
    c.lineWidth = Math.max(0.8, z * 0.2);
    c.beginPath();
    c.moveTo(x - z * 0.3, y); c.quadraticCurveTo(x - z * 0.3, y - z * 0.6, x - z * 0.65, y - z);
    c.moveTo(x, y); c.lineTo(x + z * 0.05, y - z * 1.2);
    c.moveTo(x + z * 0.3, y); c.quadraticCurveTo(x + z * 0.35, y - z * 0.6, x + z * 0.7, y - z * 0.85);
    c.stroke();
  }
  function paintGround(c, X0, X1, W) {
    const s = cam.scale, G = cam.ground, back = G - s * BACK, front = G + s * FRONT, H = view.h;
    c.lineCap = 'round';
    // the top surface
    let gr = c.createLinearGradient(0, back, 0, front);
    gr.addColorStop(0, '#5a963b'); gr.addColorStop(0.55, '#79b448'); gr.addColorStop(1, '#93c957');
    c.fillStyle = gr; c.fillRect(X0, back, X1 - X0, front - back);
    // the trodden road along the line
    const p0 = G - s * 0.32, p1 = G + s * 0.4;
    gr = c.createLinearGradient(0, p0, 0, p1);
    gr.addColorStop(0, '#b08853'); gr.addColorStop(0.5, '#cfaa70'); gr.addColorStop(1, '#bf9760');
    c.fillStyle = gr; c.fillRect(X0, p0, X1 - X0, p1 - p0);
    c.fillStyle = 'rgba(110, 75, 40, .28)';
    c.fillRect(X0, G - s * 0.12, X1 - X0, Math.max(1, s * 0.05));
    c.fillRect(X0, G + s * 0.2, X1 - X0, Math.max(1, s * 0.05));
    // the soil face under the front lip
    gr = c.createLinearGradient(0, front, 0, H);
    gr.addColorStop(0, '#8d5d35'); gr.addColorStop(0.35, '#6c4427'); gr.addColorStop(1, '#3a2315');
    c.fillStyle = gr; c.fillRect(X0, front, X1 - X0, H - front);
    for (let j = 0; j < 4; j++) {
      const y = front + (j + 0.7) * (H - front) / 4.4;
      c.strokeStyle = 'rgba(30, 15, 8, .3)'; c.lineWidth = Math.max(1, s * 0.12);
      c.beginPath();
      for (let x = X0 - 4; x <= X1 + 4; x += 6) { const yy = y + Math.sin(x / (s * 2.7) + j * 1.7) * s * 0.18; if (x === X0 - 4) c.moveTo(x, yy); else c.lineTo(x, yy); }
      c.stroke();
      c.strokeStyle = 'rgba(255, 215, 160, .07)'; c.lineWidth = Math.max(1, s * 0.06);
      c.beginPath();
      for (let x = X0 - 4; x <= X1 + 4; x += 6) { const yy = y - s * 0.14 + Math.sin(x / (s * 2.7) + j * 1.7) * s * 0.18; if (x === X0 - 4) c.moveTo(x, yy); else c.lineTo(x, yy); }
      c.stroke();
    }
    const m0 = Math.floor(X0 / s) - 3, m1 = Math.ceil(X1 / s) + 3;
    for (let m = m0; m <= m1; m++) {
      // stones in the soil
      if (hash(m * 3.17) < 0.4) {
        const x = (m + hash(m * 5.1)) * s, y = front + (0.25 + 0.65 * hash(m * 7.7)) * (H - front), r = s * (0.14 + 0.22 * hash(m * 9.3));
        c.fillStyle = 'rgba(20, 10, 5, .35)'; c.beginPath(); c.ellipse(x + r * 0.15, y + r * 0.2, r * 1.1, r * 0.8, 0, 0, TAU); c.fill();
        c.fillStyle = '#857468'; c.beginPath(); c.ellipse(x, y, r * 1.1, r * 0.78, 0, 0, TAU); c.fill();
        c.fillStyle = '#ab9c8e'; c.beginPath(); c.ellipse(x - r * 0.25, y - r * 0.25, r * 0.6, r * 0.38, 0, 0, TAU); c.fill();
      }
      // tufts, flowers and pebbles on top
      for (let k = 0; k < 3; k++) {
        const hv = hash(m * 13.1 + k * 3.7), x = (m + hash(m * 2.3 + k)) * s;
        let y = back + s * 0.1 + hash(m * 4.9 + k * 1.3) * (front - back - s * 0.15);
        if (y > p0 - s * 0.05 && y < p1 + s * 0.05) { if (hv < 0.5) continue; y = hv < 0.75 ? p0 : p1 + s * 0.06; }
        const z = s * (0.25 + 0.2 * hv);
        tuft(c, x + 0.6, y, z, '#3d7a2c');
        tuft(c, x, y, z * 0.8, '#a8d865');
        if (hv > 0.86) {
          c.fillStyle = ['#ffffff', '#ffd84a', '#ff8fb8'][m % 3 < 0 ? 0 : m % 3];
          c.beginPath(); c.arc(x + z * 0.3, y - z * 0.9, Math.max(1, s * 0.07), 0, TAU); c.fill();
        }
      }
      if (hash(m * 6.6) < 0.35) {
        const x = (m + hash(m * 8.8)) * s, y = G + (hash(m * 1.9) - 0.4) * s * 0.5, r = s * 0.08;
        c.fillStyle = '#8f7f6a'; c.beginPath(); c.ellipse(x, y, r * 1.4, r, 0, 0, TAU); c.fill();
        c.fillStyle = '#d9cdb6'; c.beginPath(); c.ellipse(x - r * 0.3, y - r * 0.3, r * 0.6, r * 0.4, 0, 0, TAU); c.fill();
      }
    }
    // the front lip: a lit edge, grass hanging over, and the shadow it throws on the soil
    gr = c.createLinearGradient(0, front, 0, front + s * 0.7);
    gr.addColorStop(0, 'rgba(20, 8, 0, .45)'); gr.addColorStop(1, 'rgba(20, 8, 0, 0)');
    c.fillStyle = gr; c.fillRect(X0, front, X1 - X0, s * 0.7);
    c.fillStyle = '#4c8a30';
    const bump = s * 0.32;
    c.beginPath();
    for (let x = Math.floor(X0 / bump) * bump - bump; x <= X1 + bump; x += bump) {
      const r = bump * (0.45 + 0.3 * hash(Math.round(x / bump) * 1.7));
      c.moveTo(x + r, front); c.arc(x, front, r, 0, Math.PI);
    }
    c.fill();
    c.fillStyle = '#b9e277';
    c.fillRect(X0, front - Math.max(1, s * 0.07), X1 - X0, Math.max(1, s * 0.08));
    // the back edge: grass rising against the hills
    for (let m = m0; m <= m1; m++) for (let k = 0; k < 2; k++) tuft(c, (m + hash(m * 3.3 + k * 9)) * s, back + s * 0.12, s * (0.3 + 0.25 * hash(m + k)), '#4a8733');
    for (const ch of W.chasms) {
      const a = ch.x0 * s, b = ch.x1 * s;
      if (b < X0 - s * 2 || a > X1 + s * 2) continue;
      paintChasm(c, a, b, back, front, H, s);
    }
  }
  function paintChasm(c, a, b, back, front, H, s) {
    const w = b - a;
    let gr = c.createLinearGradient(0, back, 0, H);
    gr.addColorStop(0, '#5b4635'); gr.addColorStop(0.18, '#2f2219'); gr.addColorStop(0.6, '#120c08'); gr.addColorStop(1, '#040302');
    c.fillStyle = gr;
    c.fillRect(a, back - 1, w, H - back + 2);
    const wall = (x0, sign, top, bottom) => {
      c.beginPath(); c.moveTo(x0, back - 1);
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const f = i / n, y = back + (H - back) * f;
        const jag = (hash(x0 * 0.37 + i * 3.1) - 0.5) * s * 0.35;
        c.lineTo(x0 + sign * (w * (0.06 + 0.2 * f) + jag + (i % 2) * s * 0.12), y);
      }
      c.lineTo(x0, H + 1); c.closePath();
      const g2 = c.createLinearGradient(0, back, 0, H);
      g2.addColorStop(0, top); g2.addColorStop(1, bottom);
      c.fillStyle = g2; c.fill();
      c.strokeStyle = 'rgba(0, 0, 0, .3)'; c.lineWidth = Math.max(1, s * 0.06);
      for (let i = 1; i < 6; i++) {
        const y = back + (H - back) * i / 6.5;
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + sign * w * (0.06 + 0.2 * i / 6.5) * 0.9, y + s * 0.15); c.stroke();
      }
    };
    wall(a, 1, '#4a382b', '#0c0806');          // the left cliff faces away from the light
    wall(b, -1, '#a37c58', '#1d140d');         // the right cliff catches it
    // mist far down and the dark falloff
    c.fillStyle = 'rgba(170, 190, 225, .1)';
    for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(a + w * (0.3 + i * 0.2), H - s * (0.6 + i * 0.3), w * 0.3, s * 0.35, 0, 0, TAU); c.fill(); }
    gr = c.createLinearGradient(0, front, 0, H);
    gr.addColorStop(0, 'rgba(0, 0, 0, 0)'); gr.addColorStop(1, 'rgba(0, 0, 0, .55)');
    c.fillStyle = gr; c.fillRect(a, front, w, H - front);
    // rims: grass and roots hanging over both edges
    for (const [x0, sign] of [[a, 1], [b, -1]]) {
      c.fillStyle = '#4c8a30';
      c.beginPath(); c.moveTo(x0, back);
      for (let i = 0; i <= 6; i++) { const y = back + (front - back) * i / 6; c.lineTo(x0 + sign * s * (0.1 + 0.18 * hash(x0 + i)), y + s * 0.05); c.lineTo(x0, y + s * 0.12); }
      c.lineTo(x0, front + s * 0.2); c.fill();
      c.strokeStyle = 'rgba(70, 45, 25, .8)'; c.lineWidth = Math.max(1, s * 0.05);
      for (let i = 0; i < 3; i++) {
        const y = front + s * (0.1 + i * 0.5);
        c.beginPath(); c.moveTo(x0, y); c.quadraticCurveTo(x0 + sign * s * 0.5, y + s * 0.5, x0 + sign * s * (0.2 + 0.3 * hash(x0 * 2 + i)), y + s * (1 + hash(x0 + i * 5))); c.stroke();
      }
    }
  }
  function drawTerrain(W) {
    const s = cam.scale, d = view.dpr;
    const key = `${view.w}|${view.h}|${d}|${s}|${cam.ground}|${W.L}|${W.chasms.map((c) => c.x0 + '-' + c.x1).join(',')}`;
    if (chunks.key !== key) chunks = { key, map: new Map() };
    const top = Math.floor(cam.ground - s * (BACK + 0.7)), H = view.h - top;
    const X = cam.x0 * s;
    const i0 = Math.floor(X / CW), i1 = Math.floor((X + view.w) / CW);
    for (let i = i0; i <= i1; i++) {
      let cv = chunks.map.get(i);
      if (!cv) {
        cv = makeCanvas(CW * d, H * d);
        const c = cv.getContext('2d');
        c.setTransform(d, 0, 0, d, -i * CW * d, -top * d);
        paintGround(c, i * CW, (i + 1) * CW, W);
        chunks.map.set(i, cv);
      }
      ctx.drawImage(cv, Math.round((i * CW - X) * d) / d, top, CW, H);
    }
  }

  // ── Bridges: plank decks, posts and sagging ropes (the front rope is drawn over the figures) ──
  function drawBridges(W, front) {
    const s = cam.scale, G = cam.ground;
    for (const c of W.chasms) {
      const done = c.bridged ? c.segments : c.built;
      const partial = !c.bridged && c.busy ? c.work / F.BUILD.bridge.time : 0;
      if (!done && !partial) continue;
      const a = sx(c.x0), b = sx(c.x1);
      if (b < -20 || a > view.w + 20) continue;
      const pw = (F.CELL * s) / 8, y0 = G - s * 0.5, y1 = G + s * 0.5, th = s * 0.22;
      const laid = done * 8 + Math.floor(partial * 8);
      const end = a + Math.min(c.segments * 8, laid + (partial ? 1 : 0)) * pw;
      const ropeY = (yb) => yb - s * 1.15;
      const rope = (yb, alpha) => {
        const ry = ropeY(yb), right = c.bridged ? b : end;
        ctx.strokeStyle = withAlpha('#7b5a36', alpha); ctx.lineWidth = Math.max(1, s * 0.07);
        ctx.beginPath(); ctx.moveTo(a, ry); ctx.quadraticCurveTo((a + right) / 2, ry + s * 0.9, right, ry); ctx.stroke();
        ctx.lineWidth = Math.max(0.6, s * 0.035);
        for (let k = 1; k < c.segments * 2; k++) {
          const x = a + k * pw * 4;
          if (x > right) break;
          const f = (x - a) / Math.max(1, right - a), yy = ry + s * 0.9 * 2 * f * (1 - f);
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yb); ctx.stroke();
        }
      };
      const post = (x, yb) => {
        Fx.cylinder(ctx, x, ropeY(yb) - s * 0.1, Math.max(1.5, s * 0.11), yb - ropeY(yb) + s * 0.1, '#8a5c32', { ry: s * 0.04 });
      };
      if (!front) {
        Fx.shadow(ctx, (a + end) / 2, y1 + s * 1.4, (end - a) / 2, s * 0.6, 0.5);
        // the beam under the deck
        const gb = ctx.createLinearGradient(0, y1, 0, y1 + th * 1.6);
        gb.addColorStop(0, '#6b4424'); gb.addColorStop(1, '#3a2312');
        ctx.fillStyle = gb; ctx.fillRect(a, y1 + th * 0.5, end - a, th * 1.1);
        post(a, y0); if (c.bridged) post(b, y0);
        rope(y0, 0.9);
        for (let k = 0; k < laid + (partial ? 1 : 0) && k < c.segments * 8; k++) {
          let x = a + k * pw, dy = 0, al = 1;
          if (k === laid) { const f = (partial * 8) % 1; dy = -(1 - ease.outCubic(f)) * s * 1.6; al = f; }
          ctx.globalAlpha = al;
          const tone = hash(k * 1.9 + c.x0) * 0.12 - 0.06;
          ctx.fillStyle = shade(k % 2 ? '#c38e57' : '#b47f49', tone);
          ctx.fillRect(x + 0.5, y0 + dy, pw - 1, y1 - y0);
          ctx.fillStyle = 'rgba(255, 240, 210, .25)'; ctx.fillRect(x + 0.5, y0 + dy, Math.max(1, pw * 0.18), y1 - y0);
          ctx.fillStyle = '#6e4322'; ctx.fillRect(x + 0.5, y1 + dy, pw - 1, th);
          ctx.fillStyle = 'rgba(40, 20, 5, .5)'; ctx.fillRect(x + pw * 0.45, G - s * 0.32 + dy, Math.max(1, s * 0.05), Math.max(1, s * 0.05));
          ctx.globalAlpha = 1;
        }
      } else {
        post(a, y1); if (c.bridged) post(b, y1);
        rope(y1, 0.95);
      }
    }
  }

  // ── Resource nodes (baked sprites per scale) ──
  const spriteCache = { key: '', map: new Map() };
  function sprite(name, x0, y0, x1, y1, paint) {
    const s = cam.scale, d = view.dpr, sk = `${s}|${d}`;
    if (spriteCache.key !== sk) { spriteCache.key = sk; spriteCache.map.clear(); }
    let sp = spriteCache.map.get(name);
    if (!sp) {
      const cv = makeCanvas((x1 - x0) * s * d, (y1 - y0) * s * d);
      const c = cv.getContext('2d');
      c.setTransform(s * d, 0, 0, s * d, -x0 * s * d, -y0 * s * d);
      paint(c);
      sp = { cv, x0, y0, w: x1 - x0, h: y1 - y0 };
      spriteCache.map.set(name, sp);
    }
    return sp;
  }
  function blit(sp, x, y, skew = 0) {
    const s = cam.scale;
    if (skew) { ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, skew, 1, 0, 0); ctx.drawImage(sp.cv, sp.x0 * s, sp.y0 * s, sp.w * s, sp.h * s); ctx.restore(); }
    else ctx.drawImage(sp.cv, x + sp.x0 * s, y + sp.y0 * s, sp.w * s, sp.h * s);
  }
  function conifer(c, x, h, col) {
    Fx.shadow(c, x + 0.35, 0.08, 1.0, 0.28, 0.4);
    const tg = c.createLinearGradient(x - 0.14, 0, x + 0.14, 0);
    tg.addColorStop(0, '#9a6a3e'); tg.addColorStop(1, '#4e3018');
    c.fillStyle = tg; c.fillRect(x - 0.14, -h * 0.32, 0.28, h * 0.32 + 0.05);
    for (let i = 0; i < 3; i++) {
      const by = -h * (0.22 + i * 0.24), wi = (1.05 - i * 0.24) * (h / 4.6), th = h * (0.42 - i * 0.04);
      c.fillStyle = shade(col, -0.45);
      c.beginPath(); c.moveTo(x - wi, by); c.quadraticCurveTo(x, by + 0.3, x + wi, by); c.lineTo(x, by - th); c.closePath(); c.fill();
      c.fillStyle = shade(col, 0.18);
      c.beginPath(); c.moveTo(x - wi, by - 0.04); c.quadraticCurveTo(x - wi * 0.4, by + 0.12, x + 0.05, by + 0.1); c.lineTo(x, by - th); c.closePath(); c.fill();
      c.fillStyle = shade(col, -0.22);
      c.beginPath(); c.moveTo(x + 0.05, by + 0.1); c.quadraticCurveTo(x + wi * 0.5, by + 0.1, x + wi, by - 0.04); c.lineTo(x, by - th); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255, 255, 220, .25)';
      c.beginPath(); c.moveTo(x - wi * 0.55, by - th * 0.35); c.lineTo(x - 0.02, by - th * 0.95); c.lineTo(x - wi * 0.25, by - th * 0.3); c.fill();
    }
  }
  function rock(c, x, y, r, col, seed) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + (i / 7) * Math.PI, rr = r * (0.78 + 0.3 * hash(seed + i * 1.7));
      pts.push([x + Math.cos(a) * rr * 1.15, y + Math.min(0, Math.sin(a) * rr * 0.95)]);
    }
    Fx.shadow(c, x + r * 0.3, y + 0.05, r * 1.5, r * 0.35, 0.45);
    c.fillStyle = shade(col, -0.35);
    c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath(); c.fill();
    const cx = x - r * 0.1, cy = y - r * 0.45;
    for (let i = 0; i < 7; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const lit = i < 3 ? 0.3 - i * 0.08 : i < 5 ? 0 : -0.2;
      c.fillStyle = shade(col, lit);
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(ax, ay); c.lineTo(bx, by); c.closePath(); c.fill();
    }
    c.fillStyle = shade(col, -0.25);
    c.beginPath(); c.moveTo(pts[0][0], y); c.lineTo(cx, cy); c.lineTo(pts[7][0], y); c.closePath(); c.globalAlpha = 0.5; c.fill(); c.globalAlpha = 1;
  }
  function artWood(c) {
    conifer(c, -1.3, 4.4, '#3c8c46');
    conifer(c, 1.5, 3.9, '#47984a');
    conifer(c, 0.25, 5.3, '#358342');
    c.fillStyle = '#7a4e2a';
    for (const [x, y] of [[1.8, 0.2], [2.25, 0.2]]) { Fx.cylinder(c, x, y - 0.32, 0.17, 0.32, '#8a5a30', { ry: 0.08 }); }
  }
  function artStone(c) {
    rock(c, -0.7, 0.1, 1.15, '#9ea3ab', 3);
    rock(c, 0.75, 0.15, 0.85, '#aeb2b8', 7);
    rock(c, 1.6, 0.25, 0.35, '#9ca0a8', 11);
    box(c, -1.95, 0.4, 0.62, 0.45, 0.5, '#c4c7cc');
    box(c, -1.35, 0.45, 0.55, 0.38, 0.5, '#b5b8be');
    c.strokeStyle = '#6b4a2a'; c.lineWidth = 0.08; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0.3, -0.35); c.lineTo(-0.1, -1.05); c.stroke();
    c.strokeStyle = '#8a929c'; c.lineWidth = 0.1;
    c.beginPath(); c.moveTo(-0.45, -0.85); c.quadraticCurveTo(-0.1, -1.15, 0.25, -1.0); c.stroke();
  }
  function artMetal(c) {
    Fx.shadow(c, 0.2, 0.1, 2.4, 0.5, 0.45);
    const gr = c.createLinearGradient(-2.1, -2, 1.6, 0.2);
    gr.addColorStop(0, '#9a8a78'); gr.addColorStop(0.5, '#6e5f52'); gr.addColorStop(1, '#3f342c');
    c.fillStyle = gr;
    c.beginPath(); c.moveTo(-2.2, 0.15); c.quadraticCurveTo(-1.8, -1.6, -0.6, -2.1); c.quadraticCurveTo(0.6, -2.4, 1.4, -1.5); c.quadraticCurveTo(2.1, -0.7, 2.2, 0.15); c.closePath(); c.fill();
    for (const [x, y, r] of [[-1.4, -0.5, 0.35], [1.4, -0.4, 0.3], [-0.4, -1.8, 0.28], [0.9, -1.7, 0.22]]) rock(c, x, y, r, '#857669', x * 7);
    for (const [x, y] of [[-1.1, -1.2], [1.0, -1.0], [-0.2, -1.9], [1.6, -0.6], [-1.7, -0.25]]) {
      c.fillStyle = '#2b3440'; c.beginPath(); c.arc(x, y, 0.1, 0, TAU); c.fill();
      c.fillStyle = '#bfe6ff'; c.beginPath(); c.arc(x - 0.03, y - 0.03, 0.045, 0, TAU); c.fill();
    }
    // the shaft: a timber frame round a dark mouth
    const tg = c.createRadialGradient(0, -0.5, 0.1, 0, -0.5, 0.9);
    tg.addColorStop(0, '#000000'); tg.addColorStop(1, '#2a1e16');
    c.fillStyle = tg;
    c.beginPath(); c.moveTo(-0.62, 0.12); c.lineTo(-0.62, -0.75); c.quadraticCurveTo(0, -1.25, 0.62, -0.75); c.lineTo(0.62, 0.12); c.closePath(); c.fill();
    box(c, -0.82, 0.15, 0.2, 1.2, 0.2, '#8a5c32');
    box(c, 0.62, 0.15, 0.2, 1.2, 0.2, '#8a5c32');
    box(c, -0.95, -1.0, 1.9, 0.22, 0.25, '#9a6a3a');
    c.strokeStyle = '#5b5f66'; c.lineWidth = 0.06;
    c.beginPath(); c.moveTo(-0.3, 0.05); c.lineTo(-0.55, 0.5); c.moveTo(0.3, 0.05); c.lineTo(0.55, 0.5); c.stroke();
    // a cart of ore
    Fx.shadow(c, 1.55, 0.35, 0.6, 0.15, 0.5);
    box(c, 1.05, 0.2, 0.9, 0.5, 0.35, '#6a6f78');
    for (const [x, y] of [[1.25, -0.35], [1.5, -0.42], [1.75, -0.33]]) { Fx.sphere(c, x, y, 0.13, '#4a5462', { gloss: false }); c.fillStyle = '#9fd8ff'; c.fillRect(x - 0.04, y - 0.06, 0.05, 0.05); }
    for (const x of [1.2, 1.8]) { c.fillStyle = '#2a2a30'; c.beginPath(); c.arc(x, 0.22, 0.12, 0, TAU); c.fill(); }
  }
  function drawNodes(W) {
    const s = cam.scale, G = cam.ground;
    for (const n of W.nodes) {
      const x = sx(n.x);
      if (x < -s * 4 || x > view.w + s * 4) continue;
      const y = G - s * 0.35;
      if (n.res === 'wood') blit(sprite('wood', -3, -6.6, 3, 1, artWood), x, y, Math.sin(time * 1.3 + n.x) * 0.025);
      else if (n.res === 'stone') blit(sprite('stone', -2.6, -2.6, 2.4, 1, artStone), x, y);
      else {
        blit(sprite('metal', -2.6, -2.8, 2.6, 1, artMetal), x, y);
        Fx.glow(ctx, x + s * 0.9, y - s * 0.9, s * (0.7 + 0.08 * Math.sin(time * 7 + n.x)), '#ffb040', 0.55);
        ctx.fillStyle = '#ffe2a0'; ctx.beginPath(); ctx.arc(x + s * 0.9, y - s * 0.9, Math.max(1, s * 0.08), 0, TAU); ctx.fill();
      }
    }
  }

  // ── Keep and fortress (baked per damage state; flags, fire and smoke are live) ──
  function crack(c, x, y, len, seed) {
    c.strokeStyle = 'rgba(25, 12, 15, .75)'; c.lineWidth = 0.07; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(x, y);
    let px = x, py = y;
    for (let i = 1; i <= 4; i++) { px += (hash(seed + i) - 0.5) * 0.6; py += len / 4; c.lineTo(px, py); }
    c.stroke();
    c.strokeStyle = 'rgba(255, 245, 225, .2)'; c.lineWidth = 0.03;
    c.beginPath(); c.moveTo(x + 0.06, y); px = x + 0.06; py = y;
    for (let i = 1; i <= 4; i++) { px += (hash(seed + i) - 0.5) * 0.6; py += len / 4; c.lineTo(px + 0.05, py); }
    c.stroke();
  }
  function gate(c, x, w, h, door) {
    const r = w / 2, y = 0.15;
    c.fillStyle = shade('#c9c2b4', 0.1);
    c.beginPath(); c.moveTo(x - r - 0.2, y); c.lineTo(x - r - 0.2, y - h + r); c.arc(x, y - h + r, r + 0.2, Math.PI, 0); c.lineTo(x + r + 0.2, y); c.fill();
    c.strokeStyle = 'rgba(30, 20, 20, .4)'; c.lineWidth = 0.04;
    for (let i = 0; i <= 6; i++) { const a = Math.PI + i * Math.PI / 6; c.beginPath(); c.moveTo(x + Math.cos(a) * r, y - h + r + Math.sin(a) * r); c.lineTo(x + Math.cos(a) * (r + 0.2), y - h + r + Math.sin(a) * (r + 0.2)); c.stroke(); }
    const gr = c.createLinearGradient(0, y - h, 0, y);
    gr.addColorStop(0, '#0d0907'); gr.addColorStop(1, '#2a1c12');
    c.fillStyle = gr;
    c.beginPath(); c.moveTo(x - r, y); c.lineTo(x - r, y - h + r); c.arc(x, y - h + r, r, Math.PI, 0); c.lineTo(x + r, y); c.fill();
    c.fillStyle = door;
    c.fillRect(x - r * 0.92, y - h * 0.62, r * 1.84, h * 0.62);
    c.fillStyle = 'rgba(0, 0, 0, .3)';
    for (let k = 1; k < 5; k++) c.fillRect(x - r * 0.92 + k * r * 0.368, y - h * 0.62, 0.04, h * 0.62);
    c.strokeStyle = '#3d3a40'; c.lineWidth = 0.07;
    for (let k = 0; k < 5; k++) { const xx = x - r + (k + 0.5) * w / 5; c.beginPath(); c.moveTo(xx, y - h + r * 0.4); c.lineTo(xx, y - h * 0.62); c.stroke(); }
    c.beginPath(); c.moveTo(x - r, y - h * 0.8); c.lineTo(x + r, y - h * 0.8); c.stroke();
  }
  function pennant(c, x, y, w, h, col, mark) {
    c.fillStyle = shade(col, -0.45); c.fillRect(x - w / 2 - 0.08, y - 0.08, w + 0.16, 0.12);
    const gr = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    gr.addColorStop(0, shade(col, 0.25)); gr.addColorStop(0.6, col); gr.addColorStop(1, shade(col, -0.35));
    c.fillStyle = gr;
    c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.lineTo(x, y + h - w * 0.35); c.lineTo(x - w / 2, y + h); c.closePath(); c.fill();
    c.fillStyle = mark;
    c.beginPath(); c.arc(x, y + h * 0.42, w * 0.24, 0, TAU); c.fill();
    c.fillStyle = shade(col, -0.2);
    c.beginPath(); c.arc(x, y + h * 0.42, w * 0.12, 0, TAU); c.fill();
  }
  function artKeep(c, dmg) {
    Fx.shadow(c, 2.6, 0.25, 5.4, 0.9, 0.5);
    const st = '#c2bbad', roof = '#3b6fd4';
    roundTower(c, 0.3, -6.0, 0.85, 6.15, st, roof, 2.0, 2);
    box(c, -0.3, 0.2, 5.2, 4.3, 1.0, st);
    courses(c, -0.3, -4.1, 5.2, 4.3, 0.42, 0.75, 5);
    for (let x = -0.3; x < 4.8; x += 0.85) box(c, x, -4.05, 0.5, 0.5, 1.0, st);
    gate(c, 2.2, 1.6, 2.5, '#7a4e2a');
    pennant(c, 0.95, -3.6, 0.7, 1.7, '#3a66c8', '#f1cf5a');
    pennant(c, 3.45, -3.6, 0.7, 1.7, '#3a66c8', '#f1cf5a');
    roundTower(c, 4.85, -7.6, 1.2, 7.8, st, roof, 2.8, 4);
    for (const [x, y] of [[4.85, -5.8], [4.85, -3.6]]) {
      c.fillStyle = '#2a1c12'; Fx.rrect(c, x - 0.12, y, 0.24, 0.6, 0.12); c.fill();
      c.fillStyle = 'rgba(255, 200, 110, .8)'; Fx.rrect(c, x - 0.07, y + 0.08, 0.14, 0.4, 0.07); c.fill();
    }
    c.fillStyle = 'rgba(70, 105, 50, .4)';
    for (let x = -0.3; x < 4.9; x += 0.25) { const hh = 0.15 + hash(x * 3) * 0.35; c.beginPath(); c.ellipse(x + 0.12, 0.2, 0.16, hh, 0, Math.PI, 0); c.fill(); }
    keepDamage(c, dmg, [[0.9, -3.9], [3.6, -3.3], [5.1, -6.5]], 0.6, 3.8);
  }
  function keepDamage(c, dmg, spots, hx, hy) {
    if (dmg >= 1) {
      crack(c, spots[0][0], spots[0][1], 1.8, 3);
      crack(c, spots[1][0], spots[1][1], 1.4, 9);
      const sg = c.createRadialGradient(spots[2][0], spots[2][1], 0, spots[2][0], spots[2][1], 1.1);
      sg.addColorStop(0, 'rgba(20, 10, 10, .55)'); sg.addColorStop(1, 'rgba(20, 10, 10, 0)');
      c.fillStyle = sg; c.fillRect(spots[2][0] - 1.2, spots[2][1] - 1.2, 2.4, 2.4);
    }
    if (dmg >= 2) {
      crack(c, spots[2][0], spots[2][1], 2.2, 17);
      c.fillStyle = '#1a1210';
      c.beginPath(); c.moveTo(hx - 0.5, -hy); c.lineTo(hx - 0.1, -hy - 0.5); c.lineTo(hx + 0.6, -hy - 0.3); c.lineTo(hx + 0.7, -hy + 0.4); c.lineTo(hx, -hy + 0.6); c.closePath(); c.fill();
      for (let i = 0; i < 6; i++) rock(c, hx - 1 + i * 0.4, 0.3, 0.18 + hash(i) * 0.15, '#a49d90', i * 3);
    }
  }
  function artFort(c, dmg, towers) {
    Fx.shadow(c, 4.2, 0.25, 6, 0.95, 0.5);
    const st = '#7d6f78', roof = '#c63a2c';
    const turrets = [[0.5, -6.8, 0.75, 2.0], [3.5, -6.3, 0.65, 1.8], [7.9, -7.3, 0.62, 1.9]];
    for (let k = 0; k < Math.min(3, towers); k++) { const [x, top, rx, rh] = turrets[k]; if (k !== 2) roundTower(c, x, top, rx, -top + 0.15, st, roof, rh, 20 + k); }
    box(c, -0.1, 0.2, 8.1, 5.0, 1.0, st);
    courses(c, -0.1, -4.8, 8.1, 5.0, 0.45, 0.85, 9);
    c.fillStyle = '#3a3036';
    for (let x = 0; x < 8; x += 0.55) { c.beginPath(); c.moveTo(x, -4.8); c.lineTo(x + 0.18, -5.45); c.lineTo(x + 0.36, -4.8); c.fill(); }
    c.fillStyle = 'rgba(255, 255, 255, .25)';
    for (let x = 0; x < 8; x += 0.55) { c.beginPath(); c.moveTo(x, -4.8); c.lineTo(x + 0.18, -5.45); c.lineTo(x + 0.12, -4.8); c.fill(); }
    gate(c, 1.6, 1.7, 2.7, '#4a2e1c');
    c.fillStyle = '#c9ccd2';
    for (let k = 0; k < 5; k++) { const x = 0.75 + k * 0.34; c.beginPath(); c.moveTo(x, -1.42); c.lineTo(x + 0.17, -1.42); c.lineTo(x + 0.085, -1.1); c.fill(); }
    pennant(c, 3.3, -4.4, 0.75, 1.9, '#b3261e', '#2a1a1a');
    pennant(c, 4.6, -4.4, 0.75, 1.9, '#b3261e', '#2a1a1a');
    roundTower(c, 6.2, -8.8, 1.4, 9.0, st, roof, 3.1, 31);
    if (towers >= 3) roundTower(c, 7.9, -7.3, 0.62, 7.45, st, roof, 1.9, 22);
    for (const [x, y] of [[6.2, -6.6], [6.2, -4.2]]) {
      c.fillStyle = '#1a1012'; Fx.rrect(c, x - 0.13, y, 0.26, 0.7, 0.13); c.fill();
      c.fillStyle = 'rgba(255, 120, 60, .85)'; Fx.rrect(c, x - 0.07, y + 0.1, 0.14, 0.45, 0.07); c.fill();
    }
    keepDamage(c, dmg, [[2.9, -4.5], [5.0, -3.6], [6.6, -7.5]], 4.2, 3.2);
  }
  function drawKeeps(W) {
    const s = cam.scale, G = cam.ground;
    const own = W.keep.hp / W.keep.maxHp, foe = W.fort.hp / W.fort.maxHp;
    const lvl = (hp) => (hp < 0.35 ? 2 : hp < 0.7 ? 1 : 0);
    const end = W === g ? fx.end : null;
    // own keep
    let x = sx(0);
    if (x > -s * 10 && x < view.w + s * 4) {
      const sink = end && !end.won ? ease.inQuad(Math.min(1, end.t / 2.4)) * s * 3.5 : 0;
      ctx.save();
      if (sink) { ctx.beginPath(); ctx.rect(x - s * 4, 0, s * 14, G + s * 0.6); ctx.clip(); }
      blit(sprite(`keep${lvl(own)}`, -2.4, -12.8, 7.2, 1.3, (c) => artKeep(c, lvl(own))), x, G + sink);
      withMetres(x, G + sink, s, (c) => { flag(c, 4.85, -10.7, 1.6, 1.3, '#3a66c8', 1, 0); flag(c, 0.3, -8.25, 1.2, 0.9, '#3a66c8', 1, 1.3); });
      ctx.restore();
      Fx.glow(ctx, x + s * 1.2, G - s * 1.5, s * (0.9 + 0.1 * Math.sin(time * 9)), '#ffb050', 0.5);
      Fx.glow(ctx, x + s * 3.2, G - s * 1.5, s * (0.9 + 0.1 * Math.sin(time * 8 + 1)), '#ffb050', 0.5);
      if (own < 0.7 && Math.random() < (own < 0.35 ? 0.5 : 0.2)) smoke(0.9 + Math.random() * 4, G - s * (3 + Math.random() * 3), own < 0.35);
    }
    x = sx(W.L - F.FORT_W);
    if (x > -s * 12 && x < view.w + s * 4) {
      const sink = end && end.won ? ease.inQuad(Math.min(1, end.t / 2.4)) * s * 4.5 : 0;
      const tilt = end && end.won ? Math.min(1, end.t / 2.4) * 0.05 : 0;
      ctx.save();
      if (sink) { ctx.beginPath(); ctx.rect(x - s * 4, 0, s * 16, G + s * 0.6); ctx.clip(); }
      ctx.translate(x + s * 4, G + sink); ctx.rotate(tilt); ctx.translate(-x - s * 4, -G);
      const tw = Math.min(3, W.fort.towers);
      blit(sprite(`fort${lvl(foe)}|${tw}`, -1.6, -13.4, 10.2, 1.3, (c) => artFort(c, lvl(foe), tw)), x, G);
      withMetres(x, G, s, (c) => flag(c, 6.2, -12.1, 1.8, 1.5, '#c0322a', -1, 2));
      ctx.restore();
      Fx.glow(ctx, x + s * 0.6, G - s * 1.8, s * (1 + 0.15 * Math.sin(time * 11)), '#ff7a30', 0.6);
      Fx.glow(ctx, x + s * 2.6, G - s * 1.8, s * (1 + 0.15 * Math.sin(time * 10 + 2)), '#ff7a30', 0.6);
      if (foe < 0.7 && Math.random() < (foe < 0.35 ? 0.5 : 0.2)) smoke(W.L - F.FORT_W + 1 + Math.random() * 6, G - s * (3 + Math.random() * 4), foe < 0.35);
    }
  }
  function smoke(xm, y, fire) {
    particles.emit({ x: wpx(xm), y, vx: 6 + Math.random() * 6, vy: -18 - Math.random() * 10, life: 1.6, size: cam.scale * 0.35, grow: cam.scale * 0.6, color: fire ? '#4a4048' : '#8a8490', shape: 'smoke', drag: 0.3, alpha: 0.5 });
    if (fire) particles.emit({ x: wpx(xm), y, vx: (Math.random() - 0.5) * 10, vy: -30, life: 0.5, size: cam.scale * 0.12, color: '#ffb040', shape: 'spark' });
  }

  // ── Buildings ──
  const BUILD_H = { house: 2.9, barracks: 2.7, forge: 3.1, tower: 6.4, wall: 3.1 };
  const BUILD_W = { house: 1.3, barracks: 1.7, forge: 1.5, tower: 0.9, wall: 0.95 };
  function artHouse(c) {
    Fx.shadow(c, 0.35, 0.2, 1.9, 0.5, 0.45);
    box(c, -1.25, 0.15, 2.5, 1.65, 0.8, '#efdcb4');
    // timber frame
    c.fillStyle = '#6e4526';
    c.fillRect(-1.25, -1.5, 2.5, 0.12); c.fillRect(-1.25, 0.03, 2.5, 0.12);
    for (const x of [-1.25, -0.42, 0.42, 1.13]) c.fillRect(x, -1.5, 0.12, 1.65);
    c.lineWidth = 0.09; c.strokeStyle = '#6e4526';
    c.beginPath(); c.moveTo(0.48, -1.4); c.lineTo(1.13, 0.0); c.stroke();
    // door and window
    const dg = c.createLinearGradient(-0.3, 0, 0.3, 0); dg.addColorStop(0, '#9a6236'); dg.addColorStop(1, '#5e3a1e');
    c.fillStyle = dg; c.beginPath(); c.moveTo(-0.3, 0.12); c.lineTo(-0.3, -0.7); c.arc(0, -0.7, 0.3, Math.PI, 0); c.lineTo(0.3, 0.12); c.fill();
    c.fillStyle = '#e8c25a'; c.beginPath(); c.arc(0.17, -0.35, 0.05, 0, TAU); c.fill();
    c.fillStyle = '#4a3020'; c.fillRect(-1.08, -1.2, 0.55, 0.55);
    c.fillStyle = '#ffd98a'; c.fillRect(-1.03, -1.15, 0.45, 0.45);
    c.fillStyle = 'rgba(255, 255, 255, .5)'; c.fillRect(-1.03, -1.15, 0.12, 0.45);
    c.fillStyle = '#4a3020'; c.fillRect(-0.83, -1.15, 0.05, 0.45); c.fillRect(-1.03, -0.95, 0.45, 0.05);
    // chimney behind the roof, then the roof: two slopes and the gable
    box(c, 0.55, -2.25, 0.32, 0.75, 0.3, '#a3958a');
    const ridge = -2.85, eave = -1.45, rw = 1.5, ox = DX * 0.8, oy = DY * 0.8;
    c.fillStyle = shade('#c8553c', -0.28);
    c.beginPath(); c.moveTo(0, ridge); c.lineTo(rw, eave); c.lineTo(rw + ox, eave + oy); c.lineTo(ox, ridge + oy); c.closePath(); c.fill();
    c.fillStyle = shade('#c8553c', 0.18);
    c.beginPath(); c.moveTo(-rw, eave); c.lineTo(0, ridge); c.lineTo(ox, ridge + oy); c.lineTo(-rw + ox, eave + oy); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(60, 15, 10, .35)'; c.lineWidth = 0.04;
    for (let k = 1; k < 4; k++) { const f = k / 4; c.beginPath(); c.moveTo(-rw + rw * f, eave + (ridge - eave) * f); c.lineTo(-rw + rw * f + ox, eave + (ridge - eave) * f + oy); c.stroke(); }
    c.fillStyle = '#e4cfa6';
    c.beginPath(); c.moveTo(-1.25, eave + 0.05); c.lineTo(0, ridge + 0.2); c.lineTo(1.25, eave + 0.05); c.closePath(); c.fill();
    c.fillStyle = 'rgba(20, 10, 30, .18)'; c.fill();
    c.strokeStyle = '#a83e2a'; c.lineWidth = 0.2; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-rw, eave + 0.05); c.lineTo(0, ridge); c.lineTo(rw, eave + 0.05); c.stroke();
    c.strokeStyle = shade('#c8553c', 0.35); c.lineWidth = 0.06;
    c.beginPath(); c.moveTo(-rw, eave - 0.03); c.lineTo(0, ridge - 0.08); c.stroke();
    c.fillStyle = '#ffd98a'; c.beginPath(); c.arc(0, -2.05, 0.15, 0, TAU); c.fill();
  }
  function artBarracks(c) {
    Fx.shadow(c, 0.35, 0.2, 2.2, 0.5, 0.45);
    box(c, -1.6, 0.15, 3.2, 0.75, 0.9, '#a59f95');
    courses(c, -1.6, -0.6, 3.2, 0.75, 0.37, 0.6, 13);
    box(c, -1.55, -0.6, 3.1, 1.15, 0.9, '#b9885a', { top: false });
    c.fillStyle = 'rgba(60, 30, 10, .35)';
    for (let x = -1.45; x < 1.5; x += 0.26) c.fillRect(x, -1.75, 0.03, 1.15);
    c.fillStyle = '#6e4526'; c.fillRect(-1.6, -1.8, 3.2, 0.13); c.fillRect(-1.6, -0.66, 3.2, 0.1);
    // hipped slate roof
    const ox = DX * 0.9, oy = DY * 0.9;
    c.fillStyle = shade('#55678c', 0.3);
    c.beginPath(); c.moveTo(-1.15 + ox * 0.5, -2.65 + oy * 0.5); c.lineTo(1.15 + ox * 0.5, -2.65 + oy * 0.5); c.lineTo(1.85 + ox, -1.7 + oy); c.lineTo(-1.85 + ox, -1.7 + oy); c.closePath(); c.fill();
    const gr = c.createLinearGradient(0, -2.65, 0, -1.65); gr.addColorStop(0, '#6a7ca3'); gr.addColorStop(1, '#3f4e70');
    c.fillStyle = gr;
    c.beginPath(); c.moveTo(-1.85, -1.68); c.lineTo(-1.15, -2.65); c.lineTo(1.15, -2.65); c.lineTo(1.85, -1.68); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(15, 20, 40, .35)'; c.lineWidth = 0.035;
    for (let k = 1; k < 4; k++) { const y = -2.65 + k * 0.24, w = 1.15 + k * 0.175; c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke(); }
    c.fillStyle = shade('#3f4e70', -0.3); c.fillRect(-1.88, -1.72, 3.76, 0.1);
    c.fillStyle = 'rgba(255, 255, 255, .25)'; c.fillRect(-1.15, -2.67, 2.3, 0.05);
    // double door, shield, spears
    c.fillStyle = '#2a1a10'; c.fillRect(-0.45, -1.1, 0.9, 1.25);
    c.fillStyle = '#7a4a28'; c.fillRect(-0.4, -1.05, 0.39, 1.2); c.fillRect(0.01, -1.05, 0.39, 1.2);
    c.fillStyle = '#c9ccd2'; for (const x of [-0.3, -0.1, 0.1, 0.3]) for (const y of [-0.85, -0.25]) c.fillRect(x - 0.025, y, 0.05, 0.05);
    Fx.sphere(c, 0, -1.35, 0.27, '#3a66c8', { gloss: false });
    c.strokeStyle = '#f1cf5a'; c.lineWidth = 0.06; c.beginPath(); c.arc(0, -1.35, 0.27, 0, TAU); c.moveTo(0, -1.52); c.lineTo(0, -1.18); c.moveTo(-0.13, -1.36); c.lineTo(0.13, -1.36); c.stroke();
    c.lineCap = 'round';
    for (const x of [-1.85, -1.68]) { c.strokeStyle = '#7a5530'; c.lineWidth = 0.05; c.beginPath(); c.moveTo(x, 0.15); c.lineTo(x + 0.08, -1.5); c.stroke(); c.fillStyle = '#d6dde5'; c.beginPath(); c.moveTo(x + 0.03, -1.5); c.lineTo(x + 0.08, -1.75); c.lineTo(x + 0.13, -1.5); c.fill(); }
  }
  function artForge(c) {
    Fx.shadow(c, 0.35, 0.2, 2.0, 0.5, 0.45);
    Fx.cylinder(c, 0.85, -3.1, 0.3, 2.0, '#8b7f78', { ry: 0.09, capColor: '#2a2224' });
    c.fillStyle = '#1a1214'; c.beginPath(); c.ellipse(0.85, -3.1, 0.2, 0.06, 0, 0, TAU); c.fill();
    box(c, -1.45, 0.15, 2.9, 1.55, 0.9, '#958b84');
    courses(c, -1.45, -1.4, 2.9, 1.55, 0.38, 0.62, 21);
    const ox = DX * 0.9, oy = DY * 0.9;
    c.fillStyle = shade('#5a4c58', 0.25);
    c.beginPath(); c.moveTo(-1.2 + ox * 0.5, -2.05 + oy * 0.5); c.lineTo(1.2 + ox * 0.5, -2.05 + oy * 0.5); c.lineTo(1.7 + ox, -1.4 + oy); c.lineTo(-1.7 + ox, -1.4 + oy); c.closePath(); c.fill();
    const rg = c.createLinearGradient(0, -2.05, 0, -1.4); rg.addColorStop(0, '#6a5a66'); rg.addColorStop(1, '#3e3240');
    c.fillStyle = rg;
    c.beginPath(); c.moveTo(-1.7, -1.4); c.lineTo(-1.2, -2.05); c.lineTo(1.2, -2.05); c.lineTo(1.7, -1.4); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(15, 10, 20, .35)'; c.lineWidth = 0.035;
    for (let k = 1; k < 3; k++) { const y = -2.05 + k * 0.22, w = 1.2 + k * 0.17; c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke(); }
    c.fillStyle = '#2e2430'; c.fillRect(-1.72, -1.46, 3.44, 0.1);
    c.fillStyle = 'rgba(255, 255, 255, .2)'; c.fillRect(-1.2, -2.07, 2.4, 0.04);
    // the furnace mouth
    c.fillStyle = '#1a0e08';
    c.beginPath(); c.moveTo(-1.0, 0.1); c.lineTo(-1.0, -0.55); c.arc(-0.55, -0.55, 0.45, Math.PI, 0); c.lineTo(-0.1, 0.1); c.fill();
    // anvil
    box(c, 0.45, 0.15, 0.25, 0.35, 0.25, '#4a4048');
    c.fillStyle = '#5c6470';
    c.beginPath(); c.moveTo(0.2, -0.2); c.lineTo(1.05, -0.2); c.quadraticCurveTo(1.2, -0.28, 1.25, -0.38); c.lineTo(0.3, -0.38); c.closePath(); c.fill();
    c.fillStyle = '#aab4c2'; c.fillRect(0.3, -0.38, 0.8, 0.05);
  }
  function artTower(c) {
    Fx.shadow(c, 0.3, 0.2, 1.3, 0.4, 0.45);
    for (let i = 0; i < 4; i++) box(c, -0.95 + i * 0.47, -3.75, 0.24, 0.3, 0.2, '#958f86', { top: false });
    roundTower(c, 0, -3.9, 0.78, 4.05, '#aca69c', null, 0, 41);
    c.fillStyle = '#20160f'; Fx.rrect(c, -0.09, -2.7, 0.18, 0.6, 0.09); c.fill();
    c.fillStyle = '#20160f'; c.beginPath(); c.moveTo(-0.3, 0.12); c.lineTo(-0.3, -0.5); c.arc(0, -0.5, 0.3, Math.PI, 0); c.lineTo(0.3, 0.12); c.fill();
    c.fillStyle = '#7a4a28'; c.fillRect(-0.25, -0.5, 0.5, 0.62);
  }
  function artPalisade(c, hp, seed) {
    Fx.shadow(c, 0.25, 0.2, 1.3, 0.35, 0.45);
    c.strokeStyle = '#5a3a1e'; c.lineWidth = 0.14; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0.4, -1.6); c.lineTo(1.2, 0.15); c.moveTo(-0.5, -1.6); c.lineTo(0.3, 0.15); c.stroke();
    for (let i = -2; i <= 2; i++) {
      const broken = (hp < 0.66 && i === 1) || (hp < 0.33 && i === -1);
      const h = (2.55 + hash(seed + i) * 0.3) * (broken ? 0.55 : 1);
      const x = i * 0.34;
      Fx.cylinder(c, x, -h, 0.165, h + 0.15, '#9a6a3e', { cap: false, ry: 0.05 });
      if (broken) {
        c.fillStyle = '#d9b07a';
        c.beginPath(); c.moveTo(x - 0.165, -h); c.lineTo(x - 0.05, -h - 0.22); c.lineTo(x + 0.04, -h - 0.05); c.lineTo(x + 0.12, -h - 0.28); c.lineTo(x + 0.165, -h); c.closePath(); c.fill();
      } else {
        c.fillStyle = '#b98652';
        c.beginPath(); c.moveTo(x - 0.165, -h); c.lineTo(x, -h - 0.42); c.lineTo(x, -h); c.fill();
        c.fillStyle = '#6b4424';
        c.beginPath(); c.moveTo(x, -h); c.lineTo(x, -h - 0.42); c.lineTo(x + 0.165, -h); c.fill();
      }
      c.fillStyle = 'rgba(40, 20, 5, .35)'; c.fillRect(x - 0.02, -h * 0.8, 0.03, h * 0.5);
    }
    for (const y of [-0.75, -1.85]) {
      const gr = c.createLinearGradient(0, y - 0.09, 0, y + 0.09); gr.addColorStop(0, '#9c7a52'); gr.addColorStop(1, '#4a3018');
      c.fillStyle = gr; c.fillRect(-0.85, y - 0.09, 1.7, 0.18);
      c.fillStyle = '#6b6f78'; for (let i = -2; i <= 2; i++) c.fillRect(i * 0.34 - 0.03, y - 0.03, 0.06, 0.06);
    }
    if (hp < 0.66) crack(c, -0.2, -1.6, 1.0, seed);
  }
  function artStoneWall(c, hp, seed) {
    Fx.shadow(c, 0.3, 0.2, 1.5, 0.4, 0.5);
    box(c, -0.95, 0.18, 1.9, 2.7, 0.8, '#b8b0a2');
    courses(c, -0.95, -2.52, 1.9, 2.7, 0.42, 0.62, seed);
    for (let i = 0; i < 3; i++) {
      if (hp < 0.33 && i === 2) continue;
      box(c, -0.95 + i * 0.7, -2.52, 0.5, hp < 0.66 && i === 0 ? 0.25 : 0.45, 0.8, '#b8b0a2');
    }
    c.fillStyle = 'rgba(85, 125, 60, .6)';
    for (let x = -0.95; x < 0.95; x += 0.2) c.fillRect(x, 0.18 - 0.15 - hash(x * 9 + seed) * 0.35, 0.2, 0.15 + hash(x * 9 + seed) * 0.35);
    if (hp < 0.66) crack(c, 0.1, -2.3, 1.6, seed);
    if (hp < 0.33) { crack(c, -0.5, -1.7, 1.5, seed + 5); rock(c, 0.9, 0.4, 0.25, '#a8a094', seed); rock(c, -1.1, 0.42, 0.2, '#a8a094', seed + 2); }
  }
  function artBuilding(c, b, hpk, seed) {
    switch (b.id) {
      case 'house': artHouse(c); break;
      case 'barracks': artBarracks(c); break;
      case 'forge': artForge(c); break;
      case 'tower': artTower(c); break;
      case 'wall': if (b.stone && b.done) artStoneWall(c, hpk, seed); else artPalisade(c, hpk, seed); break;
      default: break;
    }
  }
  function plotAnim(i) { const k = 'p' + i; let a = anims.get(k); if (!a) { a = { pop: -9, dust: 0, spark: 0, hit: -9, cd: 0, atk: 9 }; anims.set(k, a); } a.seen = time; return a; }
  function drawPlot(p, i, W) {
    const s = cam.scale, x = sx(p.x), G = cam.ground;
    if (x < -s * 4 || x > view.w + s * 4) return;
    const a = plotAnim(i);
    if (!p.b) {
      const locked = p.x >= F.frontier(W), sel = target && target.plot === i;
      withMetres(x, G, s, (c) => {
        c.fillStyle = 'rgba(110, 80, 45, .35)';
        c.beginPath(); c.ellipse(0, 0.05, 1.45, 0.5, 0, 0, TAU); c.fill();
        c.strokeStyle = locked ? 'rgba(255, 255, 255, .25)' : sel ? '#ffd34d' : 'rgba(255, 250, 220, .75)';
        c.lineWidth = 0.06; c.setLineDash([0.22, 0.16]);
        c.beginPath(); c.moveTo(-1.3, -0.35); c.lineTo(1.3, -0.35); c.lineTo(1.3, 0.45); c.lineTo(-1.3, 0.45); c.closePath(); c.stroke();
        c.setLineDash([]);
        for (const [px, py] of [[-1.3, -0.35], [1.3, -0.35], [-1.3, 0.45], [1.3, 0.45]]) Fx.cylinder(c, px, py - 0.45, 0.06, 0.45, '#b07a44', { ry: 0.02 });
      });
      const bob = Math.sin(time * 3 + i) * s * 0.12, by = G - s * 1.35 + bob, r = Math.max(7, s * 0.5);
      if (sel) Fx.glow(ctx, x, by, r * 3, '#ffd34d', 0.6 + 0.3 * Math.sin(time * 6));
      Fx.shadow(ctx, x, G + s * 0.05, r * 0.9, r * 0.3, 0.3);
      ctx.fillStyle = locked ? 'rgba(60, 60, 70, .55)' : shade('#f5b21f', -0.35);
      ctx.beginPath(); ctx.arc(x, by + r * 0.1, r, 0, TAU); ctx.fill();
      ctx.fillStyle = locked ? 'rgba(150, 150, 160, .6)' : sel ? '#ffe066' : '#f8c231';
      ctx.beginPath(); ctx.arc(x, by, r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, .45)';
      ctx.beginPath(); ctx.ellipse(x - r * 0.3, by - r * 0.38, r * 0.42, r * 0.24, -0.5, 0, TAU); ctx.fill();
      if (locked) { ctx.fillStyle = 'rgba(40, 40, 50, .8)'; ctx.fillRect(x - r * 0.35, by - r * 0.1, r * 0.7, r * 0.55); ctx.strokeStyle = 'rgba(40, 40, 50, .8)'; ctx.lineWidth = r * 0.16; ctx.beginPath(); ctx.arc(x, by - r * 0.12, r * 0.25, Math.PI, 0); ctx.stroke(); }
      else { ctx.fillStyle = '#6b3d00'; const q = r * 0.5, w = r * 0.18; ctx.fillRect(x - q, by - w, q * 2, w * 2); ctx.fillRect(x - w, by - q, w * 2, q * 2); }
      return;
    }
    const b = p.b, k = b.done ? 1 : Math.min(1, b.work / b.need);
    const hpk = b.maxHp ? b.hp / b.maxHp : 1;
    const H = BUILD_H[b.id] || 3, hw = BUILD_W[b.id] || 1.3;
    const upgrading = !b.done && b.stone;
    const hitT = time - a.hit, jit = hitT < 0.25 ? Math.sin(hitT * 70) * (0.25 - hitT) * s * 0.4 : 0;
    const popT = time - a.pop, pop = popT < 0.9 ? Math.sin(popT * 16) * Math.exp(-popT * 5) * 0.14 : 0;
    const seed = Math.round(p.x);
    withMetres(x + jit, G, s, (c) => {
      if (pop) c.scale(1 - pop * 0.5, 1 + pop);
      if (b.done || upgrading) {
        if (upgrading) artPalisade(c, hpk, seed);
        else artBuilding(c, b, hpk, seed);
      }
      if (!b.done) {
        const e = ease.outCubic(k);
        // footings, the rising body, the scaffold round it
        c.fillStyle = 'rgba(110, 80, 45, .4)'; c.beginPath(); c.ellipse(0, 0.08, hw + 0.4, 0.45, 0, 0, TAU); c.fill();
        c.save();
        c.beginPath(); c.rect(-4, -12, 8, 12.25); c.clip();
        c.translate(0, (1 - e) * H);
        if (upgrading) artStoneWall(c, 1, seed); else artBuilding(c, b, 1, seed);
        c.restore();
        const sh = H * Math.min(1, 0.3 + k), sa = k > 0.85 ? (1 - k) / 0.15 : 1;
        c.globalAlpha = sa;
        c.strokeStyle = '#b8864f'; c.lineWidth = 0.09; c.lineCap = 'round';
        c.beginPath();
        for (const px of [-hw - 0.15, hw + 0.15]) { c.moveTo(px, 0.2); c.lineTo(px, -sh); }
        for (let y = -0.9; y > -sh; y -= 0.9) { c.moveTo(-hw - 0.25, y); c.lineTo(hw + 0.25, y); }
        c.stroke();
        c.strokeStyle = 'rgba(140, 95, 50, .9)'; c.lineWidth = 0.05;
        c.beginPath();
        for (let y = 0; y > -sh + 0.9; y -= 0.9) { c.moveTo(-hw - 0.15, y); c.lineTo(hw + 0.15, y - 0.9); }
        c.stroke();
        c.globalAlpha = 1;
      }
    });
    if (!b.done) {
      const e = ease.outCubic(k);
      a.dust -= frameDt; a.spark -= frameDt;
      if (a.dust <= 0 && !paused) { a.dust = 0.12; particles.emit({ x: wpx(p.x + (Math.random() - 0.5) * hw * 2), y: G + s * 0.1, vx: (Math.random() - 0.5) * 20, vy: -8 - Math.random() * 8, life: 0.9, size: s * 0.25, grow: s * 0.5, color: '#d9c49a', shape: 'smoke', drag: 0.5, alpha: 0.6 }); }
      if (a.spark <= 0 && !paused) {
        a.spark = 0.45 + Math.random() * 0.2;
        const hx = p.x + (Math.random() - 0.5) * hw * 1.4, hy = G - s * (H * e - 0.1);
        emit(hx, hy, 5, { speed: s * 5, life: 0.35, size: Math.max(1, s * 0.08), color: '#ffd36a', shape: 'spark', gravity: s * 12 });
        particles.emit({ x: wpx(hx), y: hy, life: 0.2, size: s * 0.2, grow: s * 2, color: 'rgba(255, 240, 200, .9)', shape: 'ring' });
      }
      const bw = s * 2, by = G + s * 0.75;
      ctx.fillStyle = 'rgba(15, 10, 5, .6)'; Fx.rrect(ctx, x - bw / 2 - 1, by - 1, bw + 2, 6, 3); ctx.fill();
      const gr = ctx.createLinearGradient(0, by, 0, by + 4); gr.addColorStop(0, '#ffe680'); gr.addColorStop(1, '#e09a10');
      ctx.fillStyle = gr; Fx.rrect(ctx, x - bw / 2, by, Math.max(4, bw * k), 4, 2); ctx.fill();
    } else {
      // live details: smoke, furnace fire, the tower's archer, flags
      if (b.id === 'house' && Math.random() < frameDt * 2.5) particles.emit({ x: wpx(p.x + 0.71), y: G - s * 2.3, vx: 4, vy: -10, life: 1.8, size: s * 0.15, grow: s * 0.35, color: '#d8d4d0', shape: 'smoke', alpha: 0.6 });
      if (b.id === 'forge') {
        if (Math.random() < frameDt * 4) particles.emit({ x: wpx(p.x + 0.85), y: G - s * 3.15, vx: 5 + Math.random() * 4, vy: -16, life: 1.6, size: s * 0.15, grow: s * 0.3, color: '#8a8288', shape: 'smoke', alpha: 0.45 });
        const fl = 0.75 + 0.25 * Math.sin(time * 13) * Math.sin(time * 7.3);
        withMetres(x, G, s, (c) => {
          const fg = c.createRadialGradient(-0.55, 0.05, 0.02, -0.55, -0.1, 0.55);
          fg.addColorStop(0, '#fff6c0'); fg.addColorStop(0.35, '#ffb83a'); fg.addColorStop(0.75, '#e0461a'); fg.addColorStop(1, 'rgba(120, 20, 0, 0)');
          c.fillStyle = fg;
          c.beginPath(); c.moveTo(-0.95, 0.1);
          for (let k = 0; k <= 6; k++) { const xx = -0.95 + k * 0.133, hh = 0.25 + 0.3 * Math.abs(Math.sin(time * 9 + k * 1.7)) * (k % 2 ? 1 : 0.6); c.lineTo(xx, 0.05 - hh); }
          c.lineTo(-0.15, 0.1); c.closePath(); c.fill();
        });
        Fx.glow(ctx, x - s * 0.55, G - s * 0.35, s * 1.5, '#ff8a30', fl * 0.7);
        a.spark -= frameDt;
        if (a.spark <= 0 && running) { a.spark = 0.9 + Math.random() * 0.6; emit(p.x + 0.7, G - s * 0.42, 6, { speed: s * 4, angle: -Math.PI / 2, spread: 2.4, life: 0.45, size: Math.max(1, s * 0.07), color: '#ffcf5a', shape: 'spark', gravity: s * 14 }); }
      }
      if (b.id === 'barracks') withMetres(x, G, s, (c) => flag(c, 1.95, 0.15, 3.6, 1.0, '#3a66c8', 1, i));
      if (b.id === 'tower') {
        if (b.cd > a.cd + 0.05) a.atk = 0;
        a.cd = b.cd;
        withMetres(x, G - s * 4.05, s, (c) => {
          figure(c, 'archer', false, { ph: 0, mv: 0, atk: a.atk, fl: 0, dir: 1, big: 0.8 });
          c.fillStyle = '#aca69c';
          for (const mx of [-0.62, 0.25]) box(c, mx, 0.15, 0.36, 0.45, 0.15, '#aca69c');
        });
        withMetres(x, G - s * 4.6, s, (c) => flag(c, -0.6, 0, 1.4, 0.75, '#3a66c8', 1, i * 2));
      }
      if (b.id === 'wall' && hpk < 1) {
        const bw = s * 1.8, by = G - s * (b.stone ? 3.4 : 3.3);
        ctx.fillStyle = 'rgba(15, 10, 5, .6)'; Fx.rrect(ctx, x - bw / 2 - 1, by - 1, bw + 2, 6, 3); ctx.fill();
        ctx.fillStyle = hpk > 0.5 ? '#8fd17a' : hpk > 0.25 ? '#ffc94d' : '#ff6a5c';
        Fx.rrect(ctx, x - bw / 2, by, Math.max(4, bw * hpk), 4, 2); ctx.fill();
      }
    }
  }

  // ── Figures ──
  const LOOK = {
    worker: { body: '#a8723e', legs: '#5a4232', big: 0.95 },
    soldier: { body: '#3d70d6', legs: '#2b3550', big: 1 },
    archer: { body: '#3f8de0', legs: '#2b3a50', big: 1 },
    knight: { body: '#c9d1db', legs: '#8a96a6', big: 1.22 },
    catapult: { body: '#9a6a3a', legs: '#000', big: 1.3 },
    raider: { body: '#cc4a38', legs: '#4a2a26', big: 1 },
    brute: { body: '#8c3226', legs: '#3a2420', big: 1.28 },
    slinger: { body: '#d9803a', legs: '#4a3020', big: 0.95 },
    ogre: { body: '#86a454', legs: '#5a3c22', big: 2.0 },
  };
  const SKIN = '#f2c49a';
  // Pose: ph walk phase, mv 0…1 moving, atk seconds since the last blow, fl hit flash 0…1, dir facing (local
  // coordinates always face right; the caller mirrors), carry, work (a worker's swing phase or -1).
  function figure(c, kind, foe, P) {
    const lk = LOOK[kind], fl = P.fl || 0;
    const col = fl > 0 ? (q) => mix(q, '#ffffff', fl * 0.85) : (q) => q;
    const lt = -P.dir;                  // the side towards the light, in local x
    if (kind === 'catapult') { catapultArt(c, P, col); return; }
    const big = P.big || lk.big;
    c.save();
    c.scale(big, big);
    const swing = Math.sin(P.ph) * 0.55 * P.mv, bob = Math.abs(Math.cos(P.ph)) * 0.05 * P.mv;
    // melee blow: wind up, strike, recover
    const at = P.atk, dur = 0.42;
    let arm = -0.5, lean = 0;
    if (at < dur) {
      const q = at / dur;
      if (q < 0.3) arm = -0.5 - 1.3 * ease.outQuad(q / 0.3);
      else if (q < 0.55) arm = -1.8 + 3.0 * ease.inQuad((q - 0.3) / 0.25);
      else arm = 1.2 - 1.7 * ease.inOutQuad((q - 0.55) / 0.45);
      lean = q > 0.3 && q < 0.75 ? 0.1 : 0;
    }
    if (P.work >= 0) { const q = P.work % 1; arm = q < 0.6 ? -0.5 - 1.4 * ease.outQuad(q / 0.6) : -1.9 + 3.0 * ease.inQuad((q - 0.6) / 0.4); lean = q > 0.6 ? 0.08 : 0; }
    c.translate(lean, -bob);
    const legs = col(lk.legs), boots = col(foe ? '#2a1a14' : '#3a2a1e');
    c.lineCap = 'round';
    const leg = (a, tone) => {
      const fx2 = Math.sin(a) * 0.46, fy = -0.5 + Math.cos(a) * 0.46;
      c.strokeStyle = shade(legs, tone); c.lineWidth = kind === 'ogre' ? 0.26 : 0.2;
      c.beginPath(); c.moveTo(0, -0.52); c.lineTo(fx2, fy - 0.04); c.stroke();
      c.fillStyle = shade(boots, tone); Fx.rrect(c, fx2 - 0.12, fy - 0.1, 0.3, 0.15, 0.07); c.fill();
    };
    leg(-swing, -0.3);
    // the back arm and things worn on the back
    if (kind === 'archer') { c.fillStyle = col('#7a4a24'); c.save(); c.rotate(-0.35); Fx.rrect(c, -0.38, -1.25, 0.16, 0.55, 0.06); c.fill(); c.restore(); c.fillStyle = col('#f0ece0'); for (let k = 0; k < 3; k++) c.fillRect(-0.68 + k * 0.05, -1.36 - k * 0.02, 0.05, 0.12); }
    c.strokeStyle = shade(col(kind === 'ogre' ? lk.body : kind === 'knight' ? lk.body : SKIN), -0.35); c.lineWidth = 0.12;
    if (!P.carry) { c.beginPath(); c.moveTo(-0.05, -1.08); c.lineTo(-0.2 - swing * 0.3, -0.72); c.stroke(); }
    leg(swing, 0);
    // torso
    const body = col(lk.body), tw = kind === 'ogre' ? 0.62 : kind === 'brute' ? 0.56 : 0.48;
    c.save();
    Fx.rrect(c, -tw / 2, -1.2, tw, 0.74, 0.17);
    c.fillStyle = body; c.fill();
    c.clip();
    c.fillStyle = shade(body, -0.3); c.fillRect(lt < 0 ? 0.04 : -tw / 2 - 0.04, -1.2, tw / 2, 0.74);
    c.fillStyle = shade(body, 0.28); c.fillRect(lt < 0 ? -tw / 2 : tw / 2 - 0.1, -1.2, 0.1, 0.74);
    if (kind === 'knight') { c.fillStyle = col('#3a66c8'); c.fillRect(-0.14, -1.15, 0.28, 0.62); c.fillStyle = col('#f1cf5a'); c.fillRect(-0.03, -1.0, 0.06, 0.3); c.fillRect(-0.1, -0.92, 0.2, 0.06); }
    if (kind === 'ogre') { c.fillStyle = shade(body, 0.12); c.beginPath(); c.ellipse(0.08, -0.78, 0.26, 0.2, 0, 0, TAU); c.fill(); }
    c.fillStyle = col(kind === 'ogre' ? '#6a4626' : '#4a2e1a'); c.fillRect(-tw / 2, kind === 'ogre' ? -0.66 : -0.66, tw, kind === 'ogre' ? 0.2 : 0.08);
    if (kind !== 'ogre') { c.fillStyle = col('#e8c25a'); c.fillRect(-0.045, -0.67, 0.09, 0.1); }
    c.restore();
    if (kind === 'brute' || kind === 'knight') { Fx.sphere(c, -0.05, -1.13, 0.17, col(kind === 'knight' ? '#c9d1db' : '#7a5a3a'), { gloss: false }); }
    // head
    const hy = kind === 'ogre' ? -1.36 : -1.46, hr = kind === 'ogre' ? 0.22 : 0.27;
    const skin = col(kind === 'ogre' ? '#86a454' : SKIN);
    c.fillStyle = shade(skin, -0.3); c.beginPath(); c.arc(0, hy, hr, 0, TAU); c.fill();
    c.fillStyle = skin; c.beginPath(); c.arc(lt * 0.03, hy - 0.02, hr * 0.9, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255, 255, 255, .35)'; c.beginPath(); c.ellipse(lt * 0.09, hy - 0.1, 0.07, 0.045, 0, 0, TAU); c.fill();
    c.fillStyle = '#1a1020'; c.beginPath(); c.arc(0.13, hy - 0.02, 0.035, 0, TAU); c.fill();
    headgear(c, kind, hy, hr, col);
    // the front arm and the weapon
    const sxh = 0.05, syh = -1.08;
    if (P.carry) carried(c, P.carry, col);
    else if (kind === 'archer') bow(c, P, col);
    else if (kind === 'slinger') sling(c, P, col);
    else {
      const hx = sxh + Math.cos(arm) * 0.36, hyy = syh + Math.sin(arm) * 0.36 + 0.1;
      c.strokeStyle = shade(col(kind === 'knight' ? '#c9d1db' : kind === 'ogre' ? '#86a454' : SKIN), -0.05); c.lineWidth = 0.12;
      c.beginPath(); c.moveTo(sxh, syh); c.lineTo(hx, hyy); c.stroke();
      weapon(c, kind, hx, hyy, arm - 0.5, col, P);
    }
    if (kind === 'soldier' || kind === 'knight') shield(c, kind, col);
    c.restore();
  }
  function headgear(c, kind, hy, hr, col) {
    switch (kind) {
      case 'worker':
        c.fillStyle = col('#d8b878'); c.beginPath(); c.ellipse(0, hy - 0.1, hr * 1.25, 0.07, 0, 0, TAU); c.fill();
        c.beginPath(); c.arc(0, hy - 0.1, hr * 0.8, Math.PI, 0); c.fill();
        c.fillStyle = col('#a8853f'); c.fillRect(-hr * 0.8, hy - 0.16, hr * 1.6, 0.05);
        break;
      case 'soldier': case 'knight': {
        const m = col('#b9c3d0');
        c.fillStyle = shade(m, -0.35); c.beginPath(); c.arc(0, hy - 0.02, hr * 1.06, Math.PI * 0.95, Math.PI * 2.05); c.fill();
        c.fillStyle = m; c.beginPath(); c.arc(-0.02, hy - 0.04, hr * 0.98, Math.PI, Math.PI * 1.95); c.fill();
        c.fillStyle = 'rgba(255, 255, 255, .6)'; c.beginPath(); c.ellipse(-0.08, hy - 0.17, 0.08, 0.035, -0.4, 0, TAU); c.fill();
        c.fillStyle = shade(m, -0.3); c.fillRect(0.06, hy - 0.06, 0.05, 0.16);
        if (kind === 'knight') {
          c.fillStyle = col('#2a3040'); c.fillRect(0.02, hy - 0.04, hr, 0.04);
          c.fillStyle = col('#3a66c8'); c.beginPath(); c.moveTo(-0.05, hy - hr); c.quadraticCurveTo(-0.45, hy - hr - 0.25, -0.5, hy - 0.05); c.quadraticCurveTo(-0.3, hy - hr - 0.05, -0.05, hy - hr + 0.05); c.fill();
        }
        break;
      }
      case 'archer':
        c.fillStyle = col('#7a4a24'); c.beginPath(); c.arc(-0.02, hy - 0.02, hr * 1.08, Math.PI * 0.75, Math.PI * 2.05); c.lineTo(-hr * 1.3, hy + 0.12); c.closePath(); c.fill();
        c.fillStyle = col('#9a6232'); c.beginPath(); c.arc(-0.04, hy - 0.05, hr * 0.95, Math.PI * 1.05, Math.PI * 1.7); c.lineTo(-0.04, hy - 0.05); c.fill();
        break;
      case 'raider':
        c.fillStyle = col('#8a2a20'); c.beginPath(); c.arc(0, hy - 0.03, hr * 1.02, Math.PI * 1.02, Math.PI * 1.98); c.fill();
        c.fillRect(-hr, hy - 0.08, hr * 2, 0.07);
        c.strokeStyle = col('#8a2a20'); c.lineWidth = 0.06; c.beginPath(); c.moveTo(-hr, hy - 0.05); c.quadraticCurveTo(-hr - 0.2, hy, -hr - 0.25, hy + 0.15); c.stroke();
        c.fillStyle = col('#efe6d0'); c.beginPath(); c.moveTo(-0.15, hy - hr * 0.8); c.quadraticCurveTo(-0.3, hy - hr - 0.2, -0.22, hy - hr - 0.3); c.lineTo(-0.08, hy - hr * 0.9); c.fill();
        break;
      case 'brute':
        c.fillStyle = col('#3a2418'); c.beginPath(); c.moveTo(-0.05, hy + 0.05); c.quadraticCurveTo(0.12, hy + 0.36, 0.26, hy + 0.06); c.closePath(); c.fill();
        c.fillStyle = col('#5a5a64'); c.beginPath(); c.arc(0, hy - 0.04, hr * 1.02, Math.PI, Math.PI * 2); c.fill();
        c.fillStyle = col('#d8d0c0'); for (const sx2 of [-0.12, 0.08]) { c.beginPath(); c.moveTo(sx2, hy - hr); c.lineTo(sx2 + 0.04, hy - hr - 0.18); c.lineTo(sx2 + 0.08, hy - hr); c.fill(); }
        break;
      case 'slinger':
        c.fillStyle = col('#a8562a'); c.beginPath(); c.arc(-0.02, hy - 0.02, hr * 1.08, Math.PI * 0.8, Math.PI * 2.02); c.lineTo(-hr * 1.2, hy + 0.15); c.closePath(); c.fill();
        break;
      case 'ogre':
        c.fillStyle = col('#f4ecd8'); for (const sx2 of [0.05, 0.16]) { c.beginPath(); c.moveTo(sx2, hy + 0.1); c.lineTo(sx2 + 0.03, hy - 0.04); c.lineTo(sx2 + 0.06, hy + 0.1); c.fill(); }
        c.fillStyle = '#2a1010'; c.fillRect(0.02, hy - 0.08, 0.16, 0.03);
        break;
      default: break;
    }
  }
  function weapon(c, kind, hx, hy, ang, col, P) {
    c.save(); c.translate(hx, hy); c.rotate(ang);
    if (kind === 'worker') {
      const pick = P.tool === 'pick';
      c.strokeStyle = col('#8a5a30'); c.lineWidth = 0.07;
      c.beginPath(); c.moveTo(0, 0.12); c.lineTo(0.55, 0); c.stroke();
      c.fillStyle = col('#9aa4b2');
      if (pick) { c.beginPath(); c.moveTo(0.5, -0.25); c.quadraticCurveTo(0.62, 0, 0.5, 0.25); c.lineTo(0.56, 0); c.closePath(); c.lineWidth = 0.06; c.strokeStyle = col('#9aa4b2'); c.stroke(); }
      else { c.beginPath(); c.moveTo(0.45, -0.04); c.lineTo(0.62, -0.18); c.lineTo(0.66, 0.1); c.lineTo(0.48, 0.06); c.closePath(); c.fill(); }
    } else if (kind === 'ogre' || kind === 'brute') {
      const L = kind === 'ogre' ? 0.95 : 0.8;
      c.fillStyle = col('#7a5030');
      c.beginPath(); c.moveTo(0, -0.04); c.lineTo(L, -0.12); c.quadraticCurveTo(L + 0.15, 0, L, 0.12); c.lineTo(0, 0.04); c.closePath(); c.fill();
      c.fillStyle = col('#b88a5a'); c.fillRect(0.1, -0.06, L * 0.7, 0.03);
      c.fillStyle = col('#c8ccd4'); for (let k = 0; k < 3; k++) { const xx = L * (0.55 + k * 0.17); c.beginPath(); c.moveTo(xx, -0.1); c.lineTo(xx + 0.04, -0.22); c.lineTo(xx + 0.08, -0.1); c.fill(); }
    } else if (kind === 'raider') {
      c.strokeStyle = col('#6a4424'); c.lineWidth = 0.06; c.beginPath(); c.moveTo(-0.05, 0); c.lineTo(0.55, 0); c.stroke();
      c.fillStyle = col('#aeb6c2'); c.beginPath(); c.moveTo(0.42, -0.02); c.quadraticCurveTo(0.55, -0.28, 0.66, -0.2); c.lineTo(0.62, 0.15); c.quadraticCurveTo(0.55, 0.12, 0.42, 0.04); c.fill();
    } else {
      const L = kind === 'knight' ? 0.85 : 0.68;
      c.fillStyle = col('#5a3a20'); c.fillRect(-0.1, -0.035, 0.12, 0.07);
      c.fillStyle = col('#d9b04a'); c.fillRect(0.02, -0.11, 0.05, 0.22);
      c.fillStyle = col('#e4ebf2'); c.beginPath(); c.moveTo(0.07, -0.045); c.lineTo(L, -0.03); c.lineTo(L + 0.08, 0); c.lineTo(L, 0.03); c.lineTo(0.07, 0.045); c.closePath(); c.fill();
      c.fillStyle = 'rgba(80, 90, 110, .5)'; c.fillRect(0.09, 0.005, L - 0.05, 0.035);
    }
    c.restore();
  }
  function shield(c, kind, col) {
    if (kind === 'knight') {
      c.fillStyle = col('#2f58b0'); c.beginPath(); c.moveTo(0.1, -1.05); c.lineTo(0.42, -1.05); c.quadraticCurveTo(0.44, -0.6, 0.26, -0.42); c.quadraticCurveTo(0.08, -0.6, 0.1, -1.05); c.fill();
      c.fillStyle = col('#f1cf5a'); c.fillRect(0.24, -1.0, 0.04, 0.45); c.fillRect(0.14, -0.86, 0.24, 0.04);
      return;
    }
    c.fillStyle = col('#24448a'); c.beginPath(); c.ellipse(0.24, -0.82, 0.13, 0.27, 0, 0, TAU); c.fill();
    c.fillStyle = col('#3d70d6'); c.beginPath(); c.ellipse(0.22, -0.83, 0.1, 0.23, 0, 0, TAU); c.fill();
    c.strokeStyle = col('#e8eef6'); c.lineWidth = 0.035; c.stroke();
    Fx.sphere(c, 0.22, -0.83, 0.05, col('#d9b04a'), { gloss: false });
  }
  function bow(c, P, col) {
    const q = P.atk < 0.5 ? P.atk / 0.5 : 1;
    const pull = P.atk < 0.5 ? (q < 0.25 ? 0 : q < 0.5 ? (q - 0.25) * 4 * 0.22 : 0) : 0.12;
    const bx = 0.38, by = -1.02;
    c.strokeStyle = col(SKIN); c.lineWidth = 0.11;
    c.beginPath(); c.moveTo(0.05, -1.08); c.lineTo(bx, by); c.moveTo(0.02, -1.06); c.lineTo(bx - 0.2 - pull, by); c.stroke();
    c.strokeStyle = col('#7a4a24'); c.lineWidth = 0.06;
    c.beginPath(); c.arc(bx - 0.22, by, 0.42, -1.05, 1.05); c.stroke();
    c.strokeStyle = 'rgba(240, 235, 220, .9)'; c.lineWidth = 0.02;
    const tx = bx - 0.22 + Math.cos(1.05) * 0.42, ty = Math.sin(1.05) * 0.42;
    c.beginPath(); c.moveTo(tx, by - ty); c.lineTo(bx - 0.2 - pull, by); c.lineTo(tx, by + ty); c.stroke();
    if (P.atk > 0.12) { c.strokeStyle = col('#e8dcc0'); c.lineWidth = 0.03; c.beginPath(); c.moveTo(bx - 0.2 - pull, by); c.lineTo(bx + 0.32, by); c.stroke(); }
  }
  function sling(c, P, col) {
    const sp = P.atk < 0.6 ? P.atk * 26 : time * 3;
    c.strokeStyle = col(SKIN); c.lineWidth = 0.11;
    const hx = 0.12, hy = -1.55;
    c.beginPath(); c.moveTo(0.05, -1.08); c.lineTo(hx, hy); c.stroke();
    const ex = hx + Math.cos(sp) * 0.38, ey = hy - 0.05 + Math.sin(sp) * 0.14;
    c.strokeStyle = col('#8a6a40'); c.lineWidth = 0.025;
    c.beginPath(); c.moveTo(hx, hy); c.lineTo(ex, ey); c.stroke();
    c.fillStyle = col('#8a8a90'); c.beginPath(); c.arc(ex, ey, 0.06, 0, TAU); c.fill();
  }
  function carried(c, res, col) {
    c.strokeStyle = shade(col(SKIN), -0.05); c.lineWidth = 0.11;
    c.beginPath(); c.moveTo(0.05, -1.08); c.lineTo(0.0, -1.62); c.moveTo(-0.08, -1.08); c.lineTo(-0.25, -1.6); c.stroke();
    if (res === 'wood') {
      c.save(); c.translate(-0.1, -1.72); c.rotate(-0.12);
      const gr = c.createLinearGradient(0, -0.13, 0, 0.13); gr.addColorStop(0, '#c08a52'); gr.addColorStop(1, '#5e3a1c');
      c.fillStyle = gr; Fx.rrect(c, -0.55, -0.13, 1.1, 0.26, 0.12); c.fill();
      c.fillStyle = '#e8c890'; c.beginPath(); c.ellipse(0.55, 0, 0.06, 0.13, 0, 0, TAU); c.fill();
      c.strokeStyle = '#a07040'; c.lineWidth = 0.02; c.beginPath(); c.ellipse(0.55, 0, 0.03, 0.07, 0, 0, TAU); c.stroke();
      c.restore();
    } else if (res === 'stone') {
      box(c, -0.38, -1.62, 0.6, 0.38, 0.3, col('#b2b6bd'));
    } else {
      Fx.sphere(c, -0.12, -1.8, 0.26, col('#8a6a48'), { gloss: false });
      c.fillStyle = '#bfe6ff'; c.fillRect(-0.2, -1.9, 0.07, 0.07); c.fillRect(-0.02, -1.78, 0.06, 0.06);
    }
  }
  function catapultArt(c, P, col) {
    c.save(); c.scale(1.15, 1.15);
    const wood = col('#a06e3c');
    // arm: rest leans back, a shot whips it forward
    let arm = -2.5;
    const at = P.atk;
    if (at < 0.18) arm = -2.5 + 1.6 * ease.outCubic(at / 0.18);
    else if (at < 1.4) arm = -0.9 - 1.6 * ease.inOutQuad((at - 0.18) / 1.22);
    c.strokeStyle = shade(wood, -0.35); c.lineWidth = 0.12; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-0.6, -0.55); c.lineTo(-0.1, -1.25); c.lineTo(0.4, -0.55); c.stroke();
    c.save(); c.translate(-0.1, -1.2); c.rotate(arm);
    c.strokeStyle = col('#8a5a30'); c.lineWidth = 0.13;
    c.beginPath(); c.moveTo(-0.35, 0); c.lineTo(1.25, 0); c.stroke();
    c.fillStyle = col('#5a3a20'); c.beginPath(); c.arc(1.3, 0, 0.17, 0, Math.PI); c.fill();
    if (at > 0.9 || at >= 9) Fx.sphere(c, 1.3, -0.06, 0.15, col('#8a8a90'), { gloss: false });
    box(c, -0.6, 0.25, 0.4, 0.45, 0.2, col('#6a6f78'));
    c.restore();
    box(c, -1.0, -0.38, 2.0, 0.24, 0.5, wood);
    c.strokeStyle = shade(wood, -0.1); c.lineWidth = 0.12;
    c.beginPath(); c.moveTo(-0.55, -0.6); c.lineTo(-0.1, -1.25); c.lineTo(0.35, -0.6); c.stroke();
    for (const wx of [-0.62, 0.62]) {
      c.fillStyle = col('#3b2a1a'); c.beginPath(); c.arc(wx, -0.28, 0.3, 0, TAU); c.fill();
      c.fillStyle = col('#7a5530'); c.beginPath(); c.arc(wx, -0.28, 0.23, 0, TAU); c.fill();
      c.strokeStyle = col('#3b2a1a'); c.lineWidth = 0.04;
      for (let k = 0; k < 3; k++) { const a = P.ph * 0.7 + k * Math.PI / 3; c.beginPath(); c.moveTo(wx - Math.cos(a) * 0.23, -0.28 - Math.sin(a) * 0.23); c.lineTo(wx + Math.cos(a) * 0.23, -0.28 + Math.sin(a) * 0.23); c.stroke(); }
      Fx.sphere(c, wx, -0.28, 0.06, col('#9aa4b2'), { gloss: false });
    }
    c.restore();
  }
  // Units of one kind stand on one spot in the rules; on screen each takes a stable lane in depth and a small
  // sideways offset so a squad reads as a formation.
  const lane = (id) => (((id * 7) % 5) - 2) * 0.16;
  const sway = (id) => (((id * 13) % 7) - 3) * 0.17;
  function animOf(u) {
    let a = anims.get(u.id);
    if (!a) { a = { x: u.x, mv: 0, ph: hash(u.id) * TAU, cd: u.cd, atk: 9, fl: 0, dir: 1, work: 0, chip: 0, wasWork: false }; anims.set(u.id, a); }
    a.seen = time;
    return a;
  }
  function stepAnims(W, gdt) {
    for (const list of [W.units, W.foes]) for (const u of list) {
      const a = animOf(u), dx = u.x - a.x;
      a.x = u.x;
      const moving = Math.abs(dx) > 1e-4;
      a.mv = Fx.damp(a.mv, moving ? 1 : 0, 0.999, frameDt);
      a.ph += Math.abs(dx) / 0.9 * Math.PI;
      if (moving && Math.abs(dx) > 1e-3) a.dir = dx > 0 ? 1 : -1;
      if (u.cd != null && u.cd > a.cd + 0.05) a.atk = 0;
      a.cd = u.cd;
      a.atk += gdt;
      a.fl = Math.max(0, a.fl - frameDt * 6);
      if (u.kind === 'worker' && u.phase === 'work') {
        const before = a.work;
        a.work += gdt * 1.4;
        if (Math.floor(before + 0.4) !== Math.floor(a.work + 0.4) && W === g) {
          const res = W.nodes[u.node] ? W.nodes[u.node].res : 'wood';
          emit(u.x + 0.7, cam.ground - cam.scale * 0.6, 4, { speed: cam.scale * 3, angle: -Math.PI / 2, spread: 2.2, life: 0.5, size: cam.scale * 0.12, colors: res === 'wood' ? ['#c89058', '#e8c890', '#6a4424'] : res === 'stone' ? ['#b8bcc4', '#8a8e96'] : ['#9fd8ff', '#5a6472'], shape: 'chunk', gravity: cam.scale * 18, spin: 10 });
          if (res !== 'wood') emit(u.x + 0.7, cam.ground - cam.scale * 0.6, 3, { speed: cam.scale * 4, life: 0.25, size: 1.2, color: '#fff2b0', shape: 'spark' });
        }
      } else a.work = 0;
    }
  }
  function drawFigures(W) {
    const s = cam.scale, G = cam.ground;
    const all = [];
    for (const u of W.units) all.push([u, false]);
    for (const f of W.foes) all.push([f, true]);
    all.sort((p, q) => lane(p[0].id) - lane(q[0].id));
    for (const [u, foe] of all) {
      const a = animOf(u), ln = lane(u.id);
      let x = sx(u.x + (u.kind === 'worker' ? 0 : sway(u.id))), y = G + ln * s;
      if (x < -s * 4 || x > view.w + s * 4) continue;
      // a foe in an open chasm climbs down and up through it
      let dip = 0;
      if (foe) for (const c of W.chasms) if (!c.bridged && u.x > c.x0 && u.x < c.x1) dip = Math.sin(Math.PI * (u.x - c.x0) / (c.x1 - c.x0)) * 1.3;
      const dir = foe ? -1 : u.kind === 'worker' ? a.dir : (a.mv > 0.5 ? a.dir : 1);
      const big = LOOK[u.kind].big;
      if (!dip) Fx.shadow(ctx, x, y + s * 0.03, s * 0.45 * big, s * 0.14 * big, 0.45);
      x -= dir * a.fl * s * 0.12;
      y += dip * s;
      const P = { ph: a.ph, mv: a.mv, atk: u.kind === 'worker' ? 9 : a.atk, fl: a.fl, dir, work: u.kind === 'worker' && u.phase === 'work' ? a.work : -1, carry: u.kind === 'worker' && u.load > 0 ? u.carry : null, tool: u.res === 'stone' || u.res === 'metal' ? 'pick' : 'axe' };
      ctx.save();
      ctx.translate(x, y); ctx.scale(dir * s * 1.1, s * 1.1);
      figure(ctx, u.kind, foe, P);
      ctx.restore();
      if (u.hp < u.maxHp) {
        const bw = Math.max(14, s * 0.85 * Math.min(1.5, big)), by = y - s * (2.0 * big + 0.25), k = Math.max(0, u.hp / u.maxHp);
        ctx.fillStyle = 'rgba(10, 5, 10, .6)'; Fx.rrect(ctx, x - bw / 2 - 1, by - 1, bw + 2, 5, 2.5); ctx.fill();
        ctx.fillStyle = foe ? '#ff6a5c' : '#7fdc6a'; Fx.rrect(ctx, x - bw / 2, by, Math.max(3, bw * k), 3, 1.5); ctx.fill();
      }
    }
  }
  function drawCorpses() {
    const s = cam.scale, G = cam.ground;
    fx.corpses = fx.corpses.filter((d) => (d.t += frameDt) < 0.9);
    for (const d of fx.corpses) {
      const x = sx(d.x), y = G + lane(d.id) * s, q = Math.min(1, d.t / 0.35);
      ctx.save();
      ctx.globalAlpha = d.t < 0.5 ? 1 : 1 - (d.t - 0.5) / 0.4;
      ctx.translate(x, y + Math.max(0, d.t - 0.4) * s * 0.8);
      ctx.scale(d.dir * s * 1.1, s * 1.1);
      ctx.rotate(-ease.outQuad(q) * 1.45);
      figure(ctx, d.kind, d.foe, { ph: 0, mv: 0, atk: 9, fl: Math.max(0, 1 - d.t * 4), dir: d.dir, work: -1 });
      ctx.restore();
    }
  }

  // ── Projectiles and impacts ──
  const SHOT_H = { tower: 4.6, keep: 5.2, fort: 7, archer: 1.25, slinger: 1.5, catapult: 1.6 };
  function addShot(e) {
    const kind = e.kind;
    const dur = kind === 'catapult' ? 0.7 : 0.35 + Math.min(0.25, Math.abs(e.to - e.from) * 0.01);
    const h0 = SHOT_H[kind] || 1.3, h1 = e.side === 'foe' && (e.to === F.KEEP_X || kind === 'fort') ? 1.4 : 1.1;
    const arc = kind === 'catapult' ? 5 + Math.abs(e.to - e.from) * 0.12 : kind === 'slinger' ? 1.6 : 0.6 + Math.abs(e.to - e.from) * 0.05;
    fx.shots.push({ from: e.from, to: e.to, kind, foe: e.side === 'foe', t: 0, dur, h0, h1, arc, spin: Math.random() * TAU });
    if (kind === 'catapult') emit(e.from, cam.ground - cam.scale * 1.5, 6, { speed: cam.scale * 2, life: 0.6, size: cam.scale * 0.2, grow: cam.scale * 0.4, color: '#d9c49a', shape: 'smoke', drag: 0.6 });
  }
  const shotPos = (p, k) => [p.from + (p.to - p.from) * k, cam.ground - cam.scale * (p.h0 + (p.h1 - p.h0) * k + p.arc * 4 * k * (1 - k))];
  function drawShots() {
    const s = cam.scale;
    const keep = [];
    for (const p of fx.shots) {
      p.t += running ? frameDt : 0;
      if (p.t >= p.dur) { impact(p); continue; }
      keep.push(p);
      const k = p.t / p.dur, [xm, y] = shotPos(p, k), [xm2, y2] = shotPos(p, Math.max(0, k - 0.18));
      const x = sx(xm), x2 = sx(xm2);
      const ang = Math.atan2(y - y2, x - x2);
      if (p.kind === 'catapult') {
        ctx.strokeStyle = 'rgba(230, 215, 180, .35)'; ctx.lineWidth = s * 0.3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
        Fx.shadow(ctx, x, cam.ground + s * 0.1, s * 0.5, s * 0.15, 0.3);
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.spin + p.t * 9);
        Fx.sphere(ctx, 0, 0, s * 0.4, '#8f8a86', { gloss: false });
        ctx.fillStyle = 'rgba(40, 30, 30, .4)'; ctx.fillRect(-s * 0.15, -s * 0.05, s * 0.12, s * 0.1);
        ctx.restore();
        if (Math.random() < 0.5) particles.emit({ x: wpx(xm), y, vx: 0, vy: -4, life: 0.5, size: s * 0.15, grow: s * 0.3, color: '#cfc2a8', shape: 'smoke', alpha: 0.5 });
      } else if (p.kind === 'slinger') {
        ctx.strokeStyle = 'rgba(255, 230, 200, .35)'; ctx.lineWidth = s * 0.12; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = '#6a6460'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, s * 0.12), 0, TAU); ctx.fill();
      } else {
        const L = Math.max(7, s * 0.8);
        ctx.strokeStyle = p.foe ? 'rgba(255, 150, 120, .35)' : 'rgba(255, 255, 235, .4)'; ctx.lineWidth = Math.max(1, s * 0.07); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = '#6a4424'; ctx.lineWidth = Math.max(1, s * 0.06);
        ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.fillStyle = '#d9dee6'; ctx.beginPath(); ctx.moveTo(L * 0.2, 0); ctx.lineTo(-L * 0.05, -L * 0.1); ctx.lineTo(-L * 0.05, L * 0.1); ctx.fill();
        ctx.fillStyle = p.foe ? '#ff8a6a' : '#f4f0e6';
        ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(-L * 0.78, -L * 0.13); ctx.lineTo(-L * 0.7, 0); ctx.lineTo(-L * 0.78, L * 0.13); ctx.fill();
        ctx.restore();
      }
    }
    fx.shots = keep;
  }
  function impact(p) {
    const s = cam.scale, [xm, y] = shotPos(p, 1);
    if (p.hits) for (const h of p.hits) hitFx(h);
    if (p.kind === 'catapult') {
      emit(xm, y, 10, { speed: s * 4, life: 0.8, size: s * 0.3, grow: s * 0.6, color: '#cbb894', shape: 'smoke', drag: 0.7 });
      emit(xm, y, 8, { speed: s * 7, angle: -Math.PI / 2, spread: 2.6, life: 0.7, size: s * 0.2, colors: ['#8f8a86', '#6a6460', '#b8a888'], shape: 'chunk', gravity: s * 20, spin: 12 });
      particles.emit({ x: wpx(xm), y, life: 0.35, size: s * 0.3, grow: s * 6, color: 'rgba(255, 240, 210, .8)', shape: 'ring' });
      shake.add(0.3);
    } else if (p.kind === 'slinger') {
      emit(xm, y, 4, { speed: s * 2.5, life: 0.4, size: s * 0.12, grow: s * 0.2, color: '#c8b896', shape: 'smoke' });
    } else {
      emit(xm, y, 3, { speed: s * 3, life: 0.3, size: Math.max(1, s * 0.06), color: '#fff2c0', shape: 'spark' });
      emit(xm, y, 2, { speed: s * 1.5, life: 0.4, size: s * 0.1, grow: s * 0.2, color: '#d8ccb0', shape: 'smoke' });
    }
  }

  // ── The frame of the world ──
  let frameDt = 0, running = true;
  function drawWorld(dt, W = g) {
    frameDt = dt;
    const playing = W === g && screen === 'play' && !paused && overlay !== 'build';
    running = playing || W !== g || screen === 'result';
    stepAnims(W, playing ? dt * speed : W === g ? 0 : dt);
    if (Math.random() < 0.02) for (const [k, a] of anims) if (time - a.seen > 3) anims.delete(k);
    if (W === g && fx.end && fx.end.won && fx.end.t < 5 && Math.random() < 0.6) {
      particles.emit({ x: cam.x0 * cam.scale + Math.random() * view.w, y: -6, vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 40, life: 3, size: 5, color: ['#ffd34d', '#ff6a5c', '#6fdc8c', '#7fb8ff', '#ffffff'][(Math.random() * 5) | 0], shape: 'confetti', spin: 8, drag: 0.4, gravity: 20 });
    }
    if (fx.end) fx.end.t += dt;
    drawBackdrop();
    drawTerrain(W);
    drawBridges(W, false);
    drawKeeps(W);
    drawNodes(W);
    W.plots.forEach((p, i) => drawPlot(p, i, W));
    drawCorpses();
    drawFigures(W);
    drawBridges(W, true);
    drawShots();
    ctx.save();
    ctx.translate(-cam.x0 * cam.scale, 0);
    particles.draw(ctx);
    floaters.draw(ctx);
    ctx.restore();
    if (W !== g) return;
    // the ends of the line: arrows to what is off screen
    const my = cam.ground * 0.5, r = 13;
    const chevron = (x, d, col) => {
      ctx.fillStyle = 'rgba(10, 20, 30, .35)'; ctx.beginPath(); ctx.arc(x, my + 2, r, 0, TAU); ctx.fill();
      ctx.fillStyle = withAlpha('#ffffff', 0.85); ctx.beginPath(); ctx.arc(x, my, r, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + d * 5, my); ctx.lineTo(x - d * 3, my - 6); ctx.lineTo(x - d * 3, my + 6); ctx.fill();
    };
    if (cam.x0 > 0.5) chevron(6 + r, -1, '#2c69c9');
    if (cam.x0 + cam.span < W.L - 0.5) chevron(view.w - 6 - r, 1, '#2c69c9');
    const foesOff = W.foes.filter((f) => sx(f.x) > view.w).length;
    if (foesOff) Fx.text(ctx, `${foesOff} ▶`, view.w - 8, my + r + 14, { size: 14, color: '#ff8a7a', align: 'right' });
  }

  // The menu's world: a quiet line with a few buildings and figures walking it.
  const MENU = {
    L: 140, keep: { hp: 1, maxHp: 1 }, fort: { hp: 1, maxHp: 1, towers: 2 }, foes: [], units: [],
    chasms: [{ x0: 64, x1: 72, segments: 2, built: 2, bridged: true, busy: false, work: 0 }],
    nodes: [{ x: 14, res: 'wood' }, { x: 22, res: 'wood' }, { x: 30, res: 'stone' }, { x: 38, res: 'metal' }, { x: 56, res: 'wood' }, { x: 96, res: 'wood' }],
    plots: [{ x: 10, b: { id: 'house', done: true } }, { x: 18, b: { id: 'barracks', done: true } }, { x: 46, b: { id: 'tower', done: true, cd: 0 } }, { x: 52, b: { id: 'wall', done: true, hp: 1, maxHp: 1 } }, { x: 80, b: null }],
  };
  function drawMenuScene(dt) {
    cam = V.camera(view, MENU.L, (time * 3) % 60);
    MENU.units = [0, 1, 2, 3].map((k) => ({ id: -1 - k, kind: k === 3 ? 'worker' : 'soldier', x: 8 + ((time * 1.4 + k * 2.2) % 40), hp: 1, maxHp: 1, cd: 0 }));
    drawWorld(dt, MENU);
  }

  // ───────────── Frame ─────────────
  function frame(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    time += dt;
    if (fx.banner > 0) { fx.banner -= dt; if (fx.banner <= 0) $('banner').hidden = true; }
    shake.update(dt);
    particles.update(dt);
    floaters.update(dt);
    if (screen === 'play' && g && !paused && overlay !== 'build') {
      for (let k = 0; k < speed; k++) F.step(g, dt);
      handle(F.drain(g));
      sinceSave += dt;
      if (sinceSave >= SAVE_EVERY) saveCurrent();
      if (keys.ArrowLeft) cam = V.pan(cam, dt * 400);
      if (keys.ArrowRight) cam = V.pan(cam, -dt * 400);
      if (g.status !== 'playing') finish();
    }
    if (screen === 'result' && g && fx.camTo != null) cam = V.camera(view, g.L, Fx.damp(cam.x0, fx.camTo, 0.9, dt));
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#26381c';
    ctx.fillRect(0, 0, view.w, view.h);
    const so = shake.offset();
    ctx.translate(so.x, so.y);
    if (g) drawWorld(dt);
    else drawMenuScene(dt);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    Fx.vignette(ctx, view.w, view.h, 0.3);
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
