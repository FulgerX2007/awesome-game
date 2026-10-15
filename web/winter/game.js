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
    flakes = Array.from({ length: Math.round((w * h) / 9000) }, () => ({ x: Math.random() * w, y: Math.random() * h, s: 0.5 + Math.random() * 1.5, v: 20 + Math.random() * 30 }));
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
  const float = (x, y, text, color) => fx.floats.push({ x, y, text, color, t: 0 });

  function handle(events) {
    for (const e of events) {
      switch (e.type) {
        case 'gather':
          if (e.kind === 'tree') sfx('chop');
          else if (e.kind === 'rock') sfx('mine');
          else sfx('pick');
          float(e.x + 0.5, e.y, `+${e.n}`, e.item === 'wood' ? '#d9a35b' : e.item === 'stone' ? '#c8ccd2' : e.item === 'metal' ? '#e7eef5' : '#ff7a6a');
          break;
        case 'fish': float(e.x + 0.5, e.y, '+1', '#9fd0ff'); sfx('pick'); break;
        case 'hunt': float(e.x, e.y - 0.5, e.kind === 'deer' ? '+3' : '+1', '#ff9a8a'); sfx('hit'); break;
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
  const P = (x, y) => V.toScreen(cam, x, y);

  function drawTiles() {
    const ts = cam.ts;
    const x0 = Math.max(0, Math.floor(cam.x0)), y0 = Math.max(0, Math.floor(cam.y0));
    const x1 = Math.min(C.W - 1, Math.ceil(cam.x0 + cam.vw)), y1 = Math.min(C.H - 1, Math.ceil(cam.y0 + cam.vh));
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, view.w, view.h);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = g.tiles[C.idx(x, y)], p = P(x, y);
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (c === '~' || c === 'o') {
        ctx.fillStyle = c === 'o' ? '#1d3a55' : '#b8d8ee';
        ctx.fillRect(p.x, p.y, ts + 1, ts + 1);
        if (c === '~' && n % 5 === 0) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.moveTo(p.x + ts * 0.2, p.y + ts * 0.3); ctx.lineTo(p.x + ts * 0.7, p.y + ts * 0.6); ctx.stroke(); }
        if (c === 'o') { ctx.fillStyle = '#0d2236'; ctx.beginPath(); ctx.ellipse(p.x + ts / 2, p.y + ts / 2, ts * 0.32, ts * 0.22, 0, 0, TAU); ctx.fill(); }
        continue;
      }
      const base = c === ':' ? '#dfe8f3' : c === 'D' ? '#f2f6fb' : '#eef3f9';
      ctx.fillStyle = base;
      ctx.fillRect(p.x, p.y, ts + 1, ts + 1);
      if (n % 7 === 0) { ctx.fillStyle = 'rgba(160,185,215,.25)'; ctx.fillRect(p.x + (n % ts), p.y + ((n >> 4) % ts), 3, 2); }
      if (c === ':') { ctx.strokeStyle = 'rgba(140,165,200,.45)'; ctx.beginPath(); ctx.arc(p.x + ts / 2, p.y + ts * 0.8, ts * 0.35, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
      if (c === 'D') { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(p.x + ts / 2, p.y + ts * 0.65, ts * 0.55, ts * 0.42, 0, Math.PI, 0); ctx.fill(); ctx.strokeStyle = 'rgba(150,175,210,.6)'; ctx.stroke(); }
    }
    // the camp ground: trodden snow
    const a = P(C.BASE.x0, C.BASE.y0), b = P(C.BASE.x1 + 1, C.BASE.y1 + 1);
    ctx.fillStyle = 'rgba(190,175,150,.25)';
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  function drawNode(n) {
    const ts = cam.ts, p = P(n.x, n.y), cx = p.x + ts / 2, cy = p.y + ts / 2;
    if (p.x < -ts || p.y < -ts * 2 || p.x > view.w + ts || p.y > view.h + ts) return;
    if (n.amount <= 0) {
      if (n.kind === 'tree') { ctx.fillStyle = '#7a5a3a'; ctx.beginPath(); ctx.ellipse(cx, cy + ts * 0.2, ts * 0.18, ts * 0.1, 0, 0, TAU); ctx.fill(); }
      return;
    }
    switch (n.kind) {
      case 'tree':
        ctx.fillStyle = '#5a3c22'; ctx.fillRect(cx - ts * 0.06, cy, ts * 0.12, ts * 0.45);
        ctx.fillStyle = '#2d5a3a';
        for (let k = 0; k < 3; k++) {
          const w = ts * (0.55 - k * 0.12), y = cy + ts * 0.2 - k * ts * 0.32;
          ctx.beginPath(); ctx.moveTo(cx - w, y); ctx.lineTo(cx, y - ts * 0.5); ctx.lineTo(cx + w, y); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.moveTo(cx - ts * 0.18, cy - ts * 0.55); ctx.lineTo(cx, cy - ts * 0.8); ctx.lineTo(cx + ts * 0.18, cy - ts * 0.55); ctx.fill();
        break;
      case 'rock':
        ctx.fillStyle = '#8a9099'; ctx.beginPath(); ctx.ellipse(cx, cy + ts * 0.1, ts * 0.42, ts * 0.32, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(cx - ts * 0.05, cy - ts * 0.12, ts * 0.28, ts * 0.1, 0, 0, TAU); ctx.fill();
        break;
      case 'bush':
        ctx.fillStyle = '#3d6a45'; ctx.beginPath(); ctx.arc(cx, cy + ts * 0.1, ts * 0.36, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d4363e';
        for (let k = 0; k < Math.min(5, n.amount); k++) { ctx.beginPath(); ctx.arc(cx + Math.cos(k * 1.3) * ts * 0.2, cy + Math.sin(k * 1.7) * ts * 0.15, ts * 0.06, 0, TAU); ctx.fill(); }
        ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(cx - ts * 0.25, cy - ts * 0.24, ts * 0.5, ts * 0.06);
        break;
      default: // scrap
        ctx.fillStyle = '#6a6460'; ctx.fillRect(cx - ts * 0.35, cy, ts * 0.7, ts * 0.25);
        ctx.fillStyle = '#9aa4ad'; ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.4); ctx.fillRect(-ts * 0.3, -ts * 0.08, ts * 0.5, ts * 0.12); ctx.restore();
        ctx.fillStyle = '#a0522d'; ctx.beginPath(); ctx.arc(cx + ts * 0.15, cy - ts * 0.05, ts * 0.12, 0, TAU); ctx.fill();
    }
  }

  function drawCamp() {
    const ts = cam.ts;
    // the hut by stage
    const h = P(C.HUT.x, C.HUT.y), hw = C.HUT.w * ts, hh = C.HUT.h * ts;
    const st = g.hut.stage;
    ctx.fillStyle = st >= 1 ? '#7a5532' : 'rgba(110,80,50,.5)';
    ctx.fillRect(h.x, h.y, hw, hh);
    if (st < 1) { ctx.strokeStyle = '#5a3c22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(h.x, h.y + hh); ctx.lineTo(h.x + hw * 0.3, h.y + hh * 0.3); ctx.moveTo(h.x + hw, h.y + hh); ctx.lineTo(h.x + hw * 0.75, h.y + hh * 0.4); ctx.stroke(); }
    if (st >= 2) {
      ctx.fillStyle = '#5a2e22';
      ctx.beginPath(); ctx.moveTo(h.x - ts * 0.2, h.y + ts * 0.3); ctx.lineTo(h.x + hw / 2, h.y - ts * 0.7); ctx.lineTo(h.x + hw + ts * 0.2, h.y + ts * 0.3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.moveTo(h.x + hw * 0.2, h.y - ts * 0.15); ctx.lineTo(h.x + hw / 2, h.y - ts * 0.7); ctx.lineTo(h.x + hw * 0.8, h.y - ts * 0.15); ctx.fill();
    }
    if (st >= 3) { ctx.fillStyle = '#3b2412'; ctx.fillRect(h.x + hw / 2 - ts * 0.25, h.y + hh - ts * 0.75, ts * 0.5, ts * 0.75); }
    if (st >= 4) {
      ctx.fillStyle = '#6a6460'; ctx.fillRect(h.x + hw * 0.72, h.y - ts * 0.6, ts * 0.3, ts * 0.6);
      if (C.stoveOn(g)) {
        ctx.fillStyle = 'rgba(220,220,230,.35)';
        for (let k = 0; k < 3; k++) { const yy = (time * 12 + k * 9) % 26; ctx.beginPath(); ctx.arc(h.x + hw * 0.78 + Math.sin(time + k) * 3, h.y - ts * 0.7 - yy, 3 + yy / 6, 0, TAU); ctx.fill(); }
        ctx.fillStyle = `rgba(255,170,80,${0.5 + 0.2 * Math.sin(time * 5)})`; ctx.fillRect(h.x + hw * 0.15, h.y + hh * 0.35, ts * 0.35, ts * 0.3);
      }
    }
    // workbench, bunks
    const wb = P(C.SPOT.bench.x, C.SPOT.bench.y);
    ctx.fillStyle = '#8a6a48'; ctx.fillRect(wb.x + ts * 0.1, wb.y + ts * 0.35, ts * 0.8, ts * 0.25);
    ctx.fillStyle = '#5a3c22'; ctx.fillRect(wb.x + ts * 0.15, wb.y + ts * 0.6, ts * 0.1, ts * 0.3); ctx.fillRect(wb.x + ts * 0.75, wb.y + ts * 0.6, ts * 0.1, ts * 0.3);
    g.bunks.forEach((b, i) => {
      const p = P(C.SPOT.bunks[i].x, C.SPOT.bunks[i].y);
      ctx.fillStyle = b.built ? '#9a7a52' : 'rgba(154,122,82,.25)';
      ctx.fillRect(p.x + ts * 0.05, p.y + ts * 0.25, ts * 0.9, ts * 0.5);
      if (b.built) { ctx.fillStyle = '#c85a4a'; ctx.fillRect(p.x + ts * 0.1, p.y + ts * 0.3, ts * 0.3, ts * 0.4); }
    });
    // the fire
    const f = P(C.SPOT.fire.x, C.SPOT.fire.y), fx0 = f.x + ts / 2, fy0 = f.y + ts / 2;
    ctx.fillStyle = '#4a3b2c';
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(fx0 + Math.cos(k) * ts * 0.35, fy0 + Math.sin(k) * ts * 0.3, ts * 0.1, 0, TAU); ctx.fill(); }
    if (C.fireOn(g)) {
      const fl = Math.min(1, g.fire.fuel / 8);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = ['#ff6a2a', '#ffb347', '#fff3b0'][k];
        const hgt = ts * (0.7 - k * 0.18) * (0.6 + 0.4 * fl) * (0.9 + 0.1 * Math.sin(time * 12 + k));
        ctx.beginPath(); ctx.moveTo(fx0 - ts * (0.25 - k * 0.06), fy0 + ts * 0.15); ctx.quadraticCurveTo(fx0, fy0 - hgt * 1.4, fx0 + ts * (0.25 - k * 0.06), fy0 + ts * 0.15); ctx.fill();
      }
    }
    // fuel bar
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(f.x, f.y + ts, ts, 3);
    ctx.fillStyle = '#ffb347'; ctx.fillRect(f.x, f.y + ts, ts * (g.fire.fuel / C.FIRE.cap), 3);
    // the palisade on the camp's border, segment by segment
    const seg = (i, x0, y0, x1, y1) => {
      const p = g.palisade[i];
      if (!p.built) {
        ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(120,90,60,.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / (ts * 0.35)));
      for (let k = 0; k <= n; k++) {
        if (p.hp <= 0 && k % 3 === 1) continue;
        const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n;
        ctx.fillStyle = p.hp > C.PALISADE_HP * 0.4 ? '#7a5532' : '#5a3c22';
        ctx.fillRect(x - ts * 0.08, y - ts * 0.35, ts * 0.16, ts * 0.45);
        ctx.fillStyle = '#fff'; ctx.fillRect(x - ts * 0.08, y - ts * 0.38, ts * 0.16, ts * 0.06);
      }
    };
    const A = P(C.BASE.x0, C.BASE.y0), B = P(C.BASE.x1 + 1, C.BASE.y1 + 1);
    seg(0, A.x, A.y, B.x, A.y);
    seg(1, B.x, A.y, B.x, B.y);
    seg(2, A.x, B.y, B.x, B.y);
    seg(3, A.x, A.y, A.x, B.y);
    // torches
    for (const tc of g.torches) {
      const p = P(tc.x, tc.y);
      ctx.fillStyle = '#5a3c22'; ctx.fillRect(p.x + ts * 0.45, p.y + ts * 0.3, ts * 0.1, ts * 0.55);
      ctx.fillStyle = `rgba(255,${160 + 40 * Math.sin(time * 9 + tc.x)},60,.95)`; ctx.beginPath(); ctx.arc(p.x + ts * 0.5, p.y + ts * 0.25, ts * 0.12, 0, TAU); ctx.fill();
    }
  }

  function drawPerson(e, color, hat, sleeping) {
    const ts = cam.ts, p = P(e.x, e.y);
    if (p.x < -ts || p.y < -ts || p.x > view.w + ts || p.y > view.h + ts) return;
    const bob = sleeping ? 0 : Math.sin(time * 8 + e.x) * ts * 0.03;
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + ts * 0.32, ts * 0.25, ts * 0.08, 0, 0, TAU); ctx.fill();
    if (sleeping) {
      ctx.fillStyle = color; ctx.fillRect(p.x - ts * 0.35, p.y - ts * 0.05, ts * 0.7, ts * 0.25);
      ctx.fillStyle = '#f0c9a0'; ctx.beginPath(); ctx.arc(p.x - ts * 0.35, p.y + ts * 0.05, ts * 0.13, 0, TAU); ctx.fill();
      ctx.fillStyle = '#cfe0ff'; ctx.font = `700 ${Math.round(ts * 0.4)}px system-ui`; ctx.fillText('z', p.x + ts * 0.2, p.y - ts * 0.25 - (time * 6 % 6));
      return;
    }
    ctx.fillStyle = color; ctx.fillRect(p.x - ts * 0.18, p.y - ts * 0.2 + bob, ts * 0.36, ts * 0.45);
    ctx.fillStyle = '#f0c9a0'; ctx.beginPath(); ctx.arc(p.x, p.y - ts * 0.3 + bob, ts * 0.15, 0, TAU); ctx.fill();
    ctx.fillStyle = hat; ctx.beginPath(); ctx.arc(p.x, p.y - ts * 0.34 + bob, ts * 0.16, Math.PI, 0); ctx.fill();
  }

  function drawAnimals() {
    const ts = cam.ts;
    for (const a of g.animals) {
      const p = P(a.x, a.y);
      if (p.x < -ts || p.y < -ts || p.x > view.w + ts || p.y > view.h + ts) continue;
      if (a.kind === 'rabbit') {
        ctx.fillStyle = '#f5f2ea'; ctx.beginPath(); ctx.ellipse(p.x, p.y + ts * 0.1, ts * 0.2, ts * 0.14, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(p.x + ts * 0.12, p.y - ts * 0.12, ts * 0.04, ts * 0.14, 0.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#333'; ctx.fillRect(p.x + ts * 0.15, p.y, 2, 2);
      } else {
        ctx.fillStyle = '#8a6040'; ctx.beginPath(); ctx.ellipse(p.x, p.y, ts * 0.38, ts * 0.2, 0, 0, TAU); ctx.fill();
        ctx.fillRect(p.x - ts * 0.3, p.y + ts * 0.1, ts * 0.06, ts * 0.3); ctx.fillRect(p.x + ts * 0.22, p.y + ts * 0.1, ts * 0.06, ts * 0.3);
        ctx.beginPath(); ctx.arc(p.x + ts * 0.38, p.y - ts * 0.2, ts * 0.12, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#5a3c22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x + ts * 0.38, p.y - ts * 0.3); ctx.lineTo(p.x + ts * 0.3, p.y - ts * 0.55); ctx.moveTo(p.x + ts * 0.42, p.y - ts * 0.3); ctx.lineTo(p.x + ts * 0.5, p.y - ts * 0.55); ctx.stroke();
      }
    }
  }

  function drawWolves() {
    const ts = cam.ts;
    for (const w of g.wolves) {
      const p = P(w.x, w.y);
      if (p.x < -ts || p.y < -ts || p.x > view.w + ts || p.y > view.h + ts) continue;
      ctx.fillStyle = '#5a5f6a'; ctx.beginPath(); ctx.ellipse(p.x, p.y, ts * 0.38, ts * 0.18, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(p.x + ts * 0.36, p.y - ts * 0.12, ts * 0.16, ts * 0.12, -0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(p.x + ts * 0.32, p.y - ts * 0.2); ctx.lineTo(p.x + ts * 0.36, p.y - ts * 0.38); ctx.lineTo(p.x + ts * 0.42, p.y - ts * 0.22); ctx.fill();
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(p.x + ts * 0.42, p.y - ts * 0.14, 2, 0, TAU); ctx.fill();
      if (w.hp < w.maxHp) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(p.x - ts * 0.3, p.y - ts * 0.5, ts * 0.6, 3); ctx.fillStyle = '#ff8a7a'; ctx.fillRect(p.x - ts * 0.3, p.y - ts * 0.5, ts * 0.6 * (w.hp / w.maxHp), 3); }
    }
  }

  // The night: a dark layer with holes of light, drawn on its own canvas and laid over the scene.
  function drawNight() {
    const d = V.darkness(g);
    const blz = C.isBlizzard(g);
    if (d > 0) {
      if (!darkCanvas || darkCanvas.width !== canvas.width || darkCanvas.height !== canvas.height) {
        darkCanvas = document.createElement('canvas');
        darkCanvas.width = canvas.width;
        darkCanvas.height = canvas.height;
      }
      const dc = darkCanvas.getContext('2d');
      dc.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      dc.globalCompositeOperation = 'source-over';
      dc.clearRect(0, 0, view.w, view.h);
      dc.fillStyle = `rgba(6,10,26,${d})`;
      dc.fillRect(0, 0, view.w, view.h);
      dc.globalCompositeOperation = 'destination-out';
      const lights = V.lights(g).concat([{ x: g.hero.x, y: g.hero.y, r: 1.6 }]);
      for (const l of lights) {
        const p = P(l.x, l.y), r = l.r * cam.ts * (0.95 + 0.05 * Math.sin(time * 7 + l.x));
        const grd = dc.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
        grd.addColorStop(0, 'rgba(0,0,0,1)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        dc.fillStyle = grd;
        dc.beginPath(); dc.arc(p.x, p.y, r, 0, TAU); dc.fill();
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(darkCanvas, 0, 0);
      ctx.restore();
    }
    // falling snow; a blizzard drives it sideways and veils the far view
    const wind = blz ? 160 : 12;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const f of flakes) ctx.fillRect(f.x, f.y, f.s * (blz ? 2 : 1), f.s);
    if (blz) { ctx.fillStyle = 'rgba(220,230,245,.28)'; ctx.fillRect(0, 0, view.w, view.h); }
    return wind;
  }

  function drawMarkers() {
    // survivors who still wait, off screen
    for (const s of g.survivors) {
      if (s.state !== 'waiting' && s.state !== 'following') continue;
      const m = V.edgeMarker(cam, s.x, s.y);
      if (!m) continue;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.fillStyle = s.state === 'following' ? '#8fe39a' : '#ffd34d';
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.fill();
      ctx.restore();
    }
    // tap marks and floating numbers
    fx.marks = fx.marks.filter((m) => (m.t += 1 / 60) < 0.4);
    for (const m of fx.marks) { const p = P(m.x, m.y); ctx.strokeStyle = `rgba(255,255,255,${1 - m.t / 0.4})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, cam.ts * (0.2 + m.t), 0, TAU); ctx.stroke(); }
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    fx.floats = fx.floats.filter((f) => (f.t += 1 / 60) < 1);
    for (const f of fx.floats) {
      const p = P(f.x, f.y);
      ctx.globalAlpha = 1 - f.t;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y - f.t * 24);
    }
    ctx.globalAlpha = 1;
    if (fx.hurt > 0) { ctx.fillStyle = `rgba(255,40,40,${fx.hurt})`; ctx.fillRect(0, 0, view.w, view.h); }
  }

  const ROLE_COLOR = { hunter: '#8a5a2c', carpenter: '#6a7a3a', herbalist: '#7a4a8a', smith: '#4a4a55', child: '#c85a4a' };

  function drawWorld() {
    cam = V.camera(view, g.hero);
    drawTiles();
    drawCamp();
    const sorted = g.nodes.filter((n) => n.y >= cam.y0 - 2 && n.y <= cam.y0 + cam.vh + 2).sort((a, b) => a.y - b.y);
    for (const n of sorted) drawNode(n);
    drawAnimals();
    for (const s of g.survivors) {
      if (s.state === 'dead') continue;
      if (s.state === 'waiting' && C.SURVIVORS[s.id].need === 'day' && C.isNight(g)) continue;
      drawPerson(s, ROLE_COLOR[s.id], '#3a3a44', false);
      if (s.state === 'waiting') {
        const p = P(s.x, s.y);
        ctx.fillStyle = '#ffd34d'; ctx.font = `800 ${Math.round(cam.ts * 0.5)}px system-ui`; ctx.textAlign = 'center';
        ctx.fillText('!', p.x, p.y - cam.ts * 0.6 + Math.sin(time * 4) * 2);
      }
    }
    drawPerson(g.hero, '#3d64b0', '#b3203a', g.hero.sleeping);
    drawWolves();
    drawNight();
    drawMarkers();
  }

  function drawMenuScene() {
    ctx.fillStyle = '#dfe8f3';
    ctx.fillRect(0, 0, view.w, view.h);
    for (let k = 0; k < 40; k++) {
      const x = (k * 97) % view.w, y = (k * 53) % view.h, s = 18 + (k % 4) * 6;
      ctx.fillStyle = '#2d5a3a';
      ctx.beginPath(); ctx.moveTo(x - s * 0.6, y); ctx.lineTo(x, y - s * 1.4); ctx.lineTo(x + s * 0.6, y); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x - s * 0.2, y - s); ctx.lineTo(x, y - s * 1.4); ctx.lineTo(x + s * 0.2, y - s); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const f of flakes) ctx.fillRect(f.x, f.y, f.s, f.s);
  }

  // ───────────── Frame ─────────────
  function frame(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    time += dt;
    if (fx.banner > 0) { fx.banner -= dt; if (fx.banner <= 0) $('banner').hidden = true; }
    if (fx.hurt > 0) fx.hurt = Math.max(0, fx.hurt - dt);
    for (const f of flakes) {
      f.y += f.v * dt; f.x += (g && C.isBlizzard(g) ? 160 : 12) * dt * f.s;
      if (f.y > view.h) { f.y = -2; f.x = Math.random() * view.w; }
      if (f.x > view.w) f.x = 0;
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
    if (g) drawWorld();
    else drawMenuScene();
    if (g && Math.floor(time * 4) !== Math.floor((time - dt) * 4)) renderHUD();
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
