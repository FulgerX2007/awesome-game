'use strict';
// Долгая зима — client: screens, input, sound and the Canvas 2D art of the winter forest. The rules live in core.js
// (window.WinterCore), pure helpers in view.js (window.WinterView).
(() => {
  const C = window.WinterCore;
  const V = window.WinterView;
  const { t } = window.I18n;
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const SAVE_EVERY = 10;

  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Names: chop, mine, step, pick, eat, fire, howl, bite, hit, build, craft, rescue, dawn, win, lose; loops: crackle, wind.
  const Sound = window.WinterAudio;
  const sfx = (name, opts) => Sound.play(name, opts);

  const canvas = $('field');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let save = C.loadSave(storage);
  let g = null;
  let screen = 'menu';    // menu | play | result
  let paused = false;
  let overlay = null;     // build | bench | pause | confirm | null
  let pendingDiff = null;
  let torchMode = false;
  let view = { w: 640, h: 360, dpr: 1 };
  let cam = V.camera(view, null);
  let sinceSave = 0;
  let keys = {};
  let flakes = [];
  let fx = { floats: [], marks: [], banner: 0 };
  let time = 0, last = 0, stepT = 0;
  let darkCanvas = null;

  const RES_NAME = { wood: 'Дерево', stone: 'Камень', metal: 'Металл' };
  const TOOL_NAME = { axe: 'Каменный топор', ironAxe: 'Железный топор', pick: 'Кирка', shovel: 'Лопата', icePick: 'Ледоруб', spear: 'Копьё' };
  const TOOL_DESC = {
    axe: 'Рубить деревья', ironAxe: 'Рубит в полтора раза быстрее', pick: 'Добывать камень', shovel: 'Копать сугробы',
    icePick: 'Ходить по льду озера', spear: 'Охота на оленей, вдвое сильнее против волков',
  };
  const STAGE_NAME = { walls: 'Стены', roof: 'Крыша', door: 'Дверь', stove: 'Печь' };
  const SEGMENT_NAME = ['Частокол: север', 'Частокол: восток', 'Частокол: юг', 'Частокол: запад'];
  const SURVIVOR_ROLE = {
    hunter: 'приносит мясо', carpenter: 'рубит лес и чинит частокол', herbalist: 'собирает ягоды и готовит',
    smith: 'добывает металл и чинит частокол', child: 'подкладывает дрова в огонь',
  };
  const NEED_TEXT = { meat: 'Охотник ждёт: принеси 3 куска мяса', night: 'Травница выходит только днём', palisade: 'Ребёнок пойдёт, когда лагерь будет за частоколом' };

  // ───────────── Canvas size ─────────────
  function resize() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const w = Math.max(200, Math.floor(stage.clientWidth - padX));
    const h = Math.max(160, Math.floor(stage.clientHeight - padY));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    view = { w, h, dpr };
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    darkCanvas = null;
    // flakes at three depths: the near ones bigger and faster
    flakes = Array.from({ length: Math.min(140, Math.round((w * h) / 5500)) }, () => {
      const s = 0.6 + Math.random() * Math.random() * 2.2;
      return { x: Math.random() * w, y: Math.random() * h, s, v: 14 + s * 16 + Math.random() * 10 };
    });
  }

  // ───────────── Saving ─────────────
  function persist() { C.storeSave(storage, save); }
  function saveCurrent() {
    if (!g || g.status !== 'playing') return;
    save.current = C.snapshot(g);
    persist();
    sinceSave = 0;
  }

  // ───────────── Games ─────────────
  function begin(state, diff) {
    g = state || C.newGame(diff, (Date.now() % 1e9) >>> 0);
    screen = 'play';
    paused = false;
    overlay = null;
    torchMode = false;
    fx = { floats: [], marks: [], banner: 0 };
    camFocus = null;
    last = 0; // the first frame of a winter starts the clock afresh
    parts.clear();
    floaters.list = [];
    steps = [];
    show(null);
    $('hud').hidden = false;
    $('hint').hidden = false;
    $('actionbar').hidden = false;
    if (!state) { save.current = C.snapshot(g); save.dawn = save.current; persist(); }
    renderHUD();
    banner(t('День {n}', { n: C.dayOf(g) }), 1.6);
    canvas.focus({ preventScroll: true });
  }

  function startDiff(diff) {
    Sound.unlock();
    if (save.current) { pendingDiff = diff; overlay = 'confirm'; show('confirm'); $('btn-confirm-no').focus(); return; }
    begin(null, diff);
  }

  function finish() {
    const won = g.status === 'won';
    C.recordGame(save, g);
    save.current = null;
    if (won) save.dawn = null;
    persist(); // the records land the moment the winter ends
    sfx(won ? 'win' : 'lose');
    Sound.setLoop('crackle', 0);
    Sound.setLoop('wind', 0);
    screen = 'result';
    overlay = null;
    $('actionbar').hidden = true;
    const st = C.stars(g);
    const title = $('res-title');
    title.textContent = won ? t('Весна!') : t('Зима победила');
    title.classList.toggle('won', won);
    title.classList.toggle('lost', !won);
    $('res-stars').textContent = won ? '★'.repeat(st) + '☆'.repeat(3 - st) : '';
    const alive = g.survivors.filter((s) => s.state === 'home').length;
    $('res-main').textContent = won ? t('Ты пережил зиму. Спасено: {n} из 5.', { n: alive }) : t('День {n}: герой не выдержал.', { n: C.dayOf(g) });
    $('res-note').textContent = t('Хижина: {s} из 4 · постройки частокола: {p} из 4', { s: g.hut.stage, p: g.palisade.filter((p) => p.built).length });
    $('btn-res-retry').hidden = won || !save.dawn;
    show('result');
    (won ? $('btn-res-again') : $('btn-res-retry')).focus({ preventScroll: true });
  }

  // ───────────── Effects ─────────────
  function banner(text, seconds = 1.8) {
    const b = $('banner');
    b.textContent = text;
    b.hidden = false;
    fx.banner = seconds;
  }
  const float = (x, y, text, color) => floaters.add(text, x * cam.ts, y * cam.ts, { color, size: 16, life: 1.1, rise: 30 });

  function handle(events) {
    for (const e of events) {
      effects(e);
      switch (e.type) {
        case 'gather':
          if (e.kind === 'tree') sfx('chop');
          else if (e.kind === 'rock') sfx('mine');
          else sfx('pick');
          float(e.x + 0.5, e.y, `+${e.n}`, e.item === 'wood' ? '#d9a35b' : e.item === 'stone' ? '#c8ccd2' : e.item === 'metal' ? '#e7eef5' : '#ff7a6a');
          break;
        case 'fish': float(e.x + 0.5, e.y, '+1', '#9fd0ff'); sfx('pick'); break;
        case 'hunt':
          float(e.x, e.y - 0.5, e.kind === 'deer' ? '+3' : '+1', '#ff9a8a');
          if (e.kind === 'deer') float(e.x, e.y - 1.1, t('+1 шкура'), '#d9a86c');
          sfx('hit');
          break;
        case 'hitWolf': sfx('hit'); break;
        case 'wolfDead': float(e.x, e.y - 0.5, t('Волк убит'), '#cfe0ff'); break;
        case 'feed': sfx('fire'); break;
        case 'cook': sfx('fire'); break;
        case 'eat': sfx('eat'); break;
        case 'craft': sfx('craft'); banner(t('Готово: {tool}', { tool: t(TOOL_NAME[e.tool]) })); break;
        case 'built': sfx('build'); break;
        case 'torch': sfx('fire'); break;
        case 'dig': sfx('step'); break;
        case 'howl': sfx('howl'); banner(t('Ночь. Волки вышли на охоту')); break;
        case 'bite': sfx('bite'); if (e.who === 'hero') fx.hurt = 0.3; break;
        case 'gnaw': break;
        case 'palisadeBroken': banner(t('Волки прогрызли частокол!')); break;
        case 'needs': banner(t(NEED_TEXT[e.need] || 'Пока не пойдёт'), 2.4); break;
        case 'rescue': sfx('rescue'); banner(t('{name} идёт за тобой', { name: t(C.SURVIVORS[e.id].name) }), 2.2); break;
        case 'joined': banner(t('{name} в лагере: {role}', { name: t(C.SURVIVORS[e.id].name), role: t(SURVIVOR_ROLE[e.id]) }), 2.6); break;
        case 'died': banner(t('{name} не пережил холода', { name: t(C.SURVIVORS[e.id].name) }), 2.6); break;
        case 'fireOut': banner(t('Костёр погас')); break;
        case 'sleep': break;
        case 'dawn':
          sfx('dawn');
          banner(e.blizzard ? t('День {n}. Метель!', { n: e.day }) : t('День {n}', { n: e.day }));
          // the dawn save point for «Начать день заново»
          save.dawn = C.snapshot(g);
          saveCurrent();
          break;
        default: break;
      }
    }
  }

  // ───────────── HUD ─────────────
  function renderHUD() {
    if (!g) return;
    const h = g.hero;
    for (const k of ['warmth', 'food', 'energy', 'health']) {
      $(`bar-${k}`).style.width = `${h[k]}%`;
      $(`bar-${k}`).parentElement.classList.toggle('low', h[k] < 25);
    }
    $('hud-day').textContent = t('День {n} · {clock}', { n: C.dayOf(g), clock: V.clock(g) });
    for (const r of C.RES) $(`res-${r}`).textContent = String(Math.floor(g.stock[r]));
    $('res-food').textContent = String(C.foodTotal(g));
    const task = C.nextTask(g);
    const rescueOf = /^Спаси выжившего: (.+)$/.exec(task);
    $('hint').textContent = torchMode ? t('Нажми, где поставить факел')
      : rescueOf ? t('Спаси выжившего: {name}', { name: t(rescueOf[1]) }) : t(task);
    $('btn-pause').textContent = paused ? t('Дальше') : t('Пауза');
    const a = actionTarget();
    $('btn-act').textContent = a ? t(a.label) : t('Действие');
  }

  // What the action button (E) would do: the nearest thing next to the hero.
  function actionTarget() {
    if (!g) return null;
    const h = g.hero, hx = Math.floor(h.x), hy = Math.floor(h.y);
    let best = null, bd = Infinity;
    const consider = (x, y, label) => {
      const d = Math.hypot(x + 0.5 - h.x, y + 0.5 - h.y);
      if (d <= 1.6 && d < bd) { bd = d; best = { x, y, label }; }
    };
    for (const w of g.wolves) consider(Math.floor(w.x), Math.floor(w.y), 'Бить волка');
    for (let y = hy - 1; y <= hy + 1; y++) for (let x = hx - 1; x <= hx + 1; x++) {
      const n = C.nodeAt(g, x, y);
      if (n) consider(x, y, { tree: 'Рубить', rock: 'Добыть камень', bush: 'Собрать ягоды', scrap: 'Взять железо' }[n.kind]);
      if (C.inMap(x, y) && g.tiles[C.idx(x, y)] === 'o') consider(x, y, 'Рыбачить');
    }
    for (const a of g.animals) consider(Math.floor(a.x), Math.floor(a.y), 'Охота');
    for (const s of g.survivors) if (s.state === 'waiting') consider(Math.floor(s.x), Math.floor(s.y), 'Позвать');
    consider(C.SPOT.fire.x, C.SPOT.fire.y, 'К костру');
    if (g.hut.stage >= 2) consider(C.SPOT.bed.x, C.SPOT.bed.y, 'Спать');
    return best;
  }

  function act() {
    if (!g || screen !== 'play' || paused || overlay) return;
    const a = actionTarget();
    if (a) tap(a.x, a.y);
  }

  function tap(x, y) {
    if (torchMode) {
      torchMode = false;
      if (!C.placeTorch(g, x, y)) banner(t('Здесь факел не поставить'));
      handle(C.drain(g));
      return;
    }
    const r = C.interact(g, x, y);
    if (r === 'tool') {
      const n = C.nodeAt(g, x, y);
      banner(n ? (n.kind === 'rock' ? t('Нужна кирка (верстак)') : t('Нужен топор')) : t('Нужно копьё (верстак)'));
    } else if (r === 'none') {
      banner(t('Туда не пройти'), 1);
    } else {
      fx.marks.push({ x: x + 0.5, y: y + 0.5, t: 0 });
    }
    handle(C.drain(g));
  }

  function eat() {
    if (!g || screen !== 'play') return;
    const item = C.eat(g);
    if (!item) banner(g.hero.food >= C.STAT_MAX - 2 ? t('Ты сыт') : t('Еды нет'), 1.2);
    handle(C.drain(g));
    renderHUD();
  }

  // ───────────── Panels ─────────────
  const costText = (cost, paid = {}) => Object.keys(cost).map((k) => `${Math.max(0, cost[k] - (paid[k] || 0))} ${t(RES_NAME[k]).toLowerCase()}`).join(', ');

  function openBuild() {
    if (!g || screen !== 'play') return;
    overlay = 'build';
    renderBuild();
    show('build');
  }

  function renderBuild() {
    const list = $('build-list');
    list.innerHTML = '';
    const away = !C.atBase(g);
    $('build-lead').textContent = away ? t('Строить можно только в лагере.') : t('Вноси, что есть: постройка достраивается по частям.');
    const rows = [];
    if (g.hut.stage < C.HUT_STAGES.length) {
      const st = C.HUT_STAGES[g.hut.stage];
      rows.push({ id: 'hut', name: t('Хижина: {stage}', { stage: t(STAGE_NAME[st.id]) }), desc: costText(st.cost, g.hut.paid) });
    } else rows.push({ id: null, name: t('Хижина'), desc: t('Готова: печь греет, пока в ней дрова') });
    g.palisade.forEach((p, i) => {
      const need = C.needOf(g, `palisade:${i}`);
      rows.push({ id: need ? `palisade:${i}` : null, name: t(SEGMENT_NAME[i]), desc: need ? (p.built ? t('Починить: {cost}', { cost: costText(need.cost, need.paid) }) : costText(need.cost, need.paid)) : t('Стоит') });
    });
    g.bunks.forEach((b, i) => {
      rows.push({ id: b.built ? null : `bunk:${i}`, name: t('Нары {n}', { n: i + 1 }), desc: b.built ? t('Готовы: двое спят в тепле') : costText(C.BUNK_COST, b.paid) });
    });
    rows.push({ id: 'torch', name: t('Факел'), desc: t('{n} дерева, отгоняет волков. Стоит: {k} из {m}', { n: C.TORCH.cost, k: g.torches.length, m: C.TORCH.max }) });
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<b>${r.name}</b><small>${r.desc}</small>`;
      if (r.id) {
        const acts = document.createElement('div');
        acts.className = 'acts';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = r.id === 'torch' ? t('Поставить') : t('Внести');
        b.disabled = r.id === 'torch' ? g.torches.length >= C.TORCH.max || g.stock.wood < C.TORCH.cost : away;
        b.addEventListener('click', () => {
          if (r.id === 'torch') { torchMode = true; closeOverlay(); renderHUD(); return; }
          const res = C.contribute(g, r.id);
          if (res === 'nores') banner(t('Нечего внести'), 1.2);
          handle(C.drain(g));
          renderBuild();
          renderHUD();
          saveCurrent();
        });
        acts.append(b);
        row.append(acts);
      }
      list.append(row);
    }
  }

  function openBench() {
    if (!g || screen !== 'play') return;
    overlay = 'bench';
    renderBench();
    show('bench');
  }

  function renderBench() {
    const list = $('bench-list');
    list.innerHTML = '';
    const away = !C.atBase(g);
    $('bench-lead').textContent = away ? t('Верстак стоит в лагере.') : t('Инструменты открывают новые места и работу.');
    for (const id of Object.keys(C.TOOLS)) {
      const have = g.tools[id];
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<b>${t(TOOL_NAME[id])}</b><small>${t(TOOL_DESC[id])} · ${have ? t('есть') : costText(C.TOOLS[id].cost)}</small>`;
      if (!have) {
        const acts = document.createElement('div');
        acts.className = 'acts';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = t('Сделать');
        b.disabled = away || !C.afford(g, C.TOOLS[id].cost);
        b.addEventListener('click', () => { C.craft(g, id); handle(C.drain(g)); renderBench(); renderHUD(); saveCurrent(); });
        acts.append(b);
        row.append(acts);
      }
      list.append(row);
    }
  }

  function closeOverlay() {
    overlay = null;
    if (screen === 'play') show(paused ? 'pause' : null);
    canvas.focus({ preventScroll: true });
  }

  // ───────────── Screens ─────────────
  const SCREENS = ['menu', 'confirm', 'build', 'bench', 'result', 'pause'];
  function show(name) {
    for (const id of SCREENS) $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name && !['pause', 'build', 'bench'].includes(name));
  }

  function showMenu() {
    if (g && screen === 'play') saveCurrent();
    screen = 'menu';
    g = null;
    overlay = null;
    paused = false;
    torchMode = false;
    $('hud').hidden = true;
    $('hint').hidden = true;
    $('actionbar').hidden = true;
    $('banner').hidden = true;
    Sound.setLoop('crackle', 0);
    Sound.setLoop('wind', 0);
    const cur = save.current;
    $('btn-continue').hidden = !cur;
    if (cur) $('btn-continue').textContent = t('Продолжить: день {n}', { n: Math.floor(cur.t / C.DAY) + 1 });
    $('btn-harsh').disabled = !save.unlocked;
    $('btn-harsh').title = save.unlocked ? '' : t('Откроется после первой весны');
    const lines = [];
    for (const k of ['normal', 'harsh']) {
      const b = save.best[k];
      if (!b) continue;
      const name = k === 'normal' ? t('Обычная зима') : t('Лютая зима');
      lines.push(b > C.DAYS ? t('{name}: пережита, звёзд {s} из 3', { name, s: save.stars[k] }) : t('{name}: дней прожито — {n}', { name, n: b }));
    }
    $('records').textContent = lines.join('\n');
    renderSound();
    show('menu');
    (cur ? $('btn-continue') : $('btn-normal')).focus({ preventScroll: true });
  }

  function togglePause() {
    if (screen !== 'play') return;
    paused = !paused;
    overlay = paused ? 'pause' : null;
    show(paused ? 'pause' : null);
    if (paused) saveCurrent();
    renderHUD();
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
  // A three-quarter view on the same ground grid: the snow, the lake and the camp ground are baked into chunks once;
  // trees, rocks, the hut, the palisade and everyone alive stand up from their ground cell, sorted by y, so the hero
  // walks behind a tree or in front of it. The light comes from the top left (Fx.LIGHT); shadows fall to the lower
  // right. Taps still hit the ground cell under the finger (view.js), whatever stands on it.
  const K = window.Fx;
  const P = (x, y) => V.toScreen(cam, x, y);
  const SPR_DPR = () => Math.min(2, view.dpr);
  const hash = (x, y, s = 0) => {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const tileOf = (x, y) => (C.inMap(x, y) ? g.tiles[C.idx(x, y)] : '.');
  const isIce = (c) => c === '~' || c === 'o';

  let camFocus = null;      // the smoothed point the camera follows
  const parts = new K.Particles(240);
  const floaters = new K.Floaters();
  const shake = new K.Shake(7, 2.2);
  let steps = [];           // the hero's footprints: { x, y, a, side, t }
  let stepAcc = 0, lastHero = null;
  const anim = new WeakMap(); // per entity: facing, walk phase
  const nodeHit = new Map();  // node id → time of the last hit (a tree shivers)
  const pops = {};            // building key → time it last grew (pop-in)

  // ── Cached sprites ──
  // Every static shape is painted once into a small canvas per tile size and stretched with drawImage.
  const sprites = new Map();
  function sprite(key, wT, hT, axT, ayT, paint) {
    const ts = cam.ts, k = SPR_DPR();
    const id = `${key}|${ts}|${k}`;
    let s = sprites.get(id);
    if (s) return s;
    const w = Math.ceil(wT * ts), h = Math.ceil(hT * ts);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * k)); cv.height = Math.max(1, Math.ceil(h * k));
    const c = cv.getContext('2d');
    c.setTransform(k, 0, 0, k, axT * ts * k, ayT * ts * k);
    paint(c, ts);
    s = { cv, w, h, ax: axT * ts, ay: ayT * ts };
    sprites.set(id, s);
    if (sprites.size > 360) sprites.delete(sprites.keys().next().value);
    return s;
  }
  const blit = (s, x, y, sc = 1) => ctx.drawImage(s.cv, x - s.ax * sc, y - s.ay * sc, s.w * sc, s.h * sc);
  // A soft round dot of a colour (snow lumps, warm ground, flakes).
  const dot = (color) => K.bake('wdot|' + color, 64, (c, s) => {
    const p = K.parse(color);
    const grd = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, `rgba(${p[0]},${p[1]},${p[2]},1)`);
    grd.addColorStop(0.5, `rgba(${p[0]},${p[1]},${p[2]},.55)`);
    grd.addColorStop(1, `rgba(${p[0]},${p[1]},${p[2]},0)`);
    c.fillStyle = grd;
    c.fillRect(0, 0, s, s);
  });
  function soft(c, color, x, y, rx, ry, a) {
    const ga = c.globalAlpha;
    c.globalAlpha = ga * a;
    c.drawImage(dot(color), x - rx, y - ry, rx * 2, ry * 2);
    c.globalAlpha = ga;
  }
  // A soft shadow cast to the lower right: a contact patch plus a longer patch away from the light.
  function castShadow(c, x, y, rx, len, a = 0.3) {
    K.shadow(c, x + rx * 0.1, y, rx, rx * 0.36, a);
    c.save();
    c.translate(x + len * 0.42, y + len * 0.16);
    c.rotate(0.32);
    K.shadow(c, 0, 0, len * 0.62, rx * 0.42, a * 0.7);
    c.restore();
  }
  function lin(c, x0, y0, x1, y1, stops) {
    const grd = c.createLinearGradient(x0, y0, x1, y1);
    for (const [o, col] of stops) grd.addColorStop(o, col);
    return grd;
  }
  function ell(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); }

  // ── Trees ──
  // A layered snowy fir: a trunk, three or four drooping tiers lit from the left with snow lying on each.
  function paintTree(c, u, v) {
    const s = u * v.s;
    c.fillStyle = lin(c, -s * 0.09, 0, s * 0.09, 0, [[0, '#8a6442'], [0.5, '#5e3f25'], [1, '#33210f']]);
    K.rrect(c, -s * 0.085, -s * 0.42, s * 0.17, s * 0.44, s * 0.04);
    c.fill();
    const n = v.tiers;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const w = s * (0.6 - k * 0.36) * v.wide;
      const yb = -s * (0.3 + k * (v.tall - 0.55));
      const ht = s * (0.64 - k * 0.12);
      const top = yb - ht;
      if (i > 0) { c.fillStyle = 'rgba(6, 26, 20, .35)'; ell(c, s * 0.03, yb + s * 0.05, w * 1.05, s * 0.08); c.fill(); }
      // the needles
      c.beginPath();
      c.moveTo(0, top);
      c.quadraticCurveTo(-w * 0.4, yb - ht * 0.42, -w, yb);
      const bumps = 4;
      for (let b = 0; b < bumps; b++) {
        const x0 = -w + (2 * w * b) / bumps, x1 = -w + (2 * w * (b + 1)) / bumps;
        c.quadraticCurveTo((x0 + x1) / 2, yb + s * 0.075, x1, yb);
      }
      c.quadraticCurveTo(w * 0.4, yb - ht * 0.42, 0, top);
      c.closePath();
      c.fillStyle = lin(c, -w, top, w, yb, [[0, v.lit], [0.45, v.mid], [1, v.dark]]);
      c.fill();
      // a darker underside and a rim of light on the left edge
      c.save();
      c.clip();
      c.fillStyle = 'rgba(4, 22, 16, .3)';
      ell(c, w * 0.25, yb + s * 0.02, w * 0.95, s * 0.12); c.fill();
      c.strokeStyle = 'rgba(190, 240, 210, .18)';
      c.lineWidth = s * 0.05;
      c.beginPath(); c.moveTo(0, top); c.quadraticCurveTo(-w * 0.4, yb - ht * 0.42, -w, yb); c.stroke();
      c.restore();
      // the snow on the tier: thick on top and on the lit side, dripping down in tongues
      const sn = v.snow * (0.85 + k * 0.25);
      const sy = top + ht * 0.62 * sn;
      c.beginPath();
      c.moveTo(0, top - s * 0.02);
      c.quadraticCurveTo(-w * 0.32, top + ht * 0.3, -w * 0.82 * sn, sy + ht * 0.08);
      const drips = 3;
      for (let d = 0; d < drips; d++) {
        const x0 = -w * 0.82 * sn + (w * 1.45 * sn * d) / drips, x1 = -w * 0.82 * sn + (w * 1.45 * sn * (d + 1)) / drips;
        const deep = d === 0 ? 0.16 : d === 1 ? 0.07 : 0.11;
        c.quadraticCurveTo((x0 + x1) / 2, sy + ht * deep + s * 0.04, x1, sy - ht * 0.03 * d);
      }
      c.quadraticCurveTo(w * 0.3, top + ht * 0.28, 0, top - s * 0.02);
      c.closePath();
      c.fillStyle = lin(c, -w * 0.6, top, w * 0.6, sy, [[0, '#ffffff'], [0.55, '#eaf2fb'], [1, '#b9cbe3']]);
      c.fill();
      c.strokeStyle = 'rgba(120, 150, 190, .35)';
      c.lineWidth = Math.max(0.6, s * 0.012);
      c.stroke();
    }
    // a glint of light on the very top
    c.fillStyle = 'rgba(255, 255, 255, .9)';
    const tTop = -s * (0.3 + (v.tall - 0.55)) - s * 0.52;
    ell(c, -s * 0.03, tTop + s * 0.06, s * 0.05, s * 0.035, -0.5); c.fill();
  }
  const TREE_VARIANTS = [
    { s: 1.1, tiers: 3, wide: 1.22, tall: 1.5, snow: 0.95, lit: '#4f9a6c', mid: '#2c6847', dark: '#163d2b' },
    { s: 1.16, tiers: 4, wide: 1.12, tall: 1.7, snow: 0.85, lit: '#4a9268', mid: '#285f42', dark: '#123525' },
    { s: 1.04, tiers: 3, wide: 1.3, tall: 1.42, snow: 1.05, lit: '#5aa070', mid: '#326f4a', dark: '#1a4430' },
    { s: 1.12, tiers: 4, wide: 1.2, tall: 1.6, snow: 0.95, lit: '#4b8f73', mid: '#28614e', dark: '#133a31' },
  ];
  const treeSprite = (i) => sprite('tree' + i, 2.1, 2.9, 1.05, 2.72, (c, u) => paintTree(c, u, TREE_VARIANTS[i]));
  const treeShadow = (i) => sprite('treeSh' + i, 2.4, 1.1, 0.6, 0.35, (c, u) => castShadow(c, 0, 0.12 * u, 0.4 * u * TREE_VARIANTS[i].s, 1.25 * u * TREE_VARIANTS[i].s, 0.32));

  const stumpSprite = () => sprite('stump', 1, 0.8, 0.5, 0.6, (c, u) => {
    K.cylinder(c, 0, -u * 0.16, u * 0.17, u * 0.2, '#6e4a2c', { capColor: '#d8b47e', ry: u * 0.07 });
    c.strokeStyle = 'rgba(120, 80, 40, .6)'; c.lineWidth = 0.8;
    ell(c, 0, -u * 0.16, u * 0.09, u * 0.035); c.stroke();
    c.fillStyle = '#f5f9ff';
    ell(c, -u * 0.03, -u * 0.185, u * 0.11, u * 0.04); c.fill();
    c.fillStyle = 'rgba(255,255,255,.9)';
    ell(c, u * 0.18, 0, u * 0.12, u * 0.05); c.fill();
  });

  // ── Rocks, scrap, bushes, drifts ──
  function paintRock(c, u, seed) {
    const stones = [[0, -0.27, 0.34, 0.85], [-0.27, -0.1, 0.19, 0.8], [0.26, -0.08, 0.16, 0.8]];
    stones.sort((a, b) => a[1] - b[1]);
    for (const [x0, y0, r0, sq] of stones) {
      const x = (x0 + (hash(seed, x0 * 10) - 0.5) * 0.06) * u, y = y0 * u, r = r0 * u * (0.9 + hash(seed, r0 * 10) * 0.2);
      c.save();
      c.translate(x, y);
      c.scale(1, sq);
      // an irregular boulder: a lit sphere clipped by a few flat facets
      c.beginPath();
      const pts = 7;
      for (let k = 0; k <= pts; k++) {
        const a = (k / pts) * TAU, rr = r * (0.88 + hash(seed + k, r0 * 31) * 0.18);
        c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath();
      c.save();
      c.clip();
      K.sphere(c, 0, 0, r * 1.05, '#8e98a8', { gloss: false, shine: 0.45 });
      c.fillStyle = 'rgba(255,255,255,.12)';
      c.beginPath(); c.moveTo(-r, -r * 0.2); c.lineTo(r * 0.1, -r); c.lineTo(-r, -r); c.fill();
      c.strokeStyle = 'rgba(40, 46, 66, .35)'; c.lineWidth = Math.max(0.7, u * 0.02);
      c.beginPath(); c.moveTo(r * 0.1, -r * 0.1); c.lineTo(r * 0.35, r * 0.35); c.lineTo(r * 0.25, r * 0.7); c.stroke();
      // the snow cap
      c.fillStyle = lin(c, -r, -r, r, 0, [[0, '#ffffff'], [0.6, '#eef4fb'], [1, '#c4d4e8']]);
      c.beginPath();
      c.moveTo(-r * 1.1, -r * 0.25);
      c.quadraticCurveTo(-r * 0.6, -r * 0.05, -r * 0.2, -r * 0.3);
      c.quadraticCurveTo(r * 0.2, -r * 0.1, r * 0.6, -r * 0.45);
      c.quadraticCurveTo(r * 0.9, -r * 0.4, r * 1.1, -r * 0.6);
      c.lineTo(r * 1.1, -r * 1.2); c.lineTo(-r * 1.1, -r * 1.2);
      c.closePath(); c.fill();
      c.restore();
      c.restore();
    }
  }
  const rockSprite = (v) => sprite('rock' + v, 1.6, 1.4, 0.8, 1.1, (c, u) => { c.scale(1.3, 1.3); paintRock(c, u, v * 17 + 3); });
  const lowShadow = (key, rx, len) => sprite(`lsh${key}|${rx.toFixed(2)}|${len.toFixed(2)}`, 2, 1, 0.7, 0.4, (c, u) => castShadow(c, 0, 0.1 * u, rx * u, len * u, 0.3));

  const scrapSprite = () => sprite('scrap', 1.4, 1.1, 0.7, 0.8, (c, u) => {
    // a half-buried rusty barrel, a bent plate and a steel bar
    c.save(); c.translate(-u * 0.12, -u * 0.12); c.rotate(-0.25);
    K.prism(c, -u * 0.32, -u * 0.08, u * 0.5, u * 0.18, u * 0.12, '#7c6f6a', { r: u * 0.03 });
    c.restore();
    K.cylinder(c, u * 0.14, -u * 0.42, u * 0.17, u * 0.36, '#9a4f2a', { capColor: '#6a3a22', ry: u * 0.06 });
    c.strokeStyle = 'rgba(40, 20, 10, .45)'; c.lineWidth = Math.max(1, u * 0.03);
    c.beginPath(); c.moveTo(u * -0.03, -u * 0.3); c.lineTo(u * 0.31, -u * 0.3); c.moveTo(u * -0.03, -u * 0.16); c.lineTo(u * 0.31, -u * 0.16); c.stroke();
    K.metalBar(c, -u * 0.38, -u * 0.02, u * 0.3, -u * 0.22, Math.max(2, u * 0.08), '#aab4c2');
    c.fillStyle = '#f6faff';
    ell(c, u * 0.1, -u * 0.43, u * 0.12, u * 0.04); c.fill();
    ell(c, -u * 0.2, -u * 0.2, u * 0.12, u * 0.035, -0.25); c.fill();
    c.fillStyle = 'rgba(255,255,255,.95)';
    ell(c, 0, 0.02 * u, u * 0.42, u * 0.08); c.fill();
  });

  const bushSprite = (v) => sprite('bush' + v, 1.2, 1, 0.6, 0.78, (c, u) => {
    const balls = [[-0.2, -0.2, 0.2], [0.2, -0.2, 0.19], [0, -0.33, 0.22], [-0.05, -0.12, 0.2]];
    for (const [x, y, r] of balls) K.sphere(c, (x + (hash(v, x * 9) - 0.5) * 0.05) * u, y * u, r * u, v ? '#3f7a4c' : '#467a3c', { gloss: false, shine: 0.35 });
    c.fillStyle = 'rgba(10, 30, 16, .25)';
    for (let k = 0; k < 9; k++) { ell(c, (hash(v, k) - 0.5) * 0.6 * u, (-0.1 - hash(k, v) * 0.35) * u, u * 0.03, u * 0.02); c.fill(); }
    c.fillStyle = lin(c, -u * 0.3, -u * 0.55, u * 0.3, -u * 0.3, [[0, '#ffffff'], [1, '#d3e0ef']]);
    c.beginPath();
    c.moveTo(-u * 0.36, -u * 0.27);
    c.quadraticCurveTo(-u * 0.25, -u * 0.5, 0, -u * 0.55);
    c.quadraticCurveTo(u * 0.28, -u * 0.5, u * 0.36, -u * 0.3);
    c.quadraticCurveTo(u * 0.2, -u * 0.36, u * 0.08, -u * 0.32);
    c.quadraticCurveTo(-u * 0.05, -u * 0.4, -u * 0.18, -u * 0.31);
    c.quadraticCurveTo(-u * 0.28, -u * 0.25, -u * 0.36, -u * 0.27);
    c.fill();
  });
  const berrySprite = () => sprite('berry', 0.2, 0.2, 0.1, 0.1, (c, u) => K.sphere(c, 0, 0, u * 0.055, '#d8283a', { shine: 0.7 }));
  const BERRIES = [[-0.2, -0.2], [0.17, -0.24], [0.02, -0.12], [-0.08, -0.3], [0.22, -0.12]];

  const driftSprite = (v) => sprite('drift' + v, 1.6, 1.2, 0.8, 0.85, (c, u) => {
    const h = (0.42 + v * 0.06) * u, w = 0.68 * u;
    c.beginPath();
    c.moveTo(-w, 0.05 * u);
    c.bezierCurveTo(-w * 0.9, -h * 0.9, -w * 0.25, -h * 1.15, w * 0.1, -h);
    c.bezierCurveTo(w * 0.55, -h * 0.9, w * 0.95, -h * 0.4, w, 0.05 * u);
    c.quadraticCurveTo(0, 0.2 * u, -w, 0.05 * u);
    c.fillStyle = lin(c, -w * 0.6, -h, w * 0.7, 0.1 * u, [[0, '#ffffff'], [0.45, '#eef4fb'], [1, '#aec3de']]);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = Math.max(1, u * 0.03);
    c.beginPath(); c.moveTo(-w * 0.75, -h * 0.55); c.bezierCurveTo(-w * 0.6, -h * 0.95, -w * 0.2, -h * 1.05, w * 0.1, -h * 0.95); c.stroke();
    c.strokeStyle = 'rgba(130, 160, 200, .35)'; c.lineWidth = Math.max(0.7, u * 0.02);
    c.beginPath(); c.moveTo(w * 0.15, -h * 0.55); c.quadraticCurveTo(w * 0.5, -h * 0.45, w * 0.7, -h * 0.1); c.stroke();
  });

  // ── The ground: chunks of 8 × 8 tiles baked once per game and tile size ──
  const CH = 8;
  const chunks = new Map();
  function smooth(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx0 = x - xi, fy0 = y - yi;
    const sx = fx0 * fx0 * (3 - 2 * fx0), sy = fy0 * fy0 * (3 - 2 * fy0);
    const a = hash(xi, yi, 7), b = hash(xi + 1, yi, 7), c = hash(xi, yi + 1, 7), d = hash(xi + 1, yi + 1, 7);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  function paintGround(c, u, X0, Y0) {
    // c's origin is the world point (X0, Y0); u px per tile
    const P0 = (x, y) => [(x - X0) * u, (y - Y0) * u];
    c.fillStyle = '#e8eff8';
    c.fillRect(0, 0, CH * u, CH * u);
    const xa = X0 - 2, xb = X0 + CH + 1, ya = Y0 - 2, yb = Y0 + CH + 1;
    // big soft swells of light and shade
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const n = smooth(x / 3.2, y / 3.2), [px, py] = P0(x + 0.5, y + 0.5);
      if (n > 0.5) soft(c, '#fbfdff', px, py, u * 1.5, u * 1.2, (n - 0.5) * 1.1);
      else soft(c, '#c9d8ea', px, py, u * 1.5, u * 1.2, (0.5 - n) * 0.9);
    }
    // the camp: trodden, warmer snow and the thawed ring around the fire
    for (let y = Math.max(ya, C.BASE.y0); y <= Math.min(yb, C.BASE.y1); y++) for (let x = Math.max(xa, C.BASE.x0); x <= Math.min(xb, C.BASE.x1); x++) {
      const [px, py] = P0(x + 0.5, y + 0.5);
      soft(c, '#e0d6ca', px + (hash(x, y, 3) - 0.5) * u, py + (hash(x, y, 4) - 0.5) * u, u * 1.1, u * 0.9, 0.22);
    }
    {
      const [px, py] = P0(C.SPOT.fire.x + 0.5, C.SPOT.fire.y + 0.55);
      soft(c, '#a88f74', px, py, u * 1.5, u * 1.15, 0.55);
      soft(c, '#6b5442', px, py, u * 0.8, u * 0.6, 0.6);
    }
    // per tile: the lake, holes, deep snow, wind ripples and glitter
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const t = tileOf(x, y), [px, py] = P0(x, y), h = hash(x, y);
      if (isIce(t)) continue;
      if (t === ':') {
        soft(c, '#c3d3e8', px + u / 2, py + u / 2, u * 0.9, u * 0.8, 0.5);
        for (let k = 0; k < 2; k++) {
          const mx = px + (0.25 + hash(x, y, k + 10) * 0.5) * u, my = py + (0.3 + hash(x, y, k + 20) * 0.45) * u, r = u * (0.32 + hash(x, y, k + 30) * 0.14);
          soft(c, '#9fb6d4', mx + r * 0.3, my + r * 0.25, r * 1.2, r * 0.75, 0.4);
          soft(c, '#ffffff', mx - r * 0.15, my - r * 0.12, r * 1.05, r * 0.7, 0.95);
        }
        continue;
      }
      if (h < 0.16) {
        // a little wind-blown drift: a soft lit crest with its blue shade on the far side
        const mx = px + (0.2 + hash(x, y, 5) * 0.6) * u, my = py + (0.2 + hash(x, y, 6) * 0.6) * u, r = u * (0.3 + hash(x, y, 8) * 0.25);
        soft(c, '#b4c8e2', mx + r * 0.25, my + r * 0.18, r * 1.1, r * 0.38, 0.55);
        soft(c, '#ffffff', mx - r * 0.15, my - r * 0.1, r * 1.0, r * 0.32, 0.9);
      }
      if (h > 0.55) {
        c.fillStyle = 'rgba(255,255,255,.95)';
        const k = 1 + Math.floor(hash(x, y, 9) * 3);
        for (let j = 0; j < k; j++) c.fillRect(px + hash(x, y, 40 + j) * u, py + hash(x, y, 50 + j) * u, Math.max(1, u * 0.04), Math.max(1, u * 0.04));
      }
    }
    // the ice: one clip over every ice tile, then a world-space gradient, deep patches and glossy bands
    c.save();
    c.beginPath();
    let anyIce = false;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (isIce(tileOf(x, y))) { const [px, py] = P0(x, y); c.rect(px, py, u, u); anyIce = true; }
    if (anyIce) {
      c.clip();
      const [ax, ay] = P0(43, 1), [bx, by] = P0(56, 22);
      c.fillStyle = lin(c, ax, ay, bx, by, [[0, '#c6e8fa'], [0.45, '#8fc3e8'], [1, '#6ba3d6']]);
      c.fillRect(0, 0, CH * u, CH * u);
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        if (!isIce(tileOf(x, y))) continue;
        const n = smooth(x / 2.5 + 9, y / 2.5), [px, py] = P0(x + 0.5, y + 0.5);
        soft(c, n > 0.5 ? '#e4f5fe' : '#4f8cc6', px, py, u * 1.3, u * 1.0, Math.abs(n - 0.5) * 1.2);
      }
      for (let i = 0; i < 14; i++) {
        const bx0 = 36 + i * 1.9 + hash(i, 1, 80) * 0.8, w = 0.25 + hash(i, 2, 80) * 0.6;
        const [x0, y0] = P0(bx0, 23), [x1, y1] = P0(bx0 + 12, 0);
        c.fillStyle = `rgba(255, 255, 255, ${0.1 + hash(i, 3, 80) * 0.16})`;
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineTo(x1 + w * u, y1); c.lineTo(x0 + w * u, y0); c.fill();
        c.strokeStyle = 'rgba(255, 255, 255, .35)'; c.lineWidth = Math.max(0.6, u * 0.02);
        c.beginPath(); c.moveTo(x0 - u * 0.1, y0); c.lineTo(x1 - u * 0.1, y1); c.stroke();
      }
    }
    c.restore();
    // the lake's snowy banks: shade on the ice under a bank to the north or west, a soft lip all round
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      if (!isIce(tileOf(x, y))) continue;
      const [px, py] = P0(x, y);
      const n = !isIce(tileOf(x, y - 1)), s = !isIce(tileOf(x, y + 1)), w = !isIce(tileOf(x - 1, y)), e = !isIce(tileOf(x + 1, y));
      c.fillStyle = 'rgba(40, 90, 150, .22)';
      if (n) c.fillRect(px, py, u, u * 0.32);
      if (w) c.fillRect(px, py, u * 0.28, u);
      c.fillStyle = '#f4f8fd';
      const lip = u * 0.13;
      if (n) { K.rrect(c, px - lip, py - lip, u + lip * 2, lip * 2, lip); c.fill(); }
      if (s) { K.rrect(c, px - lip, py + u - lip * 0.8, u + lip * 2, lip * 1.6, lip * 0.8); c.fill(); }
      if (w) { K.rrect(c, px - lip, py - lip, lip * 2, u + lip * 2, lip); c.fill(); }
      if (e) { K.rrect(c, px + u - lip * 0.8, py - lip, lip * 1.6, u + lip * 2, lip * 0.8); c.fill(); }
      if (s) { c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(px, py + u - lip * 1.6, u, lip * 0.6); }
    }
    // gloss streaks and cracks on the ice, then the holes
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const t = tileOf(x, y);
      if (!isIce(t)) continue;
      const [px, py] = P0(x, y), h = hash(x, y, 11);
      if (t === '~' && h > 0.82) {
        c.strokeStyle = 'rgba(255, 255, 255, .6)'; c.lineWidth = Math.max(0.7, u * 0.025);
        c.beginPath();
        let cx = px + hash(x, y, 14) * u, cy = py + hash(x, y, 15) * u;
        c.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) { cx += (hash(x, y, 16 + k) - 0.5) * u * 0.7; cy += (hash(x, y, 26 + k) - 0.3) * u * 0.5; c.lineTo(cx, cy); }
        c.stroke();
      }
      if (t === 'o') {
        const cx = px + u / 2, cy = py + u / 2;
        c.fillStyle = 'rgba(255,255,255,.9)';
        ell(c, cx, cy + u * 0.04, u * 0.42, u * 0.3); c.fill();
        c.fillStyle = lin(c, cx, cy - u * 0.24, cx, cy + u * 0.24, [[0, '#06192c'], [0.6, '#123a5c'], [1, '#2b6a94']]);
        ell(c, cx, cy, u * 0.33, u * 0.22); c.fill();
        c.strokeStyle = 'rgba(140, 200, 240, .5)'; c.lineWidth = Math.max(0.8, u * 0.03);
        ell(c, cx, cy + u * 0.02, u * 0.22, u * 0.12); c.stroke();
        for (let k = 0; k < 4; k++) {
          const a = k * 1.7 + hash(x, y, k) * 0.6;
          c.fillStyle = '#f7fbff';
          ell(c, cx + Math.cos(a) * u * 0.4, cy + Math.sin(a) * u * 0.28, u * 0.07, u * 0.045, a); c.fill();
        }
      }
    }
    // footprint trails out of the camp, for a lived-in feel
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      if (tileOf(x, y) !== '.' || hash(x, y, 60) > 0.05 + (C.inBase(x, y) ? 0.25 : 0)) continue;
      const a = hash(x, y, 61) * TAU;
      for (let k = 0; k < 4; k++) {
        const side = k % 2 ? 1 : -1;
        const fx1 = x + 0.5 + Math.cos(a) * (k - 1.5) * 0.28 - Math.sin(a) * side * 0.07, fy1 = y + 0.5 + Math.sin(a) * (k - 1.5) * 0.28 + Math.cos(a) * side * 0.07;
        const [qx, qy] = P0(fx1, fy1);
        c.fillStyle = 'rgba(120, 145, 185, .28)';
        ell(c, qx, qy, u * 0.06, u * 0.035, a); c.fill();
      }
    }
  }
  function chunk(cx, cy) {
    const key = cx + ',' + cy;
    let cv = chunks.get(key);
    if (cv) { chunks.delete(key); chunks.set(key, cv); return cv; }
    const k = SPR_DPR(), u = cam.ts;
    cv = document.createElement('canvas');
    cv.width = Math.ceil(CH * u * k); cv.height = Math.ceil(CH * u * k);
    const c = cv.getContext('2d');
    c.setTransform(k, 0, 0, k, 0, 0);
    paintGround(c, u, cx * CH, cy * CH);
    chunks.set(key, cv);
    if (chunks.size > 28) chunks.delete(chunks.keys().next().value);
    return cv;
  }
  function drawGround(off) {
    // the ground depends on the map (the seed) and the tile size only: a retry or a reload keeps the chunks
    const sig = `${g.seed}|${cam.ts}|${SPR_DPR()}`;
    if (chunks.sig !== sig) { chunks.clear(); chunks.sig = sig; }
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, view.w, view.h);
    const d = view.dpr, ts = cam.ts;
    const c0 = Math.max(0, Math.floor(cam.x0 / CH)), c1 = Math.min(Math.ceil(C.W / CH) - 1, Math.floor((cam.x0 + cam.vw) / CH));
    const r0 = Math.max(0, Math.floor(cam.y0 / CH)), r1 = Math.min(Math.ceil(C.H / CH) - 1, Math.floor((cam.y0 + cam.vh) / CH));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sx = (wx) => Math.round(((wx - cam.x0) * ts + off.x) * d);
    const sy = (wy) => Math.round(((wy - cam.y0) * ts + off.y) * d);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const x0 = sx(cx * CH), y0 = sy(cy * CH), x1 = sx(cx * CH + CH), y1 = sy(cy * CH + CH);
      ctx.drawImage(chunk(cx, cy), x0, y0, x1 - x0, y1 - y0);
    }
    ctx.restore();
  }

  // ── The camp ──
  // The hut's look for its stage and the progress of the next one: painted once per change.
  function stageProgress() {
    if (g.hut.stage >= C.HUT_STAGES.length) return 1;
    const cost = C.HUT_STAGES[g.hut.stage].cost;
    let paid = 0, all = 0;
    for (const k of Object.keys(cost)) { all += cost[k]; paid += Math.min(cost[k], g.hut.paid[k] || 0); }
    return all ? paid / all : 0;
  }
  function logWall(c, u, x0, x1, yBase, h, tone = 0) {
    // horizontal logs stacked from the ground up, with round log ends at the corners
    const n = Math.max(1, Math.round(h / (u * 0.17)));
    const lh = h / n;
    for (let i = 0; i < n; i++) {
      const y = yBase - (i + 1) * lh;
      const col = K.shade('#8a5d36', tone - (i % 2) * 0.04);
      c.fillStyle = lin(c, 0, y, 0, y + lh, [[0, K.shade(col, 0.32)], [0.45, col], [1, K.shade(col, -0.45)]]);
      K.rrect(c, x0, y, x1 - x0, lh + 0.4, lh / 2);
      c.fill();
      for (const ex of [x0 + lh * 0.25, x1 - lh * 0.25]) {
        K.sphere(c, ex, y + lh / 2, lh * 0.55, K.shade('#c89a66', tone), { gloss: false, shine: 0.4 });
        c.strokeStyle = 'rgba(90, 55, 25, .5)'; c.lineWidth = 0.7;
        c.beginPath(); c.arc(ex, y + lh / 2, lh * 0.25, 0, TAU); c.stroke();
      }
    }
  }
  function paintHut(c, u, st, f) {
    const W = C.HUT.w * u, D = C.HUT.h * u, Hw = u * 1.0, Hr = u * 0.95, ov = u * 0.22;
    // foundation stones along the footprint
    c.fillStyle = 'rgba(70, 60, 50, .25)';
    c.fillRect(0, 0, W, D);
    const stones = (x0, y0, x1, y1) => {
      const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / (u * 0.3));
      for (let k = 0; k <= n; k++) K.sphere(c, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, u * 0.09, '#8d8f98', { gloss: false });
    };
    stones(0, 0, W, 0); stones(0, 0, 0, D); stones(W, 0, W, D);
    const wallsH = st >= 1 ? Hw : Hw * f;
    if (st < 2) {
      // no roof yet: the plank floor, the inner face of the back wall, the side walls' tops, the front wall
      if (wallsH > 0.5) {
        c.fillStyle = lin(c, 0, 0, 0, D, [[0, '#6e4c30'], [1, '#8a6442']]);
        c.fillRect(u * 0.1, 0, W - u * 0.2, D);
        c.strokeStyle = 'rgba(50, 30, 15, .4)'; c.lineWidth = 1;
        for (let k = 1; k < 9; k++) { c.beginPath(); c.moveTo(u * 0.1 + (k * (W - u * 0.2)) / 9, 0); c.lineTo(u * 0.1 + (k * (W - u * 0.2)) / 9, D); c.stroke(); }
      } else {
        // a cleared site: trodden earth and sawdust
        soft(c, '#9a8670', W / 2, D / 2, W * 0.6, D * 0.62, 0.7);
        for (let k = 0; k < 14; k++) { c.fillStyle = 'rgba(214, 180, 130, .7)'; ell(c, hash(k, 1, 33) * W, hash(k, 2, 33) * D, u * 0.04, u * 0.02); c.fill(); }
      }
      if (wallsH > 0.5) {
        logWall(c, u, 0, W, 0, wallsH, -0.28);
        c.fillStyle = lin(c, 0, 0, u * 0.16, 0, [[0, '#b88a58'], [1, '#7a5232']]);
        c.fillRect(0, -wallsH, u * 0.16, D);
        c.fillRect(W - u * 0.16, -wallsH, u * 0.16, D);
        logWall(c, u, -u * 0.06, W + u * 0.06, D, wallsH, 0.02);
      } else {
        stones(0, D, W, D);
      }
      if (st === 0) {
        // the log pile waiting by the site and the corner posts
        for (let k = 0; k < 3; k++) {
          const y = D + u * 0.3 - k * u * 0.13, x = W + u * 0.05 + k * u * 0.04;
          c.fillStyle = lin(c, 0, y - u * 0.07, 0, y + u * 0.07, [[0, '#b07a48'], [1, '#5a3a20']]);
          K.rrect(c, x, y - u * 0.07, u * 0.55 - k * u * 0.08, u * 0.14, u * 0.07); c.fill();
          K.sphere(c, x + u * 0.05, y, u * 0.07, '#d9b07a', { gloss: false });
        }
        for (const [px, py] of [[0, 0], [W, 0], [0, D], [W, D]]) K.cylinder(c, px, py - u * 1.05, u * 0.05, u * 1.05, '#6a4528', { ry: u * 0.02 });
      }
      if (st === 1) {
        // rafters go up as the roof is paid
        const n = Math.round(f * 6);
        c.lineCap = 'round';
        for (let k = 0; k < n; k++) {
          const yy = D - (k * D) / 5;
          for (const sgn of [-1, 1]) {
            c.strokeStyle = '#5a3a20'; c.lineWidth = u * 0.1;
            c.beginPath(); c.moveTo(W / 2 + sgn * (W / 2 + ov), yy - Hw); c.lineTo(W / 2, yy - Hw - Hr); c.stroke();
            c.strokeStyle = '#a77a4c'; c.lineWidth = u * 0.05;
            c.stroke();
          }
        }
        if (n > 0) {
          c.strokeStyle = '#7a5232'; c.lineWidth = u * 0.1;
          c.beginPath(); c.moveTo(W / 2, D - Hw - Hr); c.lineTo(W / 2, D - (Math.max(0, n - 1) * D) / 5 - Hw - Hr); c.stroke();
        }
      }
      return;
    }
    // ── the finished shell: two snowy roof slopes, the front gable, the front wall ──
    const eaveY = D - Hw + u * 0.12, apexY = D - Hw - Hr, back = D;
    // chimney behind the ridge on the right slope (stage 3 builds it, stage 4 finishes it)
    const chim = st >= 4 ? 1 : st === 3 ? f : 0;
    const chimney = () => {
      if (chim <= 0) return;
      const cx = W * 0.74, by = apexY - back * 0.45 + (W * 0.24) * (Hr / (W / 2 + ov)), ch = u * 1.0 * chim;
      K.prism(c, cx - u * 0.2, by - ch, u * 0.4, ch, u * 0.16, '#8f8a86', { r: u * 0.04 });
      c.strokeStyle = 'rgba(40, 30, 30, .35)'; c.lineWidth = 0.8;
      for (let y = by - ch + u * 0.15; y < by; y += u * 0.15) { c.beginPath(); c.moveTo(cx - u * 0.2, y); c.lineTo(cx + u * 0.2, y); c.stroke(); }
      if (chim >= 1) { c.fillStyle = '#f7fbff'; K.rrect(c, cx - u * 0.23, by - ch - u * 0.2, u * 0.46, u * 0.1, u * 0.05); c.fill(); }
    };
    // left slope (lit), right slope (shade)
    const slope = (sgn) => {
      const ex = W / 2 + sgn * (W / 2 + ov);
      c.beginPath();
      c.moveTo(ex, eaveY); c.lineTo(W / 2, apexY); c.lineTo(W / 2, apexY - back); c.lineTo(ex, eaveY - back);
      c.closePath();
      c.fillStyle = sgn < 0
        ? lin(c, ex, 0, W / 2, 0, [[0, '#dfe9f5'], [0.5, '#f7fbff'], [1, '#ffffff']])
        : lin(c, W / 2, 0, ex, 0, [[0, '#c7d6ea'], [1, '#9fb5d2']]);
      c.fill();
      // shingle rows under the snow, showing at the eave
      c.save(); c.clip();
      c.strokeStyle = sgn < 0 ? 'rgba(160, 180, 210, .45)' : 'rgba(90, 115, 160, .45)'; c.lineWidth = Math.max(0.8, u * 0.025);
      for (let k = 1; k < 5; k++) {
        const t2 = k / 5;
        c.beginPath(); c.moveTo(ex + (W / 2 - ex) * t2, eaveY + (apexY - eaveY) * t2 + u * 0.05); c.lineTo(ex + (W / 2 - ex) * t2, eaveY + (apexY - eaveY) * t2 - back); c.stroke();
      }
      c.restore();
    };
    slope(-1); slope(1);
    // the outer eaves and the back edge: a wooden fascia under a lip of snow
    c.lineCap = 'round';
    for (const sgn of [-1, 1]) {
      const ex = W / 2 + sgn * (W / 2 + ov);
      c.strokeStyle = '#4a2f1a'; c.lineWidth = u * 0.09;
      c.beginPath(); c.moveTo(ex, eaveY); c.lineTo(ex, eaveY - back); c.stroke();
      c.strokeStyle = sgn < 0 ? '#ffffff' : '#c9d7ea'; c.lineWidth = u * 0.06;
      c.beginPath(); c.moveTo(ex - sgn * u * 0.03, eaveY - u * 0.05); c.lineTo(ex - sgn * u * 0.03, eaveY - back); c.stroke();
      c.strokeStyle = sgn < 0 ? '#f3f8fe' : '#b5c7df'; c.lineWidth = u * 0.1;
      c.beginPath(); c.moveTo(ex, eaveY - back); c.lineTo(W / 2, apexY - back); c.stroke();
    }
    chimney();
    // the ridge
    c.strokeStyle = '#ffffff'; c.lineWidth = u * 0.1; c.lineCap = 'round';
    c.beginPath(); c.moveTo(W / 2, apexY + u * 0.02); c.lineTo(W / 2, apexY - back); c.stroke();
    // the front gable: vertical planks in the roof's shade
    c.beginPath(); c.moveTo(0, D - Hw); c.lineTo(W / 2, apexY + u * 0.08); c.lineTo(W, D - Hw); c.closePath();
    c.fillStyle = lin(c, 0, apexY, 0, D - Hw, [[0, '#4e3420'], [1, '#7a5434']]);
    c.fill();
    c.save(); c.clip();
    c.strokeStyle = 'rgba(30, 18, 8, .5)'; c.lineWidth = 1;
    for (let k = 1; k < 10; k++) { c.beginPath(); c.moveTo((k * W) / 10, apexY); c.lineTo((k * W) / 10, D - Hw); c.stroke(); }
    // a small round window in the gable
    K.sphere(c, W / 2, D - Hw - Hr * 0.42, u * 0.13, '#3a2616', { gloss: false });
    c.restore();
    // the front wall of logs
    logWall(c, u, -u * 0.06, W + u * 0.06, D, Hw, 0.04);
    // the window left of the door (lit later by the stove)
    const wx = u * 0.35, wy = D - Hw * 0.72, ww = u * 0.55, wh = u * 0.42;
    K.block(c, wx - u * 0.05, wy - u * 0.05, ww + u * 0.1, wh + u * 0.1, u * 0.04, '#5a3a20');
    c.fillStyle = '#1d2433'; c.fillRect(wx, wy, ww, wh);
    c.strokeStyle = '#5a3a20'; c.lineWidth = u * 0.05;
    c.beginPath(); c.moveTo(wx + ww / 2, wy); c.lineTo(wx + ww / 2, wy + wh); c.moveTo(wx, wy + wh / 2); c.lineTo(wx + ww, wy + wh / 2); c.stroke();
    c.fillStyle = '#f5f9ff'; K.rrect(c, wx - u * 0.07, wy + wh + u * 0.02, ww + u * 0.14, u * 0.08, u * 0.04); c.fill();
    // the doorway, then the door planks as they are paid
    const dx = W / 2 - u * 0.3, dw = u * 0.6, dh = u * 0.78, dy = D - dh;
    c.fillStyle = '#4a2f1a'; K.rrect(c, dx - u * 0.06, dy - u * 0.06, dw + u * 0.12, dh + u * 0.06, u * 0.08); c.fill();
    c.fillStyle = '#120c08'; K.rrect(c, dx, dy, dw, dh, u * 0.06); c.fill();
    const planks = st >= 3 ? 4 : Math.round(f * 4);
    for (let k = 0; k < planks; k++) {
      const px = dx + (k * dw) / 4;
      c.fillStyle = lin(c, px, 0, px + dw / 4, 0, [[0, '#a8743f'], [1, '#6e4524']]);
      c.fillRect(px + 0.5, dy + 0.5, dw / 4 - 1, dh - 0.5);
    }
    if (st >= 3) {
      c.fillStyle = '#2c2a2e';
      c.fillRect(dx, dy + dh * 0.22, dw, u * 0.05); c.fillRect(dx, dy + dh * 0.72, dw, u * 0.05);
      K.sphere(c, dx + dw * 0.8, dy + dh * 0.52, u * 0.04, '#c9b27a');
    }
    // the eave: thick snow overhang with icicles
    for (const sgn of [-1, 1]) {
      const ex = W / 2 + sgn * (W / 2 + ov);
      c.strokeStyle = '#5a3a20'; c.lineWidth = u * 0.12; c.lineCap = 'round';
      c.beginPath(); c.moveTo(ex, eaveY); c.lineTo(W / 2, apexY); c.stroke();
      c.strokeStyle = sgn < 0 ? '#ffffff' : '#dbe6f3'; c.lineWidth = u * 0.1;
      c.beginPath(); c.moveTo(ex, eaveY - u * 0.07); c.lineTo(W / 2, apexY - u * 0.07); c.stroke();
    }
    c.fillStyle = 'rgba(225, 242, 255, .9)';
    for (let k = 0; k < 9; k++) {
      const t2 = (k + 0.5) / 9, sgn = t2 < 0.5 ? -1 : 1, tt = sgn < 0 ? t2 * 2 : (1 - t2) * 2;
      const ex = W / 2 + sgn * (W / 2 + ov), x = ex + (W / 2 - ex) * tt, y = eaveY + (apexY - eaveY) * tt + u * 0.04;
      const len = u * (0.08 + hash(k, 3) * 0.16);
      c.beginPath(); c.moveTo(x - u * 0.03, y); c.lineTo(x, y + len); c.lineTo(x + u * 0.03, y); c.fill();
    }
  }
  function hutSprite() {
    const st = g.hut.stage, f = st >= C.HUT_STAGES.length ? 1 : Math.round(stageProgress() * 8) / 8;
    return sprite(`hut${st}|${f}`, 4.3, 5.7, 0.6, 3.1, (c, u) => paintHut(c, u, st, f));
  }

  const benchSprite = () => sprite('bench', 1.4, 1.4, 0.7, 0.95, (c, u) => {
    for (const lx of [-0.34, 0.26]) { c.fillStyle = '#4a3020'; c.fillRect(lx * u, -u * 0.35, u * 0.08, u * 0.35); }
    K.prism(c, -u * 0.42, -u * 0.5, u * 0.84, u * 0.15, u * 0.3, '#9a7048', { r: u * 0.03 });
    // a saw and an axe on the top
    c.fillStyle = '#c3ccd6';
    c.beginPath(); c.moveTo(-u * 0.32, -u * 0.62); c.lineTo(u * 0.05, -u * 0.7); c.lineTo(u * 0.05, -u * 0.6); c.closePath(); c.fill();
    c.fillStyle = '#7a4a2a'; c.fillRect(u * 0.04, -u * 0.71, u * 0.09, u * 0.12);
    c.strokeStyle = '#6a4224'; c.lineWidth = u * 0.05; c.lineCap = 'round';
    c.beginPath(); c.moveTo(u * 0.15, -u * 0.58); c.lineTo(u * 0.36, -u * 0.74); c.stroke();
    K.metalBar(c, u * 0.3, -u * 0.8, u * 0.38, -u * 0.66, u * 0.08, '#aeb8c6');
    c.fillStyle = 'rgba(255,255,255,.9)'; ell(c, -u * 0.25, -u * 0.77, u * 0.1, u * 0.03); c.fill();
  });
  const bunkSprite = () => sprite('bunk', 1.3, 1.1, 0.65, 0.8, (c, u) => {
    K.prism(c, -u * 0.46, -u * 0.22, u * 0.92, u * 0.2, u * 0.42, '#8a6040', { r: u * 0.03 });
    // the mattress, the blanket, the pillow
    c.fillStyle = lin(c, 0, -u * 0.6, 0, -u * 0.25, [[0, '#d65a4a'], [1, '#9c3328']]);
    K.rrect(c, -u * 0.38, -u * 0.6, u * 0.76, u * 0.36, u * 0.06); c.fill();
    c.strokeStyle = 'rgba(255, 220, 190, .35)'; c.lineWidth = 1;
    for (let k = 1; k < 4; k++) { c.beginPath(); c.moveTo(-u * 0.38 + k * u * 0.19, -u * 0.6); c.lineTo(-u * 0.38 + k * u * 0.19, -u * 0.24); c.stroke(); }
    K.block(c, -u * 0.36, -u * 0.6, u * 0.22, u * 0.32, u * 0.07, '#efe6d4');
    K.cylinder(c, -u * 0.44, -u * 0.62, u * 0.045, u * 0.42, '#6e4a2c', { ry: u * 0.02 });
    K.cylinder(c, u * 0.44, -u * 0.62, u * 0.045, u * 0.42, '#6e4a2c', { ry: u * 0.02 });
  });

  // a sharpened log stake of the palisade; `bad` for a gnawed one
  const stakeSprite = (bad) => sprite('stake' + (bad ? 1 : 0), 0.4, 1, 0.2, 0.86, (c, u) => {
    const col = bad ? '#5e432c' : '#86603c', r = u * 0.085, h = u * 0.62;
    K.cylinder(c, 0, -h, r, h, col, { cap: false, ry: r * 0.35 });
    c.beginPath(); c.moveTo(-r, -h); c.lineTo(0, -h - u * 0.16); c.lineTo(r, -h); c.closePath();
    c.fillStyle = lin(c, -r, 0, r, 0, [[0, '#d8b285'], [1, '#7a5634']]); c.fill();
    c.fillStyle = '#f7fbff';
    c.beginPath(); c.moveTo(-r * 0.75, -h - u * 0.03); c.lineTo(0, -h - u * 0.16); c.lineTo(r * 0.2, -h - u * 0.1); c.quadraticCurveTo(-r * 0.2, -h + u * 0.02, -r * 0.75, -h - u * 0.03); c.fill();
    c.strokeStyle = 'rgba(40, 24, 10, .35)'; c.lineWidth = 0.7;
    c.beginPath(); c.moveTo(-r * 0.3, -h * 0.8); c.lineTo(-r * 0.3, -h * 0.5); c.moveTo(r * 0.2, -h * 0.4); c.lineTo(r * 0.2, -h * 0.15); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.9)'; ell(c, 0, 0, r * 1.3, r * 0.5); c.fill();
  });
  const torchSprite = () => sprite('torch', 0.6, 1.2, 0.3, 1.05, (c, u) => {
    K.cylinder(c, 0, -u * 0.72, u * 0.05, u * 0.72, '#6a4528', { ry: u * 0.02 });
    K.cylinder(c, 0, -u * 0.86, u * 0.1, u * 0.14, '#3c3a40', { capColor: '#2a1a12', ry: u * 0.04 });
    c.fillStyle = 'rgba(255,255,255,.9)'; ell(c, 0, 0, u * 0.12, u * 0.045); c.fill();
  });

  // a flame of height h at (x, y): three layered tongues flickering
  function flame(x, y, w, h, seed) {
    const cols = ['#ff5a1f', '#ffa53a', '#fff2a8'];
    for (let k = 0; k < 3; k++) {
      const ww = w * (1 - k * 0.27), hh = h * (1 - k * 0.24) * (0.9 + 0.12 * Math.sin(time * 13 + seed + k * 2));
      const sway = Math.sin(time * 7 + seed * 3 + k) * w * 0.18;
      ctx.fillStyle = cols[k];
      ctx.beginPath();
      ctx.moveTo(x - ww, y);
      ctx.bezierCurveTo(x - ww * 1.05, y - hh * 0.45, x - ww * 0.2 + sway, y - hh * 0.6, x + sway * 1.6, y - hh);
      ctx.bezierCurveTo(x + ww * 0.25 + sway, y - hh * 0.6, x + ww * 1.05, y - hh * 0.45, x + ww, y);
      ctx.quadraticCurveTo(x, y + ww * 0.45, x - ww, y);
      ctx.fill();
    }
  }

  function drawFire(fx0, fy0) {
    const ts = cam.ts, on = C.fireOn(g);
    const ring = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + 0.2; ring.push([fx0 + Math.cos(a) * ts * 0.36, fy0 + Math.sin(a) * ts * 0.22, Math.sin(a)]); }
    const stone = ([x, y]) => K.sphere(ctx, x, y, ts * 0.09, '#7f8590', { gloss: false });
    for (const s of ring) if (s[2] < 0) stone(s);
    // the logs, crossed
    ctx.lineCap = 'round';
    for (const [a, b] of [[-0.5, 0.35], [0.5, -0.3]]) {
      const x0 = fx0 + a * ts * 0.5, y0 = fy0 + ts * 0.06, x1 = fx0 + b * ts * 0.5, y1 = fy0 - ts * 0.04;
      ctx.strokeStyle = on ? '#3a2416' : '#2a1c14'; ctx.lineWidth = ts * 0.13;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = on ? '#8a5a32' : '#4a3a30'; ctx.lineWidth = ts * 0.06;
      ctx.beginPath(); ctx.moveTo(x0, y0 - ts * 0.02); ctx.lineTo(x1, y1 - ts * 0.02); ctx.stroke();
    }
    if (on) {
      const fl = Math.min(1, g.fire.fuel / 8);
      K.glow(ctx, fx0, fy0 - ts * 0.15, ts * (0.9 + 0.3 * fl), '#ff8a2a', 0.55 + 0.1 * Math.sin(time * 9));
      flame(fx0, fy0 + ts * 0.02, ts * 0.22, ts * (0.55 + 0.45 * fl), 1);
      ctx.fillStyle = '#ffd27a';
      ell(ctx, fx0, fy0 + ts * 0.02, ts * 0.16, ts * 0.06); ctx.fill();
    }
    for (const s of ring) if (s[2] >= 0) stone(s);
    // the fuel left, a small pill under the fire
    const bw = ts * 0.8, bx = fx0 - bw / 2, by = fy0 + ts * 0.42;
    ctx.fillStyle = 'rgba(10, 14, 30, .45)';
    K.rrect(ctx, bx - 1, by - 1, bw + 2, 6, 3); ctx.fill();
    const k = Math.max(0, Math.min(1, g.fire.fuel / C.FIRE.cap));
    if (k > 0) { ctx.fillStyle = lin(ctx, 0, by, 0, by + 4, [[0, '#ffd27a'], [1, '#ff8a2a']]); K.rrect(ctx, bx, by, bw * k, 4, 2); ctx.fill(); }
  }

  function drawHut(alpha) {
    const ts = cam.ts, p = P(C.HUT.x, C.HUT.y), s = hutSprite();
    const pk = 'hut', pt = pops[pk] == null ? 9 : time - pops[pk];
    const sc = pt < 0.6 ? 0.9 + 0.1 * K.ease.outBack(pt / 0.6) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    // grow from the bottom centre of the footprint
    const ax = p.x + C.HUT.w * ts / 2, ay = p.y + C.HUT.h * ts;
    ctx.translate(ax, ay); ctx.scale(sc, 2 - sc); ctx.translate(-ax, -ay);
    blit(s, p.x, p.y);
    ctx.restore();
    const st = g.hut.stage;
    if (st >= 2) {
      const stove = C.stoveOn(g);
      const wx = p.x + ts * 0.35, wy = p.y + C.HUT.h * ts - ts * 0.72;
      if (stove) {
        const fl = 0.8 + 0.2 * Math.sin(time * 6) * Math.sin(time * 2.3);
        ctx.fillStyle = `rgba(255, 176, 80, ${0.85 * fl})`;
        ctx.fillRect(wx + 1, wy + 1, ts * 0.55 / 2 - 2, ts * 0.42 / 2 - 2);
        ctx.fillRect(wx + ts * 0.55 / 2 + 1, wy + 1, ts * 0.55 / 2 - 2, ts * 0.42 / 2 - 2);
        ctx.fillRect(wx + 1, wy + ts * 0.42 / 2 + 1, ts * 0.55 / 2 - 2, ts * 0.42 / 2 - 2);
        ctx.fillRect(wx + ts * 0.55 / 2 + 1, wy + ts * 0.42 / 2 + 1, ts * 0.55 / 2 - 2, ts * 0.42 / 2 - 2);
        K.glow(ctx, wx + ts * 0.27, wy + ts * 0.2, ts * 0.7, '#ffb050', 0.5 * fl);
      }
    }
  }

  // ── People and animals ──
  function motion(e) {
    let m = anim.get(e);
    if (!m) { m = { x: e.x, y: e.y, face: 1, phase: Math.random() * 6, moving: 0 }; anim.set(e, m); }
    const dx = e.x - m.x, dy = e.y - m.y, d = Math.hypot(dx, dy);
    if (d > 0.0005) {
      if (Math.abs(dx) > 0.002) m.face = dx > 0 ? 1 : -1;
      m.phase += d * 7.5;
      m.moving = Math.min(1, m.moving + 0.25);
    } else m.moving = Math.max(0, m.moving - 0.1);
    m.x = e.x; m.y = e.y;
    return m;
  }

  const LOOK = {
    hero: { coat: '#3f6fc8', hat: '#d0283e', pom: '#ffffff', scarf: '#f2b632' },
    hunter: { coat: '#8a5a2c', hat: '#5a3a1e', pom: null, scarf: '#c9a46a', fur: true },
    carpenter: { coat: '#6a8a3a', hat: '#2e5a3a', pom: '#e6e0c8', scarf: '#c0472f' },
    herbalist: { coat: '#7a4a9a', hat: '#b04a7a', pom: null, scarf: '#e9d6f0', hood: true },
    smith: { coat: '#4f5160', hat: '#2a2a32', pom: null, scarf: '#8a5a3a', apron: true },
    child: { coat: '#d0503e', hat: '#f2c84a', pom: '#ffffff', scarf: '#3f8ad0', small: true },
  };

  function drawPerson(e, look, opts = {}) {
    const ts = cam.ts, p = P(e.x, e.y);
    if (p.x < -ts || p.y < -ts * 2 || p.x > view.w + ts || p.y > view.h + ts * 2) return;
    const m = motion(e);
    const work = opts.work;
    if (work && work.x !== undefined && Math.abs(work.x - e.x) > 0.05) m.face = work.x > e.x ? 1 : -1;
    const sc = look.small ? 0.8 : 1, u = ts * sc;
    const fy = p.y + ts * 0.28;          // the feet
    const walk = m.moving, ph = m.phase;
    const bob = walk ? Math.abs(Math.sin(ph)) * u * 0.06 : Math.sin(time * 2.2 + e.x) * u * 0.008;
    const r = u * 0.2, bh = u * 0.42, by = fy - u * 0.08 - bob;
    // boots stepping
    for (const sd of [-1, 1]) {
      const lift = walk ? Math.max(0, Math.sin(ph + (sd > 0 ? Math.PI : 0))) * u * 0.07 : 0;
      ctx.fillStyle = '#2a2230';
      ell(ctx, p.x + sd * u * 0.09, fy - u * 0.03 - lift, u * 0.075, u * 0.05); ctx.fill();
    }
    const tg = work && work.kind;
    // back arm
    const arm = (sd, ang, len) => {
      ctx.save();
      ctx.translate(p.x + sd * r * 0.92, by - bh * 0.62);
      ctx.rotate(ang);
      ctx.fillStyle = K.shade(look.coat, sd * m.face > 0 ? -0.25 : 0.05);
      K.rrect(ctx, -u * 0.05, 0, u * 0.1, len, u * 0.05); ctx.fill();
      ctx.fillStyle = '#f0c9a0'; ell(ctx, 0, len, u * 0.045, u * 0.045); ctx.fill();
      ctx.restore();
    };
    const sw = walk ? Math.sin(ph) * 0.5 : 0;
    arm(-m.face, sw, u * 0.24);
    // the body: a lit bean with a coat, a belt, an apron
    K.bean(ctx, p.x, by, r, bh, look.coat, { shadow: false });
    ctx.fillStyle = 'rgba(20, 12, 30, .25)'; ctx.fillRect(p.x - r, by - bh * 0.32, r * 2, u * 0.035);
    if (look.apron) { ctx.fillStyle = '#7a5232'; K.rrect(ctx, p.x - r * 0.6, by - bh * 0.6, r * 1.2, bh * 0.55, r * 0.3); ctx.fill(); }
    // the scarf
    ctx.fillStyle = look.scarf;
    K.rrect(ctx, p.x - r * 0.95, by - bh - u * 0.005, r * 1.9, u * 0.075, u * 0.035); ctx.fill();
    ctx.fillRect(p.x + m.face * r * 0.35, by - bh + u * 0.04, u * 0.06, u * 0.12);
    // the head and the face looking the way he walks
    const hx = p.x + m.face * u * 0.015, hy = by - bh - u * 0.1;
    K.sphere(ctx, hx, hy, u * 0.15, '#f0c49a', { gloss: false, shine: 0.4 });
    ctx.fillStyle = '#2a1c18';
    for (const sd of [-1, 1]) { ell(ctx, hx + m.face * u * 0.05 + sd * u * 0.045, hy + u * 0.01, u * 0.016, u * 0.024); ctx.fill(); }
    ctx.fillStyle = 'rgba(230, 110, 100, .45)';
    ell(ctx, hx + m.face * u * 0.1, hy + u * 0.05, u * 0.03, u * 0.018); ctx.fill();
    // the hat
    if (look.hood) {
      ctx.fillStyle = lin(ctx, hx - u * 0.17, 0, hx + u * 0.17, 0, [[0, K.shade(look.hat, 0.25)], [1, K.shade(look.hat, -0.35)]]);
      ctx.beginPath(); ctx.arc(hx, hy + u * 0.01, u * 0.18, Math.PI * 0.92, Math.PI * 2.08); ctx.quadraticCurveTo(hx, hy - u * 0.12, hx - u * 0.18, hy + u * 0.03); ctx.fill();
    } else {
      ctx.fillStyle = lin(ctx, hx - u * 0.16, 0, hx + u * 0.16, 0, [[0, K.shade(look.hat, 0.3)], [0.5, look.hat], [1, K.shade(look.hat, -0.35)]]);
      ctx.beginPath(); ctx.arc(hx, hy - u * 0.02, u * 0.16, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = look.fur ? '#c8a878' : K.shade(look.hat, 0.35);
      K.rrect(ctx, hx - u * 0.17, hy - u * 0.05, u * 0.34, u * 0.06, u * 0.03); ctx.fill();
      if (look.fur) { ctx.fillStyle = '#c8a878'; ell(ctx, hx - u * 0.15, hy + u * 0.04, u * 0.04, u * 0.07); ctx.fill(); ell(ctx, hx + u * 0.15, hy + u * 0.04, u * 0.04, u * 0.07); ctx.fill(); }
      if (look.pom) K.sphere(ctx, hx - m.face * u * 0.03, hy - u * 0.18, u * 0.05, look.pom, { gloss: false });
    }
    // front arm, with the tool while working
    if (tg) {
      ctx.save();
      ctx.translate(p.x + m.face * r * 0.9, by - bh * 0.62);
      ctx.scale(m.face, 1);
      ctx.rotate(swingAngle(work));
      ctx.fillStyle = K.shade(look.coat, 0.05);
      K.rrect(ctx, -u * 0.05, 0, u * 0.1, u * 0.22, u * 0.05); ctx.fill();
      ctx.strokeStyle = '#6a4224'; ctx.lineWidth = u * 0.05; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, u * 0.18); ctx.lineTo(0, u * 0.5); ctx.stroke();
      if (tg === 'tree' || tg === 'pick' || tg === 'rock') {
        ctx.fillStyle = '#b8c2d0';
        // the blade leads the downswing, which runs towards the arm's local −x
        if (tg === 'tree') {
          ctx.beginPath(); ctx.moveTo(u * 0.01, u * 0.4); ctx.lineTo(-u * 0.15, u * 0.35); ctx.quadraticCurveTo(-u * 0.19, u * 0.45, -u * 0.15, u * 0.55); ctx.lineTo(u * 0.01, u * 0.5); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#e8eef6'; ctx.fillRect(-u * 0.165, u * 0.37, u * 0.025, u * 0.16);
        } else {
          ctx.beginPath(); ctx.moveTo(-u * 0.2, u * 0.4); ctx.quadraticCurveTo(0, u * 0.5, u * 0.2, u * 0.4);
          ctx.quadraticCurveTo(0, u * 0.56, -u * 0.2, u * 0.4); ctx.fill();
        }
      }
      ctx.restore();
    } else arm(m.face, -sw, u * 0.24);
  }

  // At the camp by day the carpenter splits logs on a block and the smith breaks ore on a stone.
  const HOME_JOB = { carpenter: 'tree', smith: 'rock' };
  function drawWorkBlock(job, x, y) {
    const ts = cam.ts, p = P(x, y + 0.22);
    if (job === 'tree') {
      ctx.fillStyle = '#6a4224'; K.rrect(ctx, p.x - ts * 0.14, p.y - ts * 0.16, ts * 0.28, ts * 0.18, ts * 0.04); ctx.fill();
      ctx.fillStyle = '#c99a62'; ell(ctx, p.x, p.y - ts * 0.16, ts * 0.14, ts * 0.05); ctx.fill();
      ctx.strokeStyle = '#8a6038'; ctx.lineWidth = ts * 0.012;
      ell(ctx, p.x, p.y - ts * 0.16, ts * 0.07, ts * 0.025); ctx.stroke();
    } else {
      K.sphere(ctx, p.x, p.y - ts * 0.08, ts * 0.13, '#8d939e', { gloss: false, shine: 0.4 });
      ctx.fillStyle = '#c07a4a'; ell(ctx, p.x + ts * 0.04, p.y - ts * 0.13, ts * 0.03, ts * 0.02); ctx.fill();
    }
  }

  // The tool arm's angle (radians, the arm hanging down is 0, facing right): a quick chop down to the front at each
  // hit, a short rest on the target, then the slower lift up over the shoulder for the next one. The core resets the
  // cooldown on the hit, so 1 − cd/period runs from 0 at the impact to 1 just before the next.
  const STRIKE = 5.25, RAISED = 2.75;
  const ease = (k) => k * k * (3 - 2 * k);
  function swingAngle(w) {
    if (!w.period) return STRIKE - 0.35 + Math.sin(time * 3) * 0.12;     // fishing: a slow jig of the line
    const p = C.clamp(1 - w.cd / w.period, 0, 1);
    if (p < 0.12) return STRIKE + 0.06 * Math.sin((p / 0.12) * Math.PI);   // the bite into the wood or stone
    if (p < 0.78) return STRIKE + (RAISED - STRIKE) * ease((p - 0.12) / 0.66);
    const k = (p - 0.78) / 0.22;
    return RAISED + (STRIKE - RAISED) * k * k;                           // accelerating down
  }

  function drawSleeper(e) {
    // asleep in the hut: only the z's rise from the roof
    const ts = cam.ts, p = P(C.HUT.x + 1.5, C.HUT.y - 0.6);
    for (let k = 0; k < 3; k++) {
      const t2 = (time * 0.6 + k / 3) % 1;
      ctx.globalAlpha = Math.sin(t2 * Math.PI);
      K.text(ctx, 'z', p.x + Math.sin(t2 * 6 + k) * ts * 0.2 + t2 * ts * 0.4, p.y - t2 * ts * 1.1, { size: Math.round(ts * (0.3 + t2 * 0.25)), color: '#cfe0ff' });
    }
    ctx.globalAlpha = 1;
    void e;
  }

  function drawRabbit(a) {
    const ts = cam.ts, p = P(a.x, a.y), m = motion(a);
    if (a.tx + 0.5 !== a.x) m.face = a.tx + 0.5 > a.x ? 1 : -1;
    const hop = m.moving ? Math.abs(Math.sin(m.phase * 1.3)) * ts * 0.16 : 0;
    const x = p.x, y = p.y + ts * 0.18 - hop;
    ctx.save(); ctx.translate(x, y); ctx.scale(m.face, 1);
    K.sphere(ctx, -ts * 0.17, -ts * 0.08, ts * 0.06, '#ffffff', { gloss: false });
    K.sphere(ctx, -ts * 0.02, -ts * 0.1, ts * 0.16, '#efece4', { gloss: false, shine: 0.5 });
    K.sphere(ctx, ts * 0.13, -ts * 0.2, ts * 0.1, '#f3f0e8', { gloss: false, shine: 0.5 });
    for (const [ex, rot] of [[0.09, -0.25], [0.15, 0.15]]) {
      ctx.fillStyle = '#ebe6dc'; ell(ctx, ts * ex, -ts * 0.36, ts * 0.035, ts * 0.11, rot); ctx.fill();
      ctx.fillStyle = '#f0b8b8'; ell(ctx, ts * ex, -ts * 0.35, ts * 0.015, ts * 0.07, rot); ctx.fill();
    }
    ctx.fillStyle = '#2a1c18'; ell(ctx, ts * 0.18, -ts * 0.22, ts * 0.018, ts * 0.022); ctx.fill();
    ctx.fillStyle = '#e88c8c'; ell(ctx, ts * 0.225, -ts * 0.18, ts * 0.014, ts * 0.01); ctx.fill();
    ctx.restore();
  }

  function legs(x, y, n, spread, len, ph, moving, col, w) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const lx = x + (k < n / 2 ? -spread : spread) + (k % 2 ? -w : w);
      const sw = moving ? Math.sin(ph + (k === 0 || k === 3 ? 0 : Math.PI)) * len * 0.35 : 0;
      ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + sw, y + len); ctx.stroke();
    }
  }

  function drawDeer(a) {
    const ts = cam.ts, p = P(a.x, a.y), m = motion(a);
    if (a.tx + 0.5 !== a.x) m.face = a.tx + 0.5 > a.x ? 1 : -1;
    const bob = m.moving ? Math.abs(Math.sin(m.phase)) * ts * 0.03 : 0;
    ctx.save(); ctx.translate(p.x, p.y + ts * 0.32); ctx.scale(m.face, 1);
    const by = -ts * 0.42 - bob;
    legs(0, by + ts * 0.08, 4, ts * 0.2, ts * 0.36, m.phase, m.moving, '#5a3a22', Math.max(1.5, ts * 0.045));
    ctx.fillStyle = lin(ctx, 0, by - ts * 0.17, 0, by + ts * 0.17, [[0, '#c08a58'], [0.5, '#9a6640'], [1, '#5e3a22']]);
    ell(ctx, 0, by, ts * 0.32, ts * 0.16); ctx.fill();
    ctx.fillStyle = 'rgba(255, 235, 210, .7)'; ell(ctx, -ts * 0.02, by + ts * 0.09, ts * 0.2, ts * 0.05); ctx.fill();
    ctx.fillStyle = '#ffffff'; ell(ctx, -ts * 0.31, by - ts * 0.04, ts * 0.06, ts * 0.06); ctx.fill();
    // neck and head
    ctx.fillStyle = '#a8724a';
    ctx.beginPath(); ctx.moveTo(ts * 0.16, by - ts * 0.06); ctx.lineTo(ts * 0.3, by - ts * 0.34); ctx.lineTo(ts * 0.38, by - ts * 0.3); ctx.lineTo(ts * 0.3, by + ts * 0.02); ctx.fill();
    K.sphere(ctx, ts * 0.37, by - ts * 0.36, ts * 0.09, '#a8724a', { gloss: false });
    ctx.fillStyle = '#8a5a38'; ell(ctx, ts * 0.46, by - ts * 0.33, ts * 0.06, ts * 0.045); ctx.fill();
    ctx.fillStyle = '#1a1210'; ell(ctx, ts * 0.51, by - ts * 0.33, ts * 0.018, ts * 0.016); ctx.fill();
    ell(ctx, ts * 0.39, by - ts * 0.38, ts * 0.016, ts * 0.02); ctx.fill();
    // antlers
    ctx.strokeStyle = '#e2cfa8'; ctx.lineWidth = Math.max(1.2, ts * 0.03); ctx.lineCap = 'round';
    ctx.beginPath();
    for (const sd of [-1, 1]) {
      const ax = ts * (0.34 + sd * 0.04), ay = by - ts * 0.43;
      ctx.moveTo(ax, ay); ctx.lineTo(ax - ts * 0.04, ay - ts * 0.2);
      ctx.moveTo(ax - ts * 0.02, ay - ts * 0.1); ctx.lineTo(ax - ts * 0.1, ay - ts * 0.15);
      ctx.moveTo(ax - ts * 0.03, ay - ts * 0.16); ctx.lineTo(ax + ts * 0.04, ay - ts * 0.24);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawWolf(w, eyes) {
    const ts = cam.ts, p = P(w.x, w.y), m = motion(w);
    const run = m.moving ? Math.abs(Math.sin(m.phase * 1.1)) * ts * 0.04 : 0;
    const hx = m.face;
    if (eyes) {
      // the eyes glow through the night
      const ex = p.x + hx * ts * 0.38, ey = p.y + ts * 0.28 - ts * 0.4 - run;
      K.glow(ctx, ex, ey, ts * 0.22, '#ffd34d', 0.8);
      ctx.fillStyle = '#fff6b0';
      ell(ctx, ex + hx * ts * 0.01, ey, ts * 0.025, ts * 0.018); ctx.fill();
      return;
    }
    ctx.save(); ctx.translate(p.x, p.y + ts * 0.28); ctx.scale(hx, 1);
    const by = -ts * 0.3 - run;
    legs(0, by + ts * 0.05, 4, ts * 0.17, ts * 0.27, m.phase * 1.1, m.moving, '#3e4250', Math.max(1.5, ts * 0.05));
    // the tail
    ctx.fillStyle = '#5c6170';
    ctx.beginPath(); ctx.moveTo(-ts * 0.26, by - ts * 0.04); ctx.quadraticCurveTo(-ts * 0.5, by - ts * 0.02 + Math.sin(time * 6 + w.id) * ts * 0.04, -ts * 0.48, by + ts * 0.14); ctx.quadraticCurveTo(-ts * 0.36, by + ts * 0.04, -ts * 0.24, by + ts * 0.05); ctx.fill();
    // the body
    ctx.fillStyle = lin(ctx, 0, by - ts * 0.15, 0, by + ts * 0.14, [[0, '#4a4f5e'], [0.35, '#7d8394'], [1, '#c9ccd4']]);
    ell(ctx, 0, by, ts * 0.3, ts * 0.14); ctx.fill();
    ctx.fillStyle = 'rgba(30, 32, 44, .35)'; ell(ctx, -ts * 0.04, by - ts * 0.08, ts * 0.22, ts * 0.05); ctx.fill();
    // the head with a snout and pointed ears
    const hy = by - ts * 0.12;
    ctx.fillStyle = '#6e7486';
    ctx.beginPath(); ctx.moveTo(ts * 0.22, hy - ts * 0.08); ctx.lineTo(ts * 0.26, hy - ts * 0.24); ctx.lineTo(ts * 0.31, hy - ts * 0.09); ctx.fill();
    ctx.beginPath(); ctx.moveTo(ts * 0.32, hy - ts * 0.08); ctx.lineTo(ts * 0.37, hy - ts * 0.23); ctx.lineTo(ts * 0.41, hy - ts * 0.07); ctx.fill();
    K.sphere(ctx, ts * 0.32, hy, ts * 0.11, '#767c8e', { gloss: false });
    ctx.fillStyle = lin(ctx, 0, hy - ts * 0.03, 0, hy + ts * 0.06, [[0, '#8a90a0'], [1, '#c9ccd4']]);
    ell(ctx, ts * 0.44, hy + ts * 0.03, ts * 0.09, ts * 0.05); ctx.fill();
    ctx.fillStyle = '#16141a'; ell(ctx, ts * 0.52, hy + ts * 0.02, ts * 0.025, ts * 0.02); ctx.fill();
    ctx.fillStyle = '#ffd34d'; ell(ctx, ts * 0.36, hy - ts * 0.02, ts * 0.025, ts * 0.018); ctx.fill();
    ctx.restore();
    if (w.hp < w.maxHp) {
      const bw = ts * 0.6, bx = p.x - bw / 2, bY = p.y - ts * 0.38;
      ctx.fillStyle = 'rgba(10, 8, 20, .55)'; K.rrect(ctx, bx - 1, bY - 1, bw + 2, 6, 3); ctx.fill();
      ctx.fillStyle = lin(ctx, 0, bY, 0, bY + 4, [[0, '#ffb0a0'], [1, '#e0483a']]);
      K.rrect(ctx, bx, bY, bw * Math.max(0, w.hp / w.maxHp), 4, 2); ctx.fill();
    }
  }

  // ── The scene: decals on the ground, then everything that stands, sorted by its foot ──
  // What the hero is working at: the tool, the seconds between hits (the swing keeps time with them) and where
  // the target stands, so he turns to face it.
  const HIT_PERIOD = { tree: C.HIT_CD, rock: C.HIT_CD, bush: 1, scrap: 1.5 };
  function heroWork() {
    const h = g.hero, tg = h.target;
    if (!tg || h.path) return null;
    if (tg.type === 'node') {
      const n = g.nodes[tg.id];
      return n ? { kind: n.kind, period: HIT_PERIOD[n.kind] || C.HIT_CD, cd: h.cd, x: n.x + 0.5 } : null;
    }
    if (tg.type === 'wolf' || tg.type === 'animal') {
      const e = (tg.type === 'wolf' ? g.wolves : g.animals).find((a) => a.id === tg.id);
      return e ? { kind: 'tree', period: 0.8, cd: h.cd, x: e.x } : null;
    }
    if (tg.type === 'hole') return { kind: 'hand', x: tg.x + 0.5 };
    return null;
  }

  function drawDecals() {
    const ts = cam.ts;
    // the hero's own footprints, fading
    for (const s of steps) {
      const a = 1 - (time - s.t) / 14;
      if (a <= 0) continue;
      const p = P(s.x, s.y);
      ctx.fillStyle = `rgba(110, 135, 175, ${0.4 * a})`;
      ell(ctx, p.x, p.y, ts * 0.065, ts * 0.04, s.a); ctx.fill();
    }
    // the palisade plan where it is not up yet: pegs and a cord
    const A = P(C.BASE.x0, C.BASE.y0), B = P(C.BASE.x1 + 1, C.BASE.y1 + 1);
    const lines = [[A.x, A.y, B.x, A.y], [B.x, A.y, B.x, B.y], [A.x, B.y, B.x, B.y], [A.x, A.y, A.x, B.y]];
    ctx.setLineDash([ts * 0.18, ts * 0.14]);
    ctx.strokeStyle = 'rgba(120, 90, 60, .55)'; ctx.lineWidth = Math.max(1.2, ts * 0.04);
    lines.forEach((l, i) => {
      if (g.palisade[i].built) return;
      ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke();
    });
    ctx.setLineDash([]);
    // unbuilt bunks: an outline on the snow
    g.bunks.forEach((b, i) => {
      if (b.built) return;
      const p = P(C.SPOT.bunks[i].x, C.SPOT.bunks[i].y);
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(120, 90, 60, .5)'; ctx.lineWidth = 1.5;
      K.rrect(ctx, p.x + ts * 0.08, p.y + ts * 0.25, ts * 0.84, ts * 0.5, ts * 0.08); ctx.stroke();
      ctx.setLineDash([]);
    });
    // a tap: a ring on the ground
    for (const m of fx.marks) {
      const p = P(m.x, m.y), k = m.t / 0.45;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * (1 - k)})`;
      ctx.lineWidth = 2.5 * (1 - k) + 0.5;
      ell(ctx, p.x, p.y, ts * (0.18 + 0.32 * K.ease.outCubic(k)), ts * (0.1 + 0.18 * K.ease.outCubic(k))); ctx.stroke();
    }
    // a glint on the open water of the holes
    for (const [x, y] of [[44, 8], [44, 12], [44, 16]]) {
      const p = P(x + 0.5, y + 0.5);
      if (p.x < -ts || p.x > view.w + ts || p.y < -ts || p.y > view.h + ts) continue;
      const k = (time * 0.7 + x * 0.13 + y * 0.37) % 1;
      ctx.strokeStyle = `rgba(190, 230, 255, ${0.5 * (1 - k)})`; ctx.lineWidth = 1;
      ell(ctx, p.x, p.y, ts * (0.06 + k * 0.24), ts * (0.04 + k * 0.15)); ctx.stroke();
    }
  }

  function collect() {
    const ts = cam.ts, items = [];
    const xa = cam.x0 - 2, xb = cam.x0 + cam.vw + 2, ya = cam.y0 - 1, yb = cam.y0 + cam.vh + 3;
    const vis = (x, y) => x >= xa && x <= xb && y >= ya && y <= yb;
    const add = (y, x, draw, shadow) => items.push({ y, x, draw, shadow });
    // drifts
    for (let y = Math.max(0, Math.floor(ya)); y <= Math.min(C.H - 1, Math.ceil(yb)); y++) {
      for (let x = Math.max(0, Math.floor(xa)); x <= Math.min(C.W - 1, Math.ceil(xb)); x++) {
        if (g.tiles[C.idx(x, y)] !== 'D') continue;
        const v = Math.floor(hash(x, y, 70) * 3);
        add(y + 0.6, x, () => { const p = P(x + 0.5, y + 0.6); blit(driftSprite(v), p.x, p.y); },
          () => { const p = P(x + 0.5, y + 0.6); blit(lowShadow('d', 0.55, 0.7), p.x, p.y); });
      }
    }
    // the nodes
    for (const n of g.nodes) {
      if (!vis(n.x, n.y)) continue;
      const fx0 = n.x + 0.5, fy0 = n.y + 0.78;
      if (n.amount <= 0) {
        if (n.kind === 'tree') add(fy0, fx0, () => { const p = P(fx0, fy0); blit(stumpSprite(), p.x, p.y); }, () => { const p = P(fx0, fy0); blit(lowShadow('s', 0.22, 0.35), p.x, p.y); });
        continue;
      }
      const v = n.id % 4;
      if (n.kind === 'tree') {
        add(fy0, fx0, () => {
          const p = P(fx0, fy0), hit = nodeHit.get(n.id), dt0 = hit == null ? 9 : time - hit;
          // a tree standing in front of the hero turns see-through so he never gets lost behind it
          const hx = g.hero.x - fx0, hy = fy0 - g.hero.y;
          const fade = !g.hero.sleeping && Math.abs(hx) < 0.75 && hy > 0.05 && hy < 2.3;
          if (fade) ctx.globalAlpha = 0.5;
          if (dt0 < 0.45) {
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(dt0 * 38) * 0.07 * (1 - dt0 / 0.45));
            blit(treeSprite(v), 0, 0); ctx.restore();
          } else blit(treeSprite(v), p.x, p.y);
          ctx.globalAlpha = 1;
        }, () => { const p = P(fx0, fy0); blit(treeShadow(v), p.x, p.y); });
      } else if (n.kind === 'rock') {
        const sc = 0.72 + 0.28 * (n.amount / n.max);
        add(fy0, fx0, () => { const p = P(fx0, fy0); blit(rockSprite(v % 3), p.x, p.y, sc); }, () => { const p = P(fx0, fy0); blit(lowShadow('r', 0.5 * sc, 0.75 * sc), p.x, p.y); });
      } else if (n.kind === 'bush') {
        add(fy0, fx0, () => {
          const p = P(fx0, fy0);
          blit(bushSprite(v % 2), p.x, p.y);
          const bs = berrySprite();
          for (let k = 0; k < Math.min(5, n.amount); k++) blit(bs, p.x + BERRIES[k][0] * ts, p.y + BERRIES[k][1] * ts);
        }, () => { const p = P(fx0, fy0); blit(lowShadow('b', 0.4, 0.5), p.x, p.y); });
      } else {
        add(fy0, fx0, () => { const p = P(fx0, fy0); blit(scrapSprite(), p.x, p.y); }, () => { const p = P(fx0, fy0); blit(lowShadow('m', 0.45, 0.5), p.x, p.y); });
      }
    }
    // the camp
    const H = C.HUT;
    const heroIn = !g.hero.sleeping && g.hero.x >= H.x - 0.3 && g.hero.x <= H.x + H.w + 0.3 && g.hero.y >= H.y - 1.4 && g.hero.y < H.y + H.h;
    if (vis(H.x + 1, H.y + 1)) {
      add(H.y + H.h, H.x, () => drawHut(heroIn ? 0.5 : 1), () => {
        const p = P(H.x, H.y + H.h);
        const rise = g.hut.stage >= 2 ? 1.4 : g.hut.stage >= 1 ? 0.8 : 0.3;
        for (let k = 0; k <= 6; k++) K.shadow(ctx, p.x + (k / 6) * H.w * ts + ts * 0.35 * rise, p.y - ts * 0.75 + ts * 0.18 * rise, ts * 0.65, ts * (0.85 + 0.15 * rise), 0.18);
      });
    }
    const bench = C.SPOT.bench;
    add(bench.y + 0.7, bench.x + 0.5, () => { const p = P(bench.x + 0.5, bench.y + 0.7); blit(benchSprite(), p.x, p.y); }, () => { const p = P(bench.x + 0.5, bench.y + 0.7); blit(lowShadow('w', 0.45, 0.6), p.x, p.y); });
    g.bunks.forEach((b, i) => {
      if (!b.built) return;
      const s = C.SPOT.bunks[i], pk = 'bunk' + i;
      add(s.y + 0.75, s.x + 0.5, () => {
        const p = P(s.x + 0.5, s.y + 0.75), pt = pops[pk] == null ? 9 : time - pops[pk];
        blit(bunkSprite(), p.x, p.y, pt < 0.5 ? K.ease.outBack(pt / 0.5) : 1);
      }, () => { const p = P(s.x + 0.5, s.y + 0.75); blit(lowShadow('k', 0.48, 0.5), p.x, p.y); });
    });
    const F = C.SPOT.fire;
    add(F.y + 0.55, F.x + 0.5, () => { const p = P(F.x + 0.5, F.y + 0.55); drawFire(p.x, p.y); });
    for (const tc of g.torches) {
      add(tc.y + 0.7, tc.x + 0.5, () => {
        const p = P(tc.x + 0.5, tc.y + 0.7);
        blit(torchSprite(), p.x, p.y);
        K.glow(ctx, p.x, p.y - ts * 0.92, ts * 0.55, '#ff9a3a', 0.6);
        flame(p.x, p.y - ts * 0.84, ts * 0.08, ts * 0.3, tc.x * 3 + tc.y);
      }, () => { const p = P(tc.x + 0.5, tc.y + 0.7); blit(lowShadow('t', 0.14, 0.7), p.x, p.y); });
    }
    // the palisade, stake by stake; a segment going up shows the stakes already paid for
    const segs = [[C.BASE.x0, C.BASE.y0, C.BASE.x1 + 1, C.BASE.y0], [C.BASE.x1 + 1, C.BASE.y0, C.BASE.x1 + 1, C.BASE.y1 + 1],
      [C.BASE.x0, C.BASE.y1 + 1, C.BASE.x1 + 1, C.BASE.y1 + 1], [C.BASE.x0, C.BASE.y0, C.BASE.x0, C.BASE.y1 + 1]];
    segs.forEach(([x0, y0, x1, y1], i) => {
      const p = g.palisade[i];
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.35));
      const upTo = p.built ? n : Math.floor(n * Math.min(1, (p.paid.wood || 0) / C.PALISADE_COST.wood));
      if (upTo <= 0) return;
      const bad = p.built && p.hp <= C.PALISADE_HP * 0.4;
      const pk = 'pal' + i, horiz = y0 === y1;
      const stakes = [];
      for (let k = 0; k <= Math.min(n, upTo); k++) {
        if (p.built && p.hp <= 0 && k % 3 === 1) continue;
        stakes.push({ x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n, tilt: bad ? (hash(i, k, 5) - 0.5) * 0.35 : (hash(i, k, 5) - 0.5) * 0.06 });
      }
      const drawStakes = (list) => {
        const pt = pops[pk] == null ? 9 : time - pops[pk];
        const s = stakeSprite(bad);
        for (let j = 0; j < list.length; j++) {
          const st = list[j], q = P(st.x, st.y);
          const local = pt - (horiz ? st.x - x0 : st.y - y0) * 0.03;
          const sc = local < 0 ? 0.01 : local < 0.4 ? Math.max(0.01, K.ease.outBack(local / 0.4)) : 1;
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(st.tilt); ctx.scale(1, sc);
          blit(s, 0, 0); ctx.restore();
        }
      };
      const shadowStakes = (list) => { for (const st of list) { const q = P(st.x, st.y); K.shadow(ctx, q.x + ts * 0.2, q.y + ts * 0.06, ts * 0.26, ts * 0.08, 0.28); } };
      if (horiz) {
        if (y0 < ya || y0 > yb) return;
        add(y0, x0, () => drawStakes(stakes), () => shadowStakes(stakes));
      } else {
        // a north–south run: one item per tile row so people sort against it
        for (let r = Math.floor(y0); r < y1; r++) {
          const row = stakes.filter((s) => s.y >= r && s.y < r + 1 || (r === y1 - 1 && s.y === y1));
          if (!row.length || !vis(x0, r)) continue;
          add(r + 0.5, x0, () => drawStakes(row), () => shadowStakes(row));
        }
      }
    });
    // animals, wolves, people
    for (const a of g.animals) {
      if (!vis(a.x, a.y)) continue;
      const r = a.kind === 'deer' ? 0.36 : 0.2;
      add(a.y + 0.3, a.x, () => (a.kind === 'deer' ? drawDeer(a) : drawRabbit(a)), () => { const p = P(a.x, a.y + 0.3); K.shadow(ctx, p.x + ts * 0.05, p.y, ts * r, ts * r * 0.36, 0.3); });
    }
    for (const w of g.wolves) {
      if (!vis(w.x, w.y)) continue;
      add(w.y + 0.28, w.x, () => drawWolf(w, false), () => { const p = P(w.x, w.y + 0.28); K.shadow(ctx, p.x + ts * 0.05, p.y, ts * 0.38, ts * 0.12, 0.32); });
    }
    for (const s of g.survivors) {
      if (s.state === 'dead') continue;
      if (s.state === 'waiting' && C.SURVIVORS[s.id].need === 'day' && C.isNight(g)) continue;
      if (!vis(s.x, s.y)) continue;
      const look = LOOK[s.id];
      const job = s.state === 'home' && s.busy && HOME_JOB[s.id];
      const work = job && { kind: job, period: 1.1, cd: 1.1 - ((time + s.x) % 1.1), x: s.x + 0.45 };
      add(s.y + 0.28, s.x, () => { if (work) drawWorkBlock(job, s.x + 0.45, s.y); drawPerson(s, look, { work }); }, () => { const p = P(s.x, s.y + 0.28); K.shadow(ctx, p.x + ts * 0.04, p.y, ts * 0.24, ts * 0.09, 0.32); });
    }
    if (!g.hero.sleeping) {
      const h = g.hero;
      add(h.y + 0.28, h.x, () => drawPerson(h, LOOK.hero, { work: heroWork() }), () => { const p = P(h.x, h.y + 0.28); K.shadow(ctx, p.x + ts * 0.04, p.y, ts * 0.25, ts * 0.09, 0.34); });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    return items;
  }

  // The night: a dark layer with holes of light, drawn on its own canvas and laid over the scene; the warm pools
  // and the glows go on top of it.
  const holeSprite = () => K.bake('winter-hole', 128, (c, s) => {
    const grd = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.35, 'rgba(0,0,0,.95)');
    grd.addColorStop(0.7, 'rgba(0,0,0,.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, s, s);
  });
  function drawLight() {
    const d = V.darkness(g), ts = cam.ts;
    const tod = C.timeOfDay(g);
    // dusk and dawn: a warm wash over the snow
    const dusk = tod > C.NIGHT_AT - 25 && tod < C.NIGHT_AT + 5 ? Math.sin(((tod - (C.NIGHT_AT - 25)) / 30) * Math.PI) : tod < 12 ? (1 - tod / 12) * 0.7 : 0;
    // daylight from the top left: warm on the lit side, cool in the far corner
    ctx.fillStyle = lin(ctx, 0, 0, view.w, view.h, [[0, 'rgba(255, 236, 205, .12)'], [0.5, 'rgba(255, 255, 255, 0)'], [1, 'rgba(90, 120, 200, .12)']]);
    ctx.fillRect(0, 0, view.w, view.h);
    if (dusk > 0) {
      ctx.fillStyle = lin(ctx, 0, 0, view.w, view.h, [[0, `rgba(255, 150, 90, ${0.16 * dusk})`], [1, `rgba(180, 90, 160, ${0.12 * dusk})`]]);
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (d <= 0) return;
    // the dark layer is soft, so half the canvas resolution is plenty
    const dw = Math.ceil(canvas.width / 2), dh = Math.ceil(canvas.height / 2), k = view.dpr / 2;
    if (!darkCanvas || darkCanvas.width !== dw || darkCanvas.height !== dh) {
      darkCanvas = document.createElement('canvas');
      darkCanvas.width = dw;
      darkCanvas.height = dh;
    }
    const dc = darkCanvas.getContext('2d');
    dc.setTransform(k, 0, 0, k, 0, 0);
    dc.globalCompositeOperation = 'source-over';
    dc.clearRect(0, 0, view.w, view.h);
    dc.fillStyle = `rgba(10, 18, 52, ${d})`;
    dc.fillRect(0, 0, view.w, view.h);
    dc.globalCompositeOperation = 'destination-out';
    const ls = V.lights(g).concat([{ x: g.hero.x, y: g.hero.y, r: 1.6, hero: true }]);
    const hole = holeSprite();
    for (const l of ls) {
      const p = P(l.x, l.y), r = l.r * ts * (0.97 + 0.04 * Math.sin(time * 7 + l.x));
      dc.drawImage(hole, p.x - r * 1.15, p.y - r * 1.05, r * 2.3, r * 2.1);
    }
    // the warm pools around the flames, tinted into the same layer
    dc.globalCompositeOperation = 'source-over';
    const warm = dot('#ff8a30');
    for (const l of ls) {
      if (l.hero) continue;
      const p = P(l.x, l.y), r = l.r * ts * (1 + 0.04 * Math.sin(time * 9 + l.y));
      dc.globalAlpha = 0.42 * d;
      dc.drawImage(warm, p.x - r, p.y - r * 0.85, r * 2, r * 1.7);
    }
    dc.globalAlpha = 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(darkCanvas, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    // the eyes of the wolves and the flames shine through
    for (const w of g.wolves) drawWolf(w, true);
    if (C.fireOn(g)) { const p = P(C.SPOT.fire.x + 0.5, C.SPOT.fire.y + 0.4); K.glow(ctx, p.x, p.y, ts * 0.8, '#ffb050', 0.5 * d); }
  }

  function drawSnow() {
    const blz = C.isBlizzard(g);
    const sp = dot('#ffffff');
    for (const f of flakes) {
      if (blz) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 + f.s * 0.2})`;
        ctx.lineWidth = f.s;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x - f.s * 7, f.y - f.s * 2); ctx.stroke();
      } else ctx.drawImage(sp, f.x - f.s * 1.6, f.y - f.s * 1.6, f.s * 3.2, f.s * 3.2);
    }
    if (blz) {
      ctx.fillStyle = 'rgba(220, 230, 245, .18)';
      ctx.fillRect(0, 0, view.w, view.h);
      const fog = dot('#eef4fb');
      for (let k = 0; k < 6; k++) {
        const x = ((time * 60 + k * 197) % (view.w + 400)) - 200, y = (k * 0.17 + 0.05) * view.h + Math.sin(time * 0.5 + k) * 20;
        ctx.globalAlpha = 0.35;
        ctx.drawImage(fog, x - 180, y - 90, 360, 180);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawMarkers() {
    const ts = cam.ts;
    // waiting survivors: a bobbing badge over the head
    for (const s of g.survivors) {
      if (s.state !== 'waiting') continue;
      if (C.SURVIVORS[s.id].need === 'day' && C.isNight(g)) continue;
      const p = P(s.x, s.y);
      if (p.x < -ts || p.y < -ts || p.x > view.w + ts || p.y > view.h + ts * 2) continue;
      const y = p.y - ts * 0.95 + Math.sin(time * 4) * 3, sc = 1 + 0.08 * Math.sin(time * 8);
      K.glow(ctx, p.x, y, ts * 0.45, '#ffd34d', 0.35);
      K.sphere(ctx, p.x, y, ts * 0.2 * sc, '#ffc53a', { shine: 0.6 });
      K.text(ctx, '!', p.x, y + 1, { size: Math.round(ts * 0.32), color: '#ffffff', stroke: '#9a5a00' });
    }
    // survivors who still wait or follow, off screen
    for (const s of g.survivors) {
      if (s.state !== 'waiting' && s.state !== 'following') continue;
      const m = V.edgeMarker(cam, s.x, s.y);
      if (!m) continue;
      const col = s.state === 'following' ? '#8fe39a' : '#ffd34d';
      const pulse = 1 + 0.12 * Math.sin(time * 5);
      K.glow(ctx, m.x, m.y, 16, col, 0.35);
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = col;
      ctx.strokeStyle = 'rgba(20, 16, 40, .7)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-3, 0); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.stroke(); ctx.fill();
      ctx.restore();
    }
  }

  function drawWorld(dt) {
    // the camera eases after the hero; the tap mapping reads this same camera
    const target = { x: g.hero.x, y: g.hero.y };
    if (!camFocus) camFocus = { ...target };
    camFocus.x = K.damp(camFocus.x, target.x, 0.995, dt);
    camFocus.y = K.damp(camFocus.y, target.y, 0.995, dt);
    if (Math.abs(camFocus.x - target.x) < 0.004 && Math.abs(camFocus.y - target.y) < 0.004) { camFocus.x = target.x; camFocus.y = target.y; }
    cam = V.camera(view, camFocus);
    const off = shake.offset();
    ctx.save();
    ctx.translate(off.x, off.y);
    drawGround(off);
    drawDecals();
    const items = collect();
    for (const it of items) if (it.shadow) it.shadow();
    for (const it of items) it.draw();
    if (g.hero.sleeping) drawSleeper(g.hero);
    // smoke from the chimney when the stove burns
    if (C.stoveOn(g) && Math.random() < dt * 5) {
      const ts = cam.ts;
      emit({ x: (C.HUT.x + 2.22) * ts, y: (C.HUT.y - 1.55) * ts, vx: 8 + Math.random() * 6, vy: -18 - Math.random() * 8, life: 2.2, size: ts * 0.12, grow: ts * 0.14, color: '#e6ecf4', shape: 'smoke', alpha: 0.8 });
    }
    // particles and floating numbers live in world pixels
    ctx.save();
    ctx.translate(-cam.x0 * cam.ts, -cam.y0 * cam.ts);
    parts.draw(ctx);
    ctx.restore();
    drawLight();
    drawSnow();
    ctx.restore();
    K.vignette(ctx, view.w, view.h, 0.28);
    if (fx.hurt > 0) {
      const red = K.bake('winter-hurt', 128, (c, s) => {
        const grd = c.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.72);
        grd.addColorStop(0, 'rgba(255, 30, 30, 0)');
        grd.addColorStop(1, 'rgba(255, 30, 30, 1)');
        c.fillStyle = grd;
        c.fillRect(0, 0, s, s);
      });
      ctx.globalAlpha = Math.min(1, fx.hurt * 2.5);
      ctx.drawImage(red, 0, 0, view.w, view.h);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(-cam.x0 * cam.ts, -cam.y0 * cam.ts);
    floaters.draw(ctx);
    ctx.restore();
    drawMarkers();
  }

  // world tile coords → world pixels for the particles
  const emit = (p) => parts.emit(p);
  function burst(x, y, n, o) { parts.burst(x * cam.ts, y * cam.ts, n, o); }

  // Effects for what happened in the world.
  function effects(e) {
    const ts = cam.ts;
    switch (e.type) {
      case 'gather': {
        const cx = e.x + 0.5, cy = e.y + 0.5;
        if (e.kind === 'tree') {
          const nd = g.nodes.find((n) => n.x === e.x && n.y === e.y);
          if (nd) nodeHit.set(nd.id, time);
          burst(cx, cy + 0.15, 6, { colors: ['#c8935a', '#8a5a32', '#e2b98a'], shape: 'chunk', speed: ts * 2.4, size: ts * 0.07, gravity: ts * 9, life: 0.6, spin: 12, angle: -Math.PI / 2, spread: 2.4 });
          burst(cx, cy - 0.9, 10, { color: '#ffffff', speed: ts * 1.2, size: ts * 0.04, gravity: ts * 4, life: 0.9, drag: 0.6 });
        } else if (e.kind === 'rock') {
          burst(cx, cy, 7, { colors: ['#9aa3b0', '#6f7784', '#c9d0da'], shape: 'chunk', speed: ts * 2.6, size: ts * 0.08, gravity: ts * 10, life: 0.6, spin: 10, angle: -Math.PI / 2, spread: 2.6 });
          burst(cx, cy - 0.2, 4, { color: '#fff3c0', shape: 'spark', speed: ts * 3, size: 1.5, life: 0.3 });
        } else if (e.kind === 'bush') {
          burst(cx, cy - 0.2, 5, { colors: ['#e0303e', '#ff6a6a', '#4f8a50'], speed: ts * 1.6, size: ts * 0.05, gravity: ts * 8, life: 0.6, angle: -Math.PI / 2, spread: 2.2 });
        } else {
          burst(cx, cy - 0.2, 6, { color: '#ffe0a0', shape: 'spark', speed: ts * 3.2, size: 1.6, life: 0.35 });
          burst(cx, cy, 4, { colors: ['#9aa4b0', '#9a4f2a'], shape: 'chunk', speed: ts * 2, size: ts * 0.06, gravity: ts * 9, life: 0.5, spin: 10, angle: -Math.PI / 2, spread: 2.4 });
        }
        break;
      }
      case 'fish': burst(e.x + 0.5, e.y + 0.5, 8, { colors: ['#bfe6ff', '#ffffff'], speed: ts * 1.8, size: ts * 0.04, gravity: ts * 8, life: 0.6, angle: -Math.PI / 2, spread: 2 }); break;
      case 'hunt':
      case 'wolfDead': burst(e.x, e.y, 12, { colors: ['#ffffff', '#e8eef6', '#d0dae8'], shape: 'smoke', speed: ts * 1.4, size: ts * 0.1, grow: ts * 0.2, life: 0.6, drag: 0.8 }); break;
      case 'hitWolf': burst(e.x, e.y - 0.2, 6, { colors: ['#c9ccd4', '#ffffff'], speed: ts * 2, size: ts * 0.05, life: 0.4, drag: 0.6 }); shake.add(0.25); break;
      case 'bite': if (e.who === 'hero') shake.add(0.45); break;
      case 'feed': if (!e.stove) burst(C.SPOT.fire.x + 0.5, C.SPOT.fire.y + 0.3, 14, { colors: ['#ffd27a', '#ff8a2a', '#fff2b0'], shape: 'spark', speed: ts * 2.6, size: 2, life: 0.6, angle: -Math.PI / 2, spread: 1.4, gravity: ts * 2 }); break;
      case 'torch': burst(e.x + 0.5, e.y - 0.1, 10, { colors: ['#ffd27a', '#ff8a2a'], shape: 'spark', speed: ts * 2.2, size: 1.8, life: 0.5 }); break;
      case 'dig': burst(e.x + 0.5, e.y + 0.5, 12, { color: '#ffffff', speed: ts * 2.2, size: ts * 0.06, gravity: ts * 8, life: 0.7, angle: -Math.PI / 2, spread: 2.6 }); break;
      case 'built': {
        let cx, cy, w = 1;
        if (e.id === 'hut') { pops.hut = time; cx = C.HUT.x + 1.5; cy = C.HUT.y + C.HUT.h; w = 3; }
        else if (e.id === 'bunk') { pops['bunk' + e.bunk] = time; cx = C.SPOT.bunks[e.bunk].x + 0.5; cy = C.SPOT.bunks[e.bunk].y + 0.75; }
        else {
          pops['pal' + e.segment] = time;
          const B = C.BASE, mid = [[(B.x0 + B.x1 + 1) / 2, B.y0], [B.x1 + 1, (B.y0 + B.y1 + 1) / 2], [(B.x0 + B.x1 + 1) / 2, B.y1 + 1], [B.x0, (B.y0 + B.y1 + 1) / 2]][e.segment];
          cx = mid[0]; cy = mid[1]; w = 4;
        }
        for (let k = 0; k < 5; k++) burst(cx + (k / 4 - 0.5) * w, cy, 3, { colors: ['#efe6d8', '#ffffff', '#d8cbb8'], shape: 'smoke', speed: ts * 1.4, size: ts * 0.12, grow: ts * 0.3, life: 0.8, drag: 0.85 });
        burst(cx, cy - 0.8, 10, { colors: ['#ffd34d', '#ffffff', '#ffb347'], shape: 'star', speed: ts * 3, size: ts * 0.09, gravity: ts * 5, life: 0.9, spin: 6 });
        shake.add(0.3);
        break;
      }
      default: break;
    }
  }

  // The hut grows with every contribution, not only on finished stages.
  let hutKey = null;
  function watchHut() {
    const key = `${g.hut.stage}|${Math.round(stageProgress() * 8)}`;
    if (hutKey && hutKey.g === g && hutKey.key !== key) {
      if (pops.hut == null || time - pops.hut > 0.6) pops.hut = time;
      for (let k = 0; k < 4; k++) burst(C.HUT.x + 0.4 + k * 0.75, C.HUT.y + C.HUT.h, 2, { colors: ['#efe6d8', '#ffffff'], shape: 'smoke', speed: cam.ts * 1.2, size: cam.ts * 0.1, grow: cam.ts * 0.25, life: 0.7, drag: 0.85 });
    }
    // a palisade segment paid in part pops its new stakes too
    const pk = g.palisade.map((p) => (p.built ? 'b' : p.paid.wood || 0)).join(',');
    if (hutKey && hutKey.g === g && hutKey.pal !== pk) {
      const old = hutKey.pal.split(',');
      pk.split(',').forEach((v, i) => { if (v !== old[i] && v !== 'b') pops['pal' + i] = time; });
    }
    hutKey = { g, key, pal: pk };
  }

  // Footprints, sparks from the fire, the world's effects over time.
  function worldTick(dt) {
    parts.update(dt);
    floaters.update(dt);
    shake.update(dt);
    fx.marks = fx.marks.filter((m) => (m.t += dt) < 0.45);
    const h = g.hero;
    if (lastHero && lastHero.g === g) {
      const d = Math.hypot(h.x - lastHero.x, h.y - lastHero.y);
      if (d > 0 && d < 1) {
        stepAcc += d;
        if (stepAcc > 0.36 && !isIce(tileOf(Math.floor(h.x), Math.floor(h.y)))) {
          stepAcc = 0;
          const a = Math.atan2(h.y - lastHero.y, h.x - lastHero.x), side = steps.length % 2 ? 1 : -1;
          steps.push({ x: h.x - Math.sin(a) * side * 0.08, y: h.y + 0.26 + Math.cos(a) * side * 0.05, a, t: time });
          if (steps.length > 70) steps.shift();
        }
      }
    }
    lastHero = { g, x: h.x, y: h.y };
    if (C.fireOn(g) && Math.random() < dt * (3 + g.fire.fuel / 3)) {
      const ts = cam.ts;
      emit({ x: (C.SPOT.fire.x + 0.5 + (Math.random() - 0.5) * 0.3) * ts, y: (C.SPOT.fire.y + 0.3) * ts, vx: (Math.random() - 0.5) * ts, vy: -ts * (1.4 + Math.random()), life: 0.9 + Math.random() * 0.5, size: 1.3, color: Math.random() < 0.5 ? '#ffc861' : '#ff7a2a', shape: 'spark', drag: 0.3 });
    } else if (!C.fireOn(g) && Math.random() < dt * 2) {
      const ts = cam.ts;
      emit({ x: (C.SPOT.fire.x + 0.5) * ts, y: (C.SPOT.fire.y + 0.4) * ts, vx: 4, vy: -ts * 0.6, life: 1.6, size: ts * 0.06, grow: ts * 0.12, color: '#9aa0aa', shape: 'smoke', alpha: 0.5 });
    }
    watchHut();
  }

  // ── The menu backdrop: a snowy forest at dusk, baked once per size ──
  let menuBg = null;
  function drawMenuScene() {
    cam = V.camera(view, null);
    const key = `${view.w}x${view.h}@${view.dpr}`;
    if (!menuBg || menuBg.key !== key) {
      const cv = document.createElement('canvas');
      const k = SPR_DPR();
      cv.width = Math.ceil(view.w * k); cv.height = Math.ceil(view.h * k);
      const c = cv.getContext('2d');
      c.setTransform(k, 0, 0, k, 0, 0);
      c.fillStyle = lin(c, 0, 0, 0, view.h, [[0, '#33456e'], [0.35, '#8ea6cc'], [0.6, '#dbe6f3'], [1, '#eef4fb']]);
      c.fillRect(0, 0, view.w, view.h);
      soft(c, '#ffd9b0', view.w * 0.75, view.h * 0.3, view.w * 0.5, view.h * 0.18, 0.5);
      // rows of firs from far to near
      const rows = 6;
      for (let r = 0; r < rows; r++) {
        const y0 = view.h * (0.3 + r * 0.13), sc = 0.55 + r * 0.22;
        if (r) { c.fillStyle = 'rgba(225, 233, 246, .22)'; c.fillRect(0, 0, view.w, view.h); }
        c.fillStyle = K.mix('#c9d7ea', '#f2f6fb', r / rows);
        c.beginPath(); c.moveTo(0, y0);
        for (let x = 0; x <= view.w; x += 20) c.lineTo(x, y0 - Math.sin(x * 0.01 + r * 2) * 8);
        c.lineTo(view.w, view.h); c.lineTo(0, view.h); c.fill();
        const n = Math.ceil(view.w / (cam.ts * 0.9 * sc)) + 1;
        for (let k2 = 0; k2 < n; k2++) {
          if (hash(k2, r, 90) < 0.35) continue;
          const x = (k2 + hash(k2, r, 91) * 0.8) * cam.ts * 0.9 * sc - cam.ts * 0.4;
          const y = y0 + hash(k2, r, 92) * cam.ts * 0.4 * sc;
          const s = treeSprite(Math.floor(hash(k2, r, 93) * 4));
          c.drawImage(s.cv, x - s.ax * sc, y - s.ay * sc, s.w * sc, s.h * sc);
        }
        c.globalAlpha = 1;
      }
      menuBg = { key, cv };
    }
    ctx.drawImage(menuBg.cv, 0, 0, view.w, view.h);
    const sp = dot('#ffffff');
    for (const f of flakes) ctx.drawImage(sp, f.x - f.s * 1.6, f.y - f.s * 1.6, f.s * 3.2, f.s * 3.2);
    K.vignette(ctx, view.w, view.h, 0.3);
  }

  // ───────────── Frame ─────────────
  function frame(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    time += dt;
    if (fx.banner > 0) { fx.banner -= dt; if (fx.banner <= 0) $('banner').hidden = true; }
    if (fx.hurt > 0) fx.hurt = Math.max(0, fx.hurt - dt);
    const blz = g && C.isBlizzard(g);
    for (const f of flakes) {
      f.y += f.v * dt * (blz ? 1.6 : 1); f.x += (blz ? 160 : 12 + Math.sin(time * 0.7 + f.v) * 10) * dt * f.s;
      if (f.y > view.h + 4) { f.y = -4; f.x = Math.random() * view.w; }
      if (f.x > view.w + 8) f.x = -8;
    }
    if (screen === 'play' && g && !paused && !overlay) {
      // keyboard walking
      const dx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      const dy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
      if (dx || dy || g.hero.dir) C.moveDir(g, dx, dy);
      const moving = !!(g.hero.path || g.hero.dir);
      C.step(g, dt);
      handle(C.drain(g));
      if (moving) { stepT -= dt; if (stepT <= 0) { stepT = 0.35; sfx('step'); } }
      sinceSave += dt;
      if (sinceSave >= SAVE_EVERY) saveCurrent();
      // the loops: the crackle near a fire, the wind in a blizzard
      const nearFire = C.fireOn(g) && Math.hypot(g.hero.x - C.SPOT.fire.x - 0.5, g.hero.y - C.SPOT.fire.y - 0.5) < 6;
      Sound.setLoop('crackle', nearFire ? 1 : 0);
      Sound.setLoop('wind', C.isBlizzard(g) ? 1 : C.isNight(g) ? 0.4 : 0.15);
      if (g.status !== 'playing') finish();
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    if (g) { worldTick(paused || overlay ? 0 : dt); drawWorld(dt); } else drawMenuScene();
    if (g && Math.floor(time * 4) !== Math.floor((time - dt) * 4)) renderHUD();
    // a frame that baked new ground or sprites may run long: the world does not jump ahead for that pause
    const spent = performance.now() - ts;
    if (spent > 40) last = ts + spent;
    requestAnimationFrame(frame);
  }

  // ───────────── Input ─────────────
  canvas.addEventListener('pointerdown', (e) => {
    if (screen !== 'play' || !g || paused || overlay) return;
    Sound.unlock();
    const r = canvas.getBoundingClientRect();
    const tile = V.tileAt(cam, e.clientX - r.left, e.clientY - r.top);
    if (tile) tap(tile.x, tile.y);
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code;
    if (k === 'KeyM') { toggleSound(); return; }
    if (k === 'Escape') {
      if (torchMode) { torchMode = false; return; }
      if (overlay === 'build' || overlay === 'bench') { closeOverlay(); return; }
      if (overlay === 'confirm') { showMenu(); return; }
      if (screen === 'play') { if (!paused) togglePause(); else showMenu(); return; }
      if (screen === 'result') showMenu();
      return;
    }
    if (screen !== 'play' || !g) return;
    Sound.unlock();
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { keys[k] = true; e.preventDefault(); return; }
    if (k === 'Space') { togglePause(); e.preventDefault(); return; }
    if (paused) return;
    if (k === 'KeyE' || k === 'Enter') act();
    else if (k === 'KeyF') eat();
    else if (k === 'KeyB') { if (overlay === 'build') closeOverlay(); else openBuild(); }
    else if (k === 'KeyT') { if (overlay === 'bench') closeOverlay(); else openBench(); }
  });
  document.addEventListener('keyup', (e) => { delete keys[e.code]; if (g && !Object.keys(keys).length) C.moveDir(g, 0, 0); });
  window.addEventListener('blur', () => { keys = {}; if (g) C.moveDir(g, 0, 0); if (screen === 'play' && !paused) togglePause(); });

  $('btn-continue').addEventListener('click', () => {
    Sound.unlock();
    const st = C.restore(save.current);
    if (!st) { save.current = null; persist(); showMenu(); return; }
    begin(st);
  });
  $('btn-normal').addEventListener('click', () => startDiff('normal'));
  $('btn-harsh').addEventListener('click', () => startDiff('harsh'));
  $('btn-confirm-no').addEventListener('click', showMenu);
  $('btn-confirm-yes').addEventListener('click', () => { save.current = null; save.dawn = null; persist(); begin(null, pendingDiff || 'normal'); });
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-act').addEventListener('click', () => { Sound.unlock(); act(); });
  $('btn-eat').addEventListener('click', eat);
  $('btn-build').addEventListener('click', openBuild);
  $('btn-bench').addEventListener('click', openBench);
  $('btn-build-close').addEventListener('click', closeOverlay);
  $('btn-bench-close').addEventListener('click', closeOverlay);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-pause-menu').addEventListener('click', showMenu);
  $('btn-res-menu').addEventListener('click', showMenu);
  $('btn-res-again').addEventListener('click', () => begin(null, g ? g.difficulty : 'normal'));
  $('btn-res-retry').addEventListener('click', () => {
    const st = C.retryDay(save);
    if (st) begin(st);
  });

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
  window.winterDebugGame = () => g;
  window.winterDebugCam = () => cam;
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
