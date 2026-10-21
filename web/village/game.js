'use strict';
// Родник — client: the game loop, the HUD, input and saving. Rules live in core.js (window.Village),
// pure camera/picking helpers in view.js (window.VillageView), the canvas art in art.js (window.VillageArt).
(() => {
  const V = window.Village;
  const VV = window.VillageView;
  const ART = window.VillageArt;
  const { TILE: T, STEP, hash2, lerp, clamp } = VV;
  const { t } = window.I18n;
  const SAVE_KEY = 'village.save';
  const CLOUD_KEY = 'village.cloud';
  const A = window.VillageAudio;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  let S = null;
  const canvas = $('scene');
  const share = (id) => V.share(S, id);

  // ───────────── People ─────────────
  const TOOL_OF = Object.fromEntries(Object.entries(V.NODE_KINDS).map(([kind, k]) => [kind, k.tool]));

  // Cosmetic state of the player: facing, walk cycle and the swing. `front` draws the player over a
  // villager standing on the same line.
  const P = { role: 'player', front: true, x: 0, y: 0, face: 'down', phase: 0, moving: false, swing: -1, tool: null };
  let prev = { x: 0, y: 0 };

  function updatePlayerLook(px, py, dt) {
    const dx = px - P.x, dy = py - P.y;
    const dist = Math.hypot(dx, dy);
    P.moving = dist > 0.0005;
    if (P.moving) P.phase += dist * 9;
    const tg = S.player.target;
    const node = tg && (tg.type === 'node' || tg.type === 'fish') ? S.nodes[tg.id] : null; // fishing: face the water, rod out
    if (node && !S.player.path) P.face = VV.facing(node.x + 0.5 - px, node.y + 0.5 - py, P.face);
    else P.face = VV.facing(dx, dy, P.face);
    if (node) P.tool = TOOL_OF[node.kind];
    if (P.swing >= 0) { P.swing += dt; if (P.swing > ART.SWING) P.swing = -1; }
    P.holding = !!node;
    P.x = px; P.y = py;
  }

  // ───────────── Villagers (cosmetic) ─────────────
  // They walk between their house door and a node of their trade; core.js counts their work on its own.
  // The node kind that gives each villager's resource.
  const ROLE_NODE = Object.fromEntries(Object.entries(V.VILLAGERS).map(([role, v]) => [role, Object.keys(V.NODE_KINDS).find((k) => V.NODE_KINDS[k].res === v.res)]));
  const folk = new Map();

  function doorOf(house) {
    const b = ART.BOX[house];
    const cands = [];
    for (let dx = 0; dx < b.w; dx++) cands.push({ x: b.x0 + dx, y: b.y0 + b.h });
    cands.push({ x: b.x0 - 1, y: b.y0 + b.h - 1 }, { x: b.x0 + b.w, y: b.y0 + b.h - 1 });
    return cands.find((c) => V.isWalkable(S, c.x, c.y)) || cands[0];
  }

  function workSpot(f) {
    const kind = ROLE_NODE[f.role];
    let best = null, bd = Infinity;
    for (const n of S.nodes) {
      if (n.kind !== kind) continue;
      const d = Math.abs(n.x - f.home.x) + Math.abs(n.y - f.home.y) + (n.hp > 0 ? 0 : 6) + hash2(n.id, f.seed, 600) * 8;
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) return null;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      if (V.isWalkable(S, best.x + dx, best.y + dy)) return { x: best.x + dx, y: best.y + dy, node: best };
    }
    return null;
  }

  function syncFolk() {
    for (const v of S.villagers) {
      if (folk.has(v.house) || !ART.BOX[v.house]) continue;
      const home = doorOf(v.house);
      folk.set(v.house, {
        role: v.role, home, seed: folk.size + 1, x: home.x + 0.5, y: home.y + 0.5,
        path: null, at: 'home', wait: 1 + folk.size * 2, beat: 0, face: 'down', phase: 0, moving: false, swing: -1, node: null,
      });
    }
  }

  function updateFolk(dt) {
    for (const f of folk.values()) {
      f.moving = false;
      if (f.swing >= 0) { f.swing += dt; if (f.swing > ART.SWING) f.swing = -1; }
      if (f.path) {
        let left = 1.7 * dt;
        while (f.path && left > 0) {
          const w = f.path[0], tx = w.x + 0.5, ty = w.y + 0.5;
          const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy);
          if (d > 1e-6) f.face = VV.facing(dx, dy, f.face);
          if (d <= left) { f.x = tx; f.y = ty; left -= d; f.path.shift(); if (!f.path.length) f.path = null; }
          else { f.x += (dx / d) * left; f.y += (dy / d) * left; left = 0; }
          f.moving = true;
        }
        if (f.moving) f.phase += 1.7 * dt * 9;
        if (!f.path) f.wait = f.at === 'work' ? 7 + hash2(f.seed, Math.floor(ART.time), 610) * 5 : 4 + hash2(f.seed, Math.floor(ART.time), 611) * 4;
        continue;
      }
      if (f.wait > 0) {
        f.wait -= dt;
        f.beat -= dt;
        if (f.at === 'work' && f.node && f.beat <= 0) {
          f.beat = 0.9 + Math.random() * 0.6;
          f.swing = 0;
          f.face = VV.facing(f.node.x + 0.5 - f.x, f.node.y + 0.5 - f.y, f.face);
          if (f.node.hp > 0) ART.chips(f.node.kind, (f.node.x + 0.5) * T, (f.node.y + 0.6) * T, 3);
        }
        continue;
      }
      // Plan the next walk: home → work spot → home.
      const from = { x: Math.floor(f.x), y: Math.floor(f.y) };
      let to = f.home;
      if (f.at === 'home') {
        const spot = workSpot(f);
        if (!spot) { f.wait = 6; continue; }
        to = spot;
        f.node = spot.node;
      }
      const path = V.findPath(S, from, to);
      if (!path) { f.wait = 5; f.at = 'home'; f.x = f.home.x + 0.5; f.y = f.home.y + 0.5; continue; }
      f.path = path.length ? path : null;
      f.at = f.at === 'home' ? 'work' : 'home';
      if (!f.path) f.wait = 2;
    }
  }

  // ───────────── Events from core.js ─────────────
  // The list is read and cleared once per frame; drawing effects, UI and sounds all hang on the same events.
  function handleEvents() {
    if (!S.events.length) return;
    const evs = S.events.splice(0);
    for (const e of evs) {
      uiEvent(e);
      const snd = VV.soundFor(e);
      if (snd) A.play(snd);
      if (e.type === 'hit') {
        P.swing = 0;
        P.tool = TOOL_OF[e.kind];
      }
      ART.onEvent(e, P.x);
    }
  }

  // Everyone the art draws this frame: the player and the villagers, with the tool each one holds.
  function people() {
    const list = [P];
    for (const f of folk.values()) {
      f.holding = f.at === 'work' && !f.path;
      f.tool = f.holding ? TOOL_OF[ROLE_NODE[f.role]] : null;
      list.push(f);
    }
    return list;
  }

  // ───────────── Frame ─────────────
  // The world steps in fixed STEP chunks; a long stall (a slow device, a debugger) is dropped after
  // MAX_STEPS_PER_FRAME steps instead of being caught up in one frame.
  const MAX_STEPS_PER_FRAME = 20;
  let acc = 0, last = 0;

  function frame(ms) {
    requestAnimationFrame(frame);
    const now = ms / 1000;
    const dt = Math.min(0.25, Math.max(0, now - (last || now)));
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS_PER_FRAME) {
      prev = { x: S.player.x, y: S.player.y };
      V.step(S, STEP);
      acc -= STEP;
      n++;
    }
    if (n >= MAX_STEPS_PER_FRAME) acc = 0;
    const a = clamp(acc / STEP, 0, 1);
    const px = lerp(prev.x, S.player.x, a), py = lerp(prev.y, S.player.y, a);
    updatePlayerLook(px, py, dt);
    handleEvents();
    syncFolk();
    updateFolk(dt);
    ART.update(dt);
    ART.draw(px, py, people());
    hudClock -= dt;
    if (hudClock <= 0) { hudClock = 0.25; renderHUD(); }
  }

  // ───────────── HUD ─────────────
  let hudClock = 0;
  const resName = (r) => t(V.RESOURCES[r].name);
  // "Дерево 30, Камень 20" — names first, so the Russian words stay in the nominative case.
  const costText = (cost) => Object.entries(cost).map(([r, n]) => `${resName(r)} ${n}`).join(', ');
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Set innerHTML only when it changed, so buttons under the pointer aren't replaced between press and release.
  function setHTML(el, html) { if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } }

  const FARM_HINT = { ripe: 'Урожай созрел — собери на огороде', water: 'Полей грядки на огороде', sow: 'Посади овощи на огороде' };
  function goalText(g) {
    if (placing) return t('Ставь: {name}', { name: t(V.DECOR[placing].name) });
    const farm = VV.farmHint(S, V);
    if (farm === 'ripe') return t(FARM_HINT[farm]);
    if (V.fairOpen(S) && V.fairItems(S).some((id) => !S.bought.includes(id) && S.res.coins >= V.FAIR[id].price)) return t('Сегодня ярмарка: загляни к рядам');
    if (S.orders.some((o) => V.canAfford(S, o.need))) return t('Заказ на доске можно выполнить');
    if (farm) return t(FARM_HINT[farm]);
    if (!g) return t('Осмотрись вокруг');
    if (g.type === 'build') return t('Восстановить: {name}', { name: t(V.BUILDINGS[g.id].name) });
    if (g.type === 'tool') return t('Нужен инструмент: {name}', { name: t(V.TOOLS[g.tool].name) });
    if (g.type === 'fair') return t('Купи на ярмарке: {name}', { name: t(V.FAIR[g.item].name) });
    return t('Украшай село');
  }

  // The six starting resources are always in the HUD; later ones show up once they matter: when their
  // building stands or once the player has had some.
  const BASE_RES = new Set(['wood', 'stone', 'clay', 'berries', 'planks', 'bricks']);
  const RES_UNLOCK = { vegetables: 'garden', honey: 'apiary', coins: 'market', grapes: 'vineyard', juice: 'press', fish: 'pier', smoked: 'smokehouse' };
  const resShown = (r) => BASE_RES.has(r) || S.res[r] > 0 || S.stats.gathered[r] > 0 || (RES_UNLOCK[r] && S.built[RES_UNLOCK[r]].done);

  function renderHUD() {
    const inc = VV.income(S, V);
    for (const r of V.RES_IDS) {
      const box = $(`r-${r}`).closest('.res-item');
      box.hidden = !resShown(r);
      if (box.hidden) continue;
      $(`r-${r}`).textContent = VV.fmt(S.res[r]);
      const rate = VV.fmtRate(inc.rate[r]);
      $(`r-${r}-rate`).textContent = rate ? t('{v}/мин', { v: rate }) : '';
      const full = inc.full.includes(r);
      box.classList.toggle('full', full);
      box.title = full ? t('Амбар полон: жители и мастерские ждут') : resName(r);
    }
    const done = V.BUILDING_IDS.filter((id) => S.built[id].done).length;
    $('built-label').textContent = t('Восстановлено {n}/{total}', { n: done, total: V.BUILDING_IDS.length });
    $('goal-text').textContent = goalText(V.nextGoal(S));
    renderClock();
    const bucket = $('bucket-label');
    bucket.hidden = !S.built.garden.done;
    if (!bucket.hidden) bucket.textContent = t('Ведро {n}/{max}', { n: S.bucket, max: V.bucketSize(S) });
    if (openId === 'panel-building') renderBuilding();
    else if (openId === 'panel-buildings') renderBuildings();
    else if (openId === 'panel-tools') renderTools();
  }

  // The season and the day in the header, with the sun or the moon by the hour.
  const SEASON_NAMES = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' };
  function renderClock() {
    const c = V.clock(S.t);
    const icon = c.part === 'night' || c.part === 'dusk' ? '☾' : '☀';
    const text = `${icon} ${t('{season} · день {n}', { season: t(SEASON_NAMES[c.season]), n: c.seasonDay + 1 })}`;
    const el = $('clock-label');
    if (el.textContent !== text) el.textContent = text;
    A.setScene(c.part, c.season);
  }

  // ───────────── Floats and toasts ─────────────
  function float(text, wx, wy, cls = '') {
    const el = document.createElement('div');
    el.className = `float ${cls}`.trim();
    el.textContent = text;
    el.style.left = `${Math.round(wx - ART.cam.x)}px`;
    el.style.top = `${Math.round(wy - ART.cam.y)}px`;
    $('floats').append(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 3000); // in case animations are off
  }

  let toastTimer = 0;
  function toast(text, ms = 2600) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ───────────── Modal ─────────────
  // actions: [{ label, primary?, danger?, run? }]; any button closes the window.
  function modal(title, bodyHTML, actions) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHTML;
    const row = $('modal-actions');
    row.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`;
      b.textContent = a.label;
      b.addEventListener('click', () => { closeModal(); if (a.run) a.run(); });
      row.append(b);
    }
    $('modal').hidden = false;
    const focus = row.querySelector('.primary') || row.lastElementChild;
    if (focus) focus.focus();
  }
  const closeModal = () => { $('modal').hidden = true; };
  const modalOpen = () => !$('modal').hidden;

  // ───────────── Panels ─────────────
  const PANELS = ['panel-building', 'panel-buildings', 'panel-tools', 'panel-settings'];
  let openId = null;      // the panel on screen
  let buildingId = null;  // the building shown in panel-building

  function openPanel(id) {
    for (const p of PANELS) $(p).hidden = p !== id;
    openId = id;
    renderHUD();
  }
  function closePanels() {
    for (const p of PANELS) $(p).hidden = true;
    openId = null;
    buildingId = null;
  }
  const togglePanel = (id) => (openId === id ? closePanels() : openPanel(id));

  const EFFECT = {
    well: 'Площадь оживёт, а рядом можно будет поднять амбар.',
    home: 'В доме появится верстак: можно улучшать инструменты.',
    barn: 'Амбар хранит запасы жителей и мастерских: до {n}, с пристройкой до {max}.',
    bridge: 'Откроет восточный берег и северную рощу. На том берегу найдётся лопата.',
    sawmill: 'Сама пилит доски: дерево {ratio} → доски 1. Запас дерева до {reserve} всегда остаётся тебе.',
    kiln: 'Сама обжигает кирпич: глина {ratio} → кирпич 1. Запас глины до {reserve} всегда остаётся тебе.',
    house1: 'Поселится лесоруб и сам будет рубить лес.',
    house2: 'Поселится каменщик и сам будет добывать камень.',
    house3: 'Поселится гончар и сам будет копать глину.',
    forge: 'Кузнец откует инструменты третьего уровня.',
    mill: 'Все жители работают на {n}% быстрее.',
    chapel: 'Зазвонит колокол, и село устроит праздник.',
    garden: 'Шесть грядок: посади ягоду, полей из ведра у колодца, через сутки собери овощи.',
    apiary: 'Пчёлы сами носят мёд — все сезоны, кроме зимы.',
    market: 'Жители вывесят заказы за монеты, а в первый день каждого сезона здесь шумит ярмарка.',
    road: 'Расчистит тропу через холм: за ним хутор с садом и полем.',
    vineyard: 'Лозы из черенков с ярмарки сами дают виноград — все сезоны, кроме зимы.',
    press: 'Сама давит сок: виноград {ratio} → сок 1.',
    house4: 'Поселится пасечник и будет носить мёд, кроме зимы.',
    house5: 'Поселится садовник и будет приносить яблоки, кроме зимы.',
    harvest: 'Хутор отпразднует Праздник урожая.',
    glade: 'Расчистит просеку через старый лес: за ним озеро.',
    pier: 'Мостки над водой: с них ловят рыбу. Тут найдётся и удочка.',
    smokehouse: 'Сама коптит рыбу: рыба {ratio} → копчёная 1. Запас рыбы до {reserve} всегда остаётся тебе.',
    house6: 'Поселится рыбак и будет ловить рыбу круглый год, зимой — в лунке.',
    boathouse: 'Под крышу встанет лодка с ярмарки, а в сарае смастерят фонарики для праздника.',
    pavilion: 'Озеро отпразднует Праздник фонариков.',
  };
  // The numbers in EFFECT come from core's tuning, so re-balancing keeps the texts right.
  const EFFECT_VARS = {
    barn: { n: V.STORAGE[1], max: V.STORAGE[V.STORAGE.length - 1] },
    sawmill: { ratio: V.WORKSHOPS.sawmill.ratio, reserve: V.WORKSHOP_RESERVE },
    kiln: { ratio: V.WORKSHOPS.kiln.ratio, reserve: V.WORKSHOP_RESERVE },
    mill: { n: Math.round((V.MILL_BONUS - 1) * 100) },
    press: { ratio: V.WORKSHOPS.press.ratio },
    smokehouse: { ratio: V.WORKSHOPS.smokehouse.ratio, reserve: V.WORKSHOP_RESERVE },
  };
  const needsLeft = (id) => V.BUILDINGS[id].needs.filter((d) => !S.built[d].done);
  const needsText = (left) => t('Сначала: {list}', { list: left.map((d) => t(V.BUILDINGS[d].name)).join(', ') });
  // A building's panel works this close to its footprint (a little more than core's reach to a node).
  const NEAR_BUILDING = 1.6;
  const nearBuilding = (id) => VV.footprintDist(S.player.x, S.player.y, V.FOOTPRINTS[id]) <= NEAR_BUILDING;

  function openBuilding(id) {
    buildingId = id;
    openPanel('panel-building');
  }

  function renderBuilding() {
    const id = buildingId;
    if (!id) return;
    // The panel belongs to the place: walking away closes it.
    if (!nearBuilding(id)) { closePanels(); return; }
    const b = V.BUILDINGS[id], own = S.built[id];
    $('pb-title').textContent = t(b.name);
    $('pb-effect').textContent = t(EFFECT[id], EFFECT_VARS[id]);
    const rows = Object.entries(b.cost).map(([r, n]) => {
      const paid = own.paid[r] || 0;
      const have = paid >= n ? '' : ` <small>${esc(t('есть {n}', { n: VV.fmt(S.res[r]) }))}</small>`;
      return `<li class="${paid >= n ? 'ok' : ''}"><i class="ico ${r}"></i>${esc(resName(r))} <b>${paid}/${n}</b>${have}</li>`;
    });
    setHTML($('pb-cost'), own.done ? '' : rows.join(''));
    const left = needsLeft(id);
    const btn = $('btn-contribute');
    let note = '';
    if (own.done) note = t('Восстановлено. Спасибо!');
    else if (left.length) note = needsText(left);
    else if (!Object.keys(b.cost).some((r) => (own.paid[r] || 0) < b.cost[r] && S.res[r] >= 1)) note = t('Нечего внести: собери ещё.');
    $('pb-needs').textContent = note;
    btn.hidden = own.done;
    btn.disabled = own.done || left.length > 0;
    const market = $('pb-market');
    market.hidden = id !== 'market' || !own.done;
    if (!market.hidden) renderMarket();
  }

  // The market rows: the villagers' orders and, on a season's first day, the fair.
  const WHO = { woodcutter: 'Лесоруб', mason: 'Каменщик', potter: 'Гончар', neighbour: 'Соседи' };
  function renderMarket() {
    const orders = S.orders.map((o) => {
      const can = V.canAfford(S, o.need);
      return `<li><span>${esc(t(WHO[o.who] || WHO.neighbour))}: ${esc(costText(o.need))}</span>`
        + `<b>+${o.reward.coins} ${esc(resName('coins'))}</b>`
        + `<button class="btn small" type="button" data-order="${o.id}"${can ? '' : ' disabled'}>${esc(t('Отдать'))}</button></li>`;
    });
    setHTML($('orders-list'), orders.length ? orders.join('') : `<li class="muted">${esc(t('Новые заказы появляются на рассвете.'))}</li>`);
    const open = V.fairOpen(S);
    $('fair-note').textContent = open ? t('Сегодня ярмарка!') : t('Ярмарка — в первый день каждого сезона, днём.');
    const items = V.fairItems(S).map((id) => [id, V.FAIR[id]]).map(([id, item]) => {
      const owned = S.bought.includes(id);
      const label = owned ? t('куплено') : t('{n} монет', { n: item.price });
      const can = open && !owned && S.res.coins >= item.price;
      return `<li class="${owned ? 'ok' : ''}"><span>${esc(t(item.name))}</span><b>${esc(label)}</b>`
        + (owned ? '' : `<button class="btn small" type="button" data-buy="${id}"${can ? '' : ' disabled'}>${esc(t('Купить'))}</button>`) + '</li>';
    });
    setHTML($('fair-list'), items.join(''));
  }

  function contribute() {
    if (!buildingId) return;
    const r = V.contribute(S, buildingId);
    if (r === 'none') toast(t('Нечего внести: собери ещё.'));
    else if (r === 'locked') toast(needsText(needsLeft(buildingId)));
    renderHUD();
  }

  function renderBuildings() {
    const items = V.BUILDING_IDS.map((id) => {
      const own = S.built[id];
      const locked = !own.done && needsLeft(id).length > 0;
      let status;
      if (own.done) status = t('восстановлено');
      else if (locked) status = t('пока закрыто');
      else status = `${Math.floor(share(id) * 100)}%`;
      const cls = own.done ? 'done' : locked ? 'locked' : '';
      return `<li class="${cls}"><button class="link" type="button" data-go="${id}"><span>${esc(t(V.BUILDINGS[id].name))}</span><small>${esc(status)}</small></button></li>`;
    });
    setHTML($('buildings-list'), items.join(''));
    // The barn extension.
    const up = $('barn-upgrade');
    up.hidden = !S.built.barn.done || S.barnLevel >= V.STORAGE.length - 1;
    if (!up.hidden) {
      $('barn-cost').textContent = costText(V.BARN_UPGRADE);
      $('btn-barn').disabled = !V.canAfford(S, V.BARN_UPGRADE);
    }
    // Decorations after the festival.
    const dec = $('decor');
    dec.hidden = !S.festival;
    if (!dec.hidden) {
      setHTML($('decor-list'), Object.entries(V.DECOR).filter(([k, d]) => !d.fair || S.bought.includes(k)).map(([k, d]) =>
        `<li><button class="btn${placing === k ? ' primary' : ''}" type="button" data-decor="${k}"${V.canAfford(S, d.cost) ? '' : ' disabled'}>${esc(t(d.name))}</button> <small>${esc(costText(d.cost))}</small></li>`).join(''));
    }
  }

  // From the list: walk to the building; its panel opens on arrival.
  function goToBuilding(id) {
    closePanels();
    if (nearBuilding(id)) { openBuilding(id); return; }
    const fp = V.FOOTPRINTS[id][0];
    if (V.interact(S, fp.x, fp.y) === 'ruin') toast(t('Иду: {name}', { name: t(V.BUILDINGS[id].name) }), 1600);
    else toast(t('Туда пока не пройти'));
  }

  function renderTools() {
    $('tools-hint').hidden = S.built.home.done;
    // The rod is shown once the lake chapter has begun.
    const rows = Object.entries(V.TOOLS).filter(([id]) => id !== 'rod' || S.harvestFestival || S.tools.rod > 0).map(([id, tool]) => {
      const lvl = S.tools[id];
      const next = lvl + 1;
      let what, btn = '';
      if (lvl < 1) what = t(id === 'rod' ? 'появится с мостками' : 'найдётся за мостом');
      else if (lvl >= V.MAX_TOOL) what = t('лучший уровень');
      else {
        const need = V.TOOL_NEEDS[next];
        const cost = tool.costs[next];
        if (need && !S.built[need].done) what = t('нужно здание: {name}', { name: t(V.BUILDINGS[need].name) });
        else {
          what = costText(cost);
          btn = `<button class="btn primary" type="button" data-tool="${id}"${V.canAfford(S, cost) ? '' : ' disabled'}>${esc(t('Улучшить'))}</button>`;
        }
      }
      const level = lvl ? t('ур. {n}', { n: lvl }) : '—';
      return `<li><div class="tool-row"><b>${esc(t(tool.name))}</b> <span class="muted">${esc(level)}</span>${btn}</div><small class="muted">${esc(what)}</small></li>`;
    });
    setHTML($('tools-list'), rows.join(''));
  }

  // ───────────── Events → UI ─────────────
  function uiEvent(e) {
    if (e.type === 'hit') {
      const res = V.NODE_KINDS[e.kind].res;
      float(`+${e.gain} ${resName(res)}`, (e.x + 0.5) * T, e.y * T, res);
    } else if (e.type === 'ruin') {
      openBuilding(e.id);
    } else if (e.type === 'built') {
      if (e.level) toast(t('Амбар расширен: запасы до {n}', { n: S.storage }));
      else if (e.id !== 'chapel') toast(t('Восстановлено: {name}', { name: t(V.BUILDINGS[e.id].name) }), 3500);
      save();
    } else if (e.type === 'tool') {
      toast(t('{name}: уровень {n}', { name: t(V.TOOLS[e.tool].name), n: e.level }));
      save();
    } else if (e.type === 'festival') {
      closePanels();
      modal(t('Праздник в селе!'), `<p>${esc(t('Колокол звонит, жители танцуют на площади. Село снова живое — спасибо тебе.'))}</p>`
        + `<p>${esc(t('Дальше можно просто гулять, собирать и украшать площадь: клумбы, фонари, скамейки и заборы — в списке зданий.'))}</p>`,
      [{ label: t('Ура!'), primary: true }]);
    } else if (e.type === 'decor') {
      save();
    } else if (e.type === 'plot') {
      const wx = (e.x + 0.5) * T, wy = e.y * T;
      const say = PLOT_SAY[e.result];
      if (e.result === 'harvest') float(`+${e.gain} ${resName('vegetables')}`, wx, wy, 'vegetables');
      else if (e.result === 'sown' || e.result === 'watered') float(t(say), wx, wy);
      else if (say) toast(t(say), 2200);
    } else if (e.type === 'harvest-festival') {
      closePanels();
      modal(t('Праздник урожая!'), `<p>${esc(t('Хутор за холмом ожил: сок в кружках, мёд и яблоки на столах, музыка до утра.'))}</p>`
        + `<p>${esc(t('Дальше — свободная игра: заказы, ярмарки и украшения.'))}</p>`,
      [{ label: t('Ура!'), primary: true }]);
    } else if (e.type === 'order') {
      toast(t('Заказ выполнен: +{n} монет', { n: e.coins }), 2200);
      save();
    } else if (e.type === 'order-new') {
      toast(t('Новый заказ на доске у рядов'), 2200);
    } else if (e.type === 'buy') {
      toast(t('Куплено: {name}', { name: t(V.FAIR[e.id].name) }), 2400);
      save();
    } else if (e.type === 'season') {
      if (S.built.market.done) toast(t('Новый сезон — сегодня ярмарка у рядов!'), 3500);
    } else if (e.type === 'bucket') {
      toast(e.full ? t('Ведро уже полное') : t('Ведро полное: {n} поливов', { n: e.n }), 1800);
    }
  }
  const PLOT_SAY = {
    sown: 'посажено', watered: 'полито', growing: 'Растёт — полито до рассвета',
    winter: 'Зимой грядки отдыхают', seed: 'На семена нужна ягода', bucket: 'Ведро пустое — набери воды в колодце',
  };

  // ───────────── Actions ─────────────
  let placing = null; // decoration kind waiting for a tap on the square

  function act(a, x, y) {
    if (a.type === 'tool') { toast(t('Нужен инструмент: {name}', { name: t(V.TOOLS[a.tool].name) })); return; }
    if (a.type === 'ruin' && nearBuilding(a.id)) { openBuilding(a.id); return; }
    if (a.type === 'gather' || a.type === 'ruin' || a.type === 'plot' || a.type === 'well') {
      if (V.interact(S, x, y) === 'none') toast(t('Туда пока не пройти'));
      return;
    }
    if (a.type === 'walk' && !V.goTo(S, x, y)) toast(t('Туда пока не пройти'));
  }

  function tapTile(x, y) {
    if (placing) {
      const kind = placing;
      const r = V.placeDecor(S, kind, x, y);
      if (r === 'ok') return;
      if (r === 'cost') { toast(t('Не хватает: {list}', { list: costText(V.DECOR[kind].cost) })); return; }
      if (V.tileAt(x, y) === '#') { toast(t('Здесь уже занято')); return; }
      placing = null; // a tap outside the square ends placing and acts as usual
    }
    if (openId && openId !== 'panel-building') closePanels();
    act(VV.tapAction(S, V, x, y), x, y);
  }

  // The action key and the touch button: whatever is in front of the player.
  function actFront() {
    const a = VV.pickFront(S, V, S.player.x, S.player.y, P.face);
    if (!a) { toast(t('Подойди к дереву, камню, кусту, грядке или руине'), 1800); return; }
    act(a, a.x, a.y);
  }

  function startPlacing(kind) {
    placing = placing === kind ? null : kind;
    if (!placing) return;
    closePanels();
    toast(t('Нажми на свободное место на площади'));
  }

  // ───────────── Input ─────────────
  const KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const held = new Set();
  function applyKeys() {
    let dx = 0, dy = 0;
    for (const k of held) { dx += KEYS[k][0]; dy += KEYS[k][1]; }
    V.moveDir(S, dx, dy); // a zero direction only stops key walking, a tap order stays
  }
  const isEl = (e, sel) => e.target instanceof HTMLElement && e.target.matches(sel);

  function onKeyDown(e) {
    if (isEl(e, 'input:not([type=checkbox]), textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    A.unlock();
    if (modalOpen()) {
      if (e.code === 'Escape') { e.preventDefault(); closeModal(); }
      return;
    }
    if (KEYS[e.code]) {
      e.preventDefault();
      if (!held.has(e.code)) { held.add(e.code); applyKeys(); }
      return;
    }
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        if (isEl(e, 'input')) return; // a focused checkbox toggles as usual
        e.preventDefault(); actFront(); break;
      case 'KeyE': actFront(); break;
      case 'KeyB': togglePanel('panel-buildings'); break;
      case 'KeyT': togglePanel('panel-tools'); break;
      case 'KeyO':
        if (S.built.market.done) goToBuilding('market');
        else toast(t('Сначала восстанови ярмарочные ряды'));
        break;
      case 'KeyM': toggleMute(); break;
      case 'Escape': placing = null; closePanels(); break;
      default:
    }
  }
  function onKeyUp(e) {
    if (KEYS[e.code] && held.delete(e.code)) applyKeys();
  }
  function releaseKeys() {
    if (!held.size) return;
    held.clear();
    applyKeys();
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    A.unlock();
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    // Placing a decoration wants the ground tile; otherwise a tall crown or roof picks its own object.
    const p = placing ? VV.screenToTile(sx, sy, ART.cam) : VV.tapAt(S, V, sx + ART.cam.x, sy + ART.cam.y);
    tapTile(p.x, p.y);
  }

  // ───────────── Sound toggles ─────────────
  function setAudio(music, sounds) {
    A.setMusic(music);
    A.setSounds(sounds);
    $('opt-music').checked = music;
    $('opt-sounds').checked = sounds;
  }
  function toggleMute() {
    const on = !(A.state.music || A.state.sounds);
    setAudio(on, on);
    toast(on ? t('Звук включён') : t('Звук выключен'), 1400);
  }

  // ───────────── Saving ─────────────
  // localStorage keeps core's save plus savedAt (load ignores unknown fields); the cloud gets core's save.
  // While the tab is hidden the world stands still (no rAF), so savedAt stays at the moment it was hidden:
  // a tab closed or discarded without coming back still gets its time away on the next boot.
  // A hidden tab writes once (on hiding) and then stays quiet, so its frozen state cannot clobber
  // progress made meanwhile in another tab; writtenAt tells such a newer save apart on return.
  let hiddenAt = 0;
  let wroteAt = 0; // writtenAt of this tab's last write
  function save() {
    wroteAt = Math.max(Date.now(), wroteAt + 1);
    const ok = store.set(SAVE_KEY, JSON.stringify({ ...V.save(S), savedAt: hiddenAt || Date.now(), writtenAt: wroteAt }));
    $('save-status').textContent = ok ? t('сохранено') : t('браузер не даёт сохранять');
    return ok;
  }
  const saveIfVisible = () => { if (!hiddenAt) save(); };

  function loadSaved() {
    const raw = store.get(SAVE_KEY);
    if (!raw) return { s: null, savedAt: null, broken: false };
    let data = null;
    try { data = JSON.parse(raw); } catch { /* load reports it as recovered */ }
    const s = V.load(data);
    if (s.recovered === 'old') {
      // A village from an earlier version: keep it aside and forget its cloud code, so the new village
      // never overwrites the old cloud copy.
      store.set(`${SAVE_KEY}.v${data.v}`, raw);
      store.del(CLOUD_KEY);
      return { s: null, savedAt: null, old: true };
    }
    if (s.recovered) {
      store.set(`${SAVE_KEY}.broken`, raw); // keep the unreadable copy aside instead of losing it silently
      return { s: null, savedAt: null, broken: true };
    }
    return { s, savedAt: Number(data.savedAt) || null, writtenAt: Number(data.writtenAt) || 0, broken: false };
  }

  // Swap the whole state (reset, cloud load, another tab's save): cosmetic followers start over, the rest is
  // drawn from S. stateGen counts swaps so an async cloud reply that started before one can tell it is stale.
  let stateGen = 0;
  // Point the client at a state: the player look starts where the player stands, followers and effects anew.
  function setWorld(s) {
    S = s;
    prev = { x: S.player.x, y: S.player.y };
    P.x = S.player.x; P.y = S.player.y; P.swing = -1;
    folk.clear();
    ART.setState(S);
  }

  function replaceState(s) {
    stateGen++;
    setWorld(s);
    placing = null;
    held.clear();
    closePanels();
    renderHUD();
  }

  function duration(sec) {
    const d = VV.splitDuration(sec);
    if (d.h) return t('{h} ч {m} мин', d);
    if (d.m) return t('{m} мин', d);
    return t('{s} с', d);
  }

  // Villagers and workshops kept working while the page was closed or hidden. Times are in seconds:
  // shorter gaps than MIN_AWAY aren't worth an offline run; the summary window shows only after a longer
  // absence (a reload is quicker than a switch back to a tab left a while ago, so boot asks for less).
  const MIN_AWAY = 2;
  const SHOW_AWAY_BOOT = 30;
  const SHOW_AWAY_RETURN = 60;
  function catchUp(away, show) {
    if (!(away > MIN_AWAY)) return;
    const g = V.offline(S, away);
    if (!show) return;
    const rows = Object.entries(g.gains).map(([r, n]) => `<li><i class="ico ${r}"></i>${esc(resName(r))} <b>${n > 0 ? '+' : '−'}${VV.fmt(Math.abs(n))}</b></li>`);
    if (g.regrown) rows.push(`<li>${esc(t('Отросло деревьев, камней и кустов: {n}', { n: g.regrown }))}</li>`);
    if (!rows.length) return;
    const note = away > V.OFFLINE_MAX ? t(' (дольше {h} ч село без тебя не работает)', { h: V.OFFLINE_MAX / 3600 }) : '';
    modal(t('Пока тебя не было…'), `<p>${esc(t('Прошло {time}{note}. Вот что успели жители и мастерские:', { time: duration(Math.min(away, V.OFFLINE_MAX)), note }))}</p><ul class="cost">${rows.join('')}</ul>`,
      [{ label: t('Хорошо'), primary: true }]);
  }

  // The new village gets no cloud code: the cloud autosave would otherwise write it over the old village.
  // The old code is shown once more so the player can write it down and load that village later.
  function resetGame() {
    const body = cloudCode
      ? t('Всё восстановленное село пропадёт. Облачная копия останется по коду {code} — запиши его, чтобы потом вернуться.', { code: pretty(cloudCode) })
      : t('Всё восстановленное село пропадёт.');
    modal(t('Начать заново?'), `<p>${esc(body)}</p>`, [
      { label: t('Отмена') },
      { label: t('Начать заново'), danger: true, run: () => {
        store.del(CLOUD_KEY); syncCloudCode(); $('cloud-msg').textContent = '';
        replaceState(V.newGame()); save(); toast(t('Новое село ждёт'));
      } },
    ]);
  }

  // ───────────── Cloud saves (only when served by the Go backend) ─────────────
  function newCode() {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => abc[b % abc.length]).join('');
  }
  const pretty = (code) => code.match(/.{1,4}/g).join('-');
  const cleanCode = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  // The cloud code lives in localStorage next to the save; a tab that adopts another tab's save
  // re-reads it, so its autosave never sends that village to the code it had before.
  let cloudCode = '';
  const showCloudCode = () => { $('cloud-code').textContent = cloudCode ? pretty(cloudCode) : ''; };
  function syncCloudCode() {
    cloudCode = store.get(CLOUD_KEY) || '';
    showCloudCode();
  }
  // A new code is kept in memory even when storage fails, so this tab's autosave still uses it.
  function setCloudCode(code) {
    store.set(CLOUD_KEY, code);
    cloudCode = code;
    showCloudCode();
  }

  async function cloudPut(code) {
    const res = await fetch(`/api/saves/${code}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(V.save(S)),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function initCloud() {
    try {
      const res = await fetch('/healthz');
      if (!res.ok || (await res.text()).trim() !== 'ok') return;
    } catch { return; }
    $('cloud').hidden = false;
    syncCloudCode();

    // A reset, cloud load or adopted tab save while the request is in flight makes its reply stale:
    // keeping the code then would hand the new village to the old village's cloud copy.
    $('btn-cloud-save').addEventListener('click', async () => {
      const code = cloudCode || newCode();
      const gen = stateGen;
      try {
        await cloudPut(code);
        if (gen !== stateGen) return;
        setCloudCode(code);
        $('cloud-msg').textContent = t('Сохранено. Введи этот код на другом устройстве.');
      } catch (err) { if (gen === stateGen) $('cloud-msg').textContent = t('Не удалось сохранить: {e}', { e: err.message }); }
    });

    $('cloud-load').addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = cleanCode($('cloud-input').value);
      if (c.length !== 16) { $('cloud-msg').textContent = t('Код состоит из 16 букв и цифр.'); return; }
      const gen = stateGen;
      try {
        const res = await fetch(`/api/saves/${c}`);
        if (gen !== stateGen) return;
        if (res.status === 404) { $('cloud-msg').textContent = t('Сохранения с таким кодом нет.'); return; }
        if (!res.ok) throw new Error(await res.text());
        const s = V.load(await res.json());
        if (gen !== stateGen) return;
        if (s.recovered === 'old') { $('cloud-msg').textContent = t('Это сохранение от старой версии игры: его нельзя загрузить.'); return; }
        if (s.recovered) { $('cloud-msg').textContent = t('Это сохранение не подходит к игре.'); return; }
        replaceState(s);
        setCloudCode(c);
        save();
        openPanel('panel-settings');
        $('cloud-input').value = '';
        $('cloud-msg').textContent = t('Загружено.');
      } catch (err) { if (gen === stateGen) $('cloud-msg').textContent = t('Не удалось загрузить: {e}', { e: err.message }); }
    });

    // Quietly keep the cloud copy fresh once the player has a code.
    // A hidden tab's world is frozen: skip it, or it would overwrite progress made on another device.
    setInterval(() => { if (cloudCode && !hiddenAt) cloudPut(cloudCode).catch(() => {}); }, 60000);
  }

  // ───────────── Boot ─────────────
  function bindUI() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseKeys);
    $('btn-act').addEventListener('click', () => { A.unlock(); actFront(); });
    $('btn-buildings').addEventListener('click', () => togglePanel('panel-buildings'));
    $('btn-tools').addEventListener('click', () => togglePanel('panel-tools'));
    $('btn-settings').addEventListener('click', () => togglePanel('panel-settings'));
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', closePanels);
    $('btn-contribute').addEventListener('click', contribute);
    $('btn-barn').addEventListener('click', () => {
      if (V.upgradeBarn(S) === 'cost') toast(t('Не хватает: {list}', { list: costText(V.BARN_UPGRADE) }));
      renderHUD();
    });
    $('buildings-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (b) goToBuilding(b.dataset.go);
    });
    $('orders-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-order]');
      if (!b) return;
      if (V.fulfill(S, Number(b.dataset.order)) === 'cost') toast(t('Не хватает для заказа'));
      renderHUD();
    });
    $('fair-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-buy]');
      if (!b) return;
      const r = V.buy(S, b.dataset.buy);
      if (r === 'coins') toast(t('Не хватает монет'));
      else if (r === 'closed') toast(t('Ярмарка — в первый день каждого сезона, днём.'));
      renderHUD();
    });
    $('decor-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-decor]');
      if (b) startPlacing(b.dataset.decor);
    });
    $('tools-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (!b) return;
      const r = V.upgradeTool(S, b.dataset.tool);
      if (r === 'cost') toast(t('Не хватает: {list}', { list: costText(V.TOOLS[b.dataset.tool].costs[S.tools[b.dataset.tool] + 1]) }));
      renderHUD();
    });
    $('opt-music').addEventListener('change', (e) => A.setMusic(e.target.checked));
    $('opt-sounds').addEventListener('change', (e) => A.setSounds(e.target.checked));
    $('btn-reset').addEventListener('click', resetGame);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
    // iOS Safari unlocks audio only on click/touchend, not on pointerdown; unlock() is cheap once running.
    for (const type of ['pointerdown', 'touchend', 'click']) document.addEventListener(type, () => A.unlock(), { passive: true });

    // rAF stops in a hidden tab, so the time away is caught up through core's offline path on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (!hiddenAt) hiddenAt = Date.now();
        releaseKeys();
        save();
      } else if (hiddenAt) {
        // Another tab saved after this one went quiet: carry on from that save, not the stale state here.
        const saved = loadSaved();
        const newer = saved.s && saved.writtenAt > wroteAt;
        if (newer) { replaceState(saved.s); syncCloudCode(); }
        const away = (Date.now() - (newer ? saved.savedAt || Date.now() : hiddenAt)) / 1000;
        hiddenAt = 0;
        catchUp(away, away > SHOW_AWAY_RETURN);
        if (newer) toast(t('Подхвачено сохранение из другой вкладки'), 3000);
        save();
        renderHUD();
      }
    });
    // While hidden nothing changes, and the hide-time save is already written.
    window.addEventListener('pagehide', saveIfVisible);
    setInterval(saveIfVisible, 10000);
  }

  // On a phone the resource pills show only icon and number: a tap tells what it is.
  $('res').addEventListener('click', (e) => {
    const box = e.target.closest('.res-item');
    if (!box) return;
    const r = box.dataset.res, rate = $(`r-${r}-rate`).textContent;
    toast([`${resName(r)}: ${VV.fmt(S.res[r])}`, rate, box.classList.contains('full') ? box.title : ''].filter(Boolean).join(' · '));
  });

  function boot() {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t(meta.content);
    // Added after I18n.translateDOM has run, so the button's own labels stay as they are.
    // They sit with the other buttons, so on a phone they don't take a row of their own.
    const addToggle = () => document.querySelector('.top-actions').prepend(GameNav.home('lang-btn'), I18n.toggle('lang-btn'));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle); else addToggle();
    const saved = loadSaved();
    setWorld(saved.s || V.newGame());
    setAudio(A.state.music, A.state.sounds);
    ART.resize();
    window.addEventListener('resize', ART.resize);
    bindUI();
    if (saved.savedAt) {
      const away = (Date.now() - saved.savedAt) / 1000;
      catchUp(away, away > SHOW_AWAY_BOOT);
    }
    if (saved.broken) toast(t('Сохранение повреждено — начато новое село'), 4000);
    if (saved.old) toast(t('Новая версия игры — новое село: с днями, ночами и сезонами'), 5000);
    if (document.visibilityState === 'hidden') hiddenAt = Date.now(); // opened in a background tab
    save();
    renderHUD();
    initCloud();
    requestAnimationFrame(frame);
  }

  boot();
})();
