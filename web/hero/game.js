'use strict';
// Путь героя — client: screens, input, effects and the Canvas 2D art of the act map and the battles. The rules live
// in core.js (window.HeroCore), data in content.js (window.HeroContent), pure helpers in view.js (window.HeroView).
(() => {
  const C = window.HeroCore;
  const K = window.HeroContent;
  const V = window.HeroView;
  const { t } = window.I18n;
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;

  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  // Names: step, hit, crit, dodge, block, hurt, swap, spell, death, levelup, chest, forge, potion, phase, win, lose.
  const Sound = window.HeroAudio;
  const sfx = (name, opts) => Sound.play(name, opts);

  const canvas = $('field');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  let save = C.loadSave(storage);
  let run = null;
  let screen = 'menu';      // menu | map | battle | choice | result | hall
  let paused = false;
  let bagOpen = false;
  let speed = 1;
  let after = 0;            // seconds left of the banner after a battle before the next screen shows
  let mapFocus = 0;         // keyboard focus among the reachable nodes
  let note = '';            // a hint line on the choice panel
  let fx = null;
  let view = { w: 640, h: 360, dpr: 1 };
  let last = 0, time = 0;

  // ───────────── Canvas size ─────────────
  function resize() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const w = Math.max(200, Math.floor(stage.clientWidth - padX));
    const h = Math.max(160, Math.floor(Math.min(stage.clientHeight - padY, w * 0.75)));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    view = { w, h, dpr };
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  // ───────────── Saving ─────────────
  function persist() { C.storeSave(storage, save); }
  function persistRun() {
    if (!run) return;
    save.current = run.phase === 'won' || run.phase === 'lost' ? null : C.snapshot(run);
    persist();
  }

  // ───────────── Texts ─────────────
  const itemName = (it) => t(K.ITEMS[it.id].name);
  const stars = (n) => '★'.repeat(n);
  const typeName = (type) => t(V.TYPE_NAME[type]);
  const TRAIT = { keen: 'Пробивает уклонение', cleave: 'Рубит двоих', lifesteal: 'Вампиризм', chill: 'Замедляет' };

  function itemDesc(it) {
    const s = V.itemLine(it), slot = K.ITEMS[it.id].slot;
    if (slot === 'weapon') {
      const parts = [t('{type} · урон {dmg} · {speed} с', { type: typeName(s.type), dmg: s.dmg, speed: s.speed })];
      for (const tr of s.traits) parts.push(t(TRAIT[tr]));
      return parts.join(' · ');
    }
    if (slot === 'armor') return t('Броня {a} · защита от магии {w} · здоровье +{h}', { a: s.armor, w: s.ward, h: s.hp });
    const SPELL = {
      fireball: 'Огненный шар: {p} урона огнём раз в {cd} с',
      nova: 'Ледяная волна: {p} урона льдом всем и замедление, раз в {cd} с',
      heal: 'Лечит {p}% здоровья раз в {cd} с',
      smite: 'Кара света: {p} урона светом раз в {cd} с',
    };
    return t(SPELL[s.spell], { p: s.power, cd: s.cd });
  }

  function perkDesc(id, times) {
    const p = K.PERKS[id];
    const n = p.hp ? p.hp * times : p.atk ? p.atk * times : p.crit ? p.crit * 100 * times : p.dodge ? p.dodge * 100 * times
      : p.armor ? p.armor * times : p.ward ? p.ward * times : p.haste ? p.haste * 100 * times : p.leech ? p.leech * 100 * times : p.spell * 100 * times;
    return t(p.desc, { n: String(Math.round(n * 10) / 10).replace('.', ',') });
  }

  const enemyName = (e) => t((e.boss ? K.BOSSES[e.kind] : K.ENEMIES[e.kind]).name);

  // ───────────── Runs ─────────────
  function startRun() {
    run = C.newRun(save, (Date.now() % 1e9) >>> 0, save.trial);
    clearFx();
    persistRun();
    sync();
  }

  function resumeRun() {
    run = C.restore(save.current);
    if (!run) { save.current = null; persist(); showMenu(); return; }
    clearFx();
    sync();
  }

  // Shows whatever the run's phase calls for.
  function sync() {
    if (!run) { showMenu(); return; }
    bagOpen = false;
    $('bag').hidden = true;
    const ph = run.phase;
    $('hud').hidden = false;
    if (ph === 'won' || ph === 'lost') { showResult(); return; }
    if (ph === 'battle') {
      if (!run.battle) {
        C.startBattle(run);
        persistRun(); // the snapshot is the battle's start: a reload restarts it
        handle(C.drain(run));
        fx.enter = 0.6;
      }
      screen = 'battle';
      paused = false;
      show(null);
      $('battlebar').hidden = false;
      $('foe').hidden = false;
      renderSlots();
      renderFoe();
    } else if (ph === 'map') {
      screen = 'map';
      show(null);
      $('battlebar').hidden = true;
      $('foe').hidden = true;
      mapFocus = 0;
      canvas.focus({ preventScroll: true });
    } else {
      screen = 'choice';
      $('battlebar').hidden = true;
      $('foe').hidden = true;
      showChoice();
    }
    renderHUD();
  }

  // After any action on a calm screen: effects, the save, the next screen.
  function acted() {
    handle(C.drain(run));
    persistRun();
    sync();
  }

  // ───────────── Effects from core events ─────────────
  function clearFx() {
    fx = { floats: [], particles: [], flash: {}, pos: {}, heroAtk: 0, heroHurt: 0, swap: 0, spells: [], shake: 0, phase: 0, enter: 0, banner: null };
  }

  function enemyPos(uid) {
    const p = fx.pos[uid];
    return p ? { x: p.x, y: p.y } : { x: view.w * 0.7, y: view.h * 0.8 };
  }

  function float(x, y, text, color, big) {
    fx.floats.push({ x: x + (Math.random() - 0.5) * 14, y, text, color, big: !!big, t: 0, life: big ? 1.2 : 0.9 });
  }

  function puff(x, y, color, n, sp) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, s = sp * (0.3 + Math.random());
      fx.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - sp * 0.4, life: 0.5 + Math.random() * 0.4, t: 0, color });
    }
  }

  function banner(text, seconds = 1.6) {
    fx.banner = { text, t: seconds };
    const b = $('banner');
    b.textContent = text;
    b.hidden = false;
  }

  function handle(events) {
    const L = V.battleLayout(view);
    const hx = L.hero.x, hy = L.hero.y - L.s * 1.2;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const p = enemyPos(e.uid);
          fx.flash[e.uid] = 0.12;
          float(p.x, p.y - L.s * 1.4, String(e.dmg), V.TYPE_COLOR[e.dmgType], e.crit);
          if (!e.spell) fx.heroAtk = 0.22;
          puff(p.x, p.y - L.s * 0.8, V.TYPE_COLOR[e.dmgType], e.crit ? 10 : 5, 60);
          sfx(e.crit ? 'crit' : 'hit', { type: e.dmgType });
          break;
        }
        case 'miss': { const p = enemyPos(e.uid); float(p.x, p.y - L.s * 1.4, t('Промах'), '#c9c3d6'); fx.heroAtk = 0.22; sfx('dodge'); break; }
        case 'block': { const p = enemyPos(e.uid); float(p.x, p.y - L.s * 1.4, t('Блок'), '#9fd0ff'); fx.heroAtk = 0.22; sfx('block'); break; }
        case 'immune': { const p = enemyPos(e.uid); float(p.x, p.y - L.s * 1.4, t('Иммунитет'), '#ff8a7a', true); fx.heroAtk = 0.22; sfx('block'); break; }
        case 'thorns': float(hx, hy, `−${e.dmg}`, '#ff8a7a'); break;
        case 'hurt': fx.heroHurt = 0.2; fx.shake = Math.min(6, fx.shake + 2); float(hx, hy, `−${e.dmg}`, '#ff6a5c'); sfx('hurt'); break;
        case 'dodge': float(hx, hy, t('Уклонение'), '#c9c3d6'); sfx('dodge'); break;
        case 'spell': fx.spells.push({ spell: e.spell, t: 0 }); if (e.amount) float(hx, hy, `+${e.amount}`, '#8fe39a'); sfx('spell', { spell: e.spell }); break;
        case 'swap': fx.swap = C.SWAP_TIME; sfx('swap'); renderSlots(); break;
        case 'swapped': renderSlots(); break;
        case 'kill': { const p = enemyPos(e.uid); puff(p.x, p.y - L.s * 0.6, '#d9cbe8', 18, 90); if (e.gold) float(p.x, p.y - L.s * 2, `+${e.gold}`, '#ffd34d'); sfx('death'); break; }
        case 'summon': banner(t('Подмога: {name}', { name: t(K.ENEMIES[e.kind].name) }), 1.2); break;
        case 'phase': fx.phase = 1; fx.shake = 8; banner(t('Повелитель пепла: {name}!', { name: t(K.BOSSES.ash_lord.phases[e.phase].name) })); sfx('phase'); break;
        case 'enrage': banner(t('Враги в ярости!'), 1.4); break;
        case 'levelup': banner(t('Новый уровень: {n} — {title}', { n: e.level, title: t(e.title) }), 2); sfx('levelup'); break;
        case 'potion': float(hx, hy, `+${e.amount}`, '#8fe39a'); sfx('potion'); break;
        case 'victory': if (e.kind !== 'boss' || run.phase !== 'won') banner(e.kind === 'boss' ? t('Босс повержен!') : t('Победа!'), 1.2); break;
        case 'act': banner(t('Акт {n}: {name}', { n: e.act, name: t(K.ACT_NAMES[e.act]) }), 2); break;
        case 'reward': case 'buy': case 'sell': sfx('chest'); break;
        case 'forge': sfx('forge'); break;
        case 'node': sfx('step'); break;
        default: break;
      }
    }
  }

  // ───────────── Battle ─────────────
  function battleFrame(dt) {
    if (paused || !run || run.phase !== 'battle' || !run.battle) return;
    if (fx.enter > 0) { fx.enter -= dt; return; }
    for (let k = 0; k < speed; k++) C.step(run, dt);
    handle(C.drain(run));
    if (run.phase !== 'battle') onBattleEnd();
  }

  function onBattleEnd() {
    if (run.phase === 'won' || run.phase === 'lost') {
      C.recordRun(save, run); // «Слава» and the records land the moment the run ends
      persist();
      sfx(run.phase === 'won' ? 'win' : 'lose');
      banner(run.phase === 'won' ? t('Повелитель пепла повержен!') : t('Герой пал'), 1.6);
    } else {
      persistRun();
    }
    after = 1.1;
    screen = 'after';
    $('battlebar').hidden = true;
  }

  function swapTo(i) {
    if (screen !== 'battle' || paused || !run.battle) return;
    const w = C.quickSlots(run)[i];
    if (w) C.swapWeapon(run, w.uid);
    handle(C.drain(run));
  }

  function drinkPotion() {
    if (!run || !C.usePotion(run)) return;
    handle(C.drain(run));
    if (screen !== 'battle') persistRun();
    renderHUD();
  }

  // ───────────── HUD ─────────────
  function renderHUD() {
    if (!run) return;
    const st = C.stats(run), h = run.hero;
    $('hud-title').textContent = t('{title} · ур. {n}', { title: t(C.title(h.level)), n: h.level });
    const share = Math.max(0, h.hp) / st.maxHp;
    $('hp-fill').style.width = `${share * 100}%`;
    $('hp-bar').classList.toggle('mid', share < 0.6 && share >= 0.3);
    $('hp-bar').classList.toggle('low', share < 0.3);
    $('hp-text').textContent = `${Math.ceil(Math.max(0, h.hp))}/${st.maxHp}`;
    $('xp-fill').style.width = `${(h.xp / C.xpToNext(h.level)) * 100}%`;
    $('xp-bar').title = t('Опыт: {n} из {m}', { n: Math.floor(h.xp), m: C.xpToNext(h.level) });
    $('hud-gold').textContent = V.fmt(run.gold);
    $('potions').textContent = String(h.potions);
    $('btn-potion').disabled = h.potions <= 0;
    $('btn-bag').disabled = screen === 'battle' || screen === 'after';
    $('btn-pause').textContent = paused ? t('Дальше') : t('Пауза');
    $('btn-speed').textContent = `×${speed}`;
  }

  function renderSlots() {
    const box = $('slots');
    box.innerHTML = '';
    const swapping = run.battle && run.battle.swapT > 0;
    C.quickSlots(run).forEach((w, i) => {
      const s = C.itemStats(w);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot' + (run.eq.weapon === w.uid ? ' on' : '');
      b.disabled = swapping && run.eq.weapon !== w.uid;
      b.title = `${itemName(w)} — ${itemDesc(w)}`;
      b.setAttribute('aria-label', `${i + 1}: ${itemName(w)}, ${typeName(s.type)}`);
      b.style.color = V.TYPE_COLOR[s.type];
      b.innerHTML = `<span class="ico" aria-hidden="true">${V.TYPE_ICON[s.type]}</span><span>${typeName(s.type)}</span><kbd>${i + 1}</kbd>`;
      b.addEventListener('click', () => { Sound.unlock(); swapTo(i); });
      box.append(b);
    });
  }

  const TAG = {
    weak: (d) => `${d.icon} ×${d.value}`, resist: (d) => `${d.icon} ×${String(d.value).replace('.', ',')}`, immune: (d) => `${d.icon} 0`,
    dodge: (d) => `≈ ${Math.round(d.value * 100)}%`, regen: (d) => `✚ ${d.value}/${t('с')}`, thorns: (d) => `✶ ${Math.round(d.value * 100)}%`,
    shield: (d) => `◆ ${d.value}`,
  };
  const TAG_TITLE = { weak: 'Слабость', resist: 'Защита', immune: 'Иммунитет', dodge: 'Уклонение', regen: 'Регенерация', thorns: 'Шипы', shield: 'Щит' };
  let foeKey = '';

  function renderFoe() {
    const box = $('foe');
    const e = run.battle && run.battle.enemies.find((x) => !x.dead);
    const icons = e ? V.defenceIcons(e) : [];
    const key = e ? `${e.uid}:${e.phase}:${e.shield}` : '';
    if (key === foeKey) return;
    foeKey = key;
    box.innerHTML = '';
    if (!e) return;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = enemyName(e);
    box.append(name);
    if (!icons.length) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t('Без защиты');
      box.append(tag);
    }
    for (const d of icons) {
      const tag = document.createElement('span');
      tag.className = `tag ${d.kind}`;
      const label = d.type ? `${t(TAG_TITLE[d.kind])}: ${typeName(d.type)}` : t(TAG_TITLE[d.kind]);
      tag.title = label;
      tag.setAttribute('aria-label', label);
      tag.textContent = TAG[d.kind](d);
      if (d.type) tag.style.color = V.TYPE_COLOR[d.type];
      box.append(tag);
    }
  }

  // ───────────── Screens ─────────────
  const SCREENS = ['menu', 'confirm', 'hall', 'choice', 'bag', 'result', 'pause'];
  function show(name) {
    for (const id of SCREENS) if (id !== 'bag') $(id).hidden = id !== name;
    stage.classList.toggle('dim', !!name && name !== 'pause');
  }

  function showMenu() {
    screen = 'menu';
    paused = false;
    run = null;
    clearFx();
    $('hud').hidden = true;
    $('battlebar').hidden = true;
    $('foe').hidden = true;
    $('bag').hidden = true;
    $('banner').hidden = true;
    const cur = save.current;
    $('btn-run').textContent = cur ? t('Продолжить поход (акт {n})', { n: cur.act }) : t('Новый поход');
    $('btn-new').hidden = !cur;
    const trials = $('trials');
    trials.innerHTML = '';
    trials.hidden = save.trialsUnlocked < 1;
    for (let i = 0; i <= save.trialsUnlocked; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (save.trial === i ? ' on' : '');
      b.textContent = i === 0 ? t('Обычный') : t('Испытание {n}', { n: i });
      b.setAttribute('aria-pressed', String(save.trial === i));
      b.addEventListener('click', () => { save.trial = i; persist(); showMenu(); });
      trials.append(b);
    }
    const lines = [t('Слава: {n}', { n: V.fmt(save.glory) })];
    if (save.wins) lines.push(t('Побед: {n}', { n: save.wins }));
    if (save.bestDepth) lines.push(t('Дальше всего: {n} мест', { n: save.bestDepth }));
    $('records').textContent = lines.join('\n');
    renderSound();
    show('menu');
    $('btn-run').focus({ preventScroll: true });
  }

  function showHall() {
    screen = 'hall';
    $('hall-glory').textContent = t('Слава: {n}', { n: V.fmt(save.glory) });
    const list = $('hall-list');
    list.innerHTML = '';
    for (const id of Object.keys(K.META)) {
      const m = K.META[id], lvl = save.meta[id];
      const row = document.createElement('div');
      row.className = 'item';
      const maxed = lvl >= m.max, price = C.metaPrice(save, id);
      row.innerHTML = `<b>${t(m.name)} <span class="tier">${'●'.repeat(lvl)}${'○'.repeat(m.max - lvl)}</span></b><small>${t(m.desc)}</small>`;
      const acts = document.createElement('div');
      acts.className = 'acts';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = maxed ? t('Максимум') : t('{p} славы', { p: V.fmt(price) });
      b.disabled = maxed || save.glory < price;
      b.addEventListener('click', () => {
        if (C.buyMeta(save, id) !== 'ok') return;
        persist();
        sfx('levelup');
        showHall();
      });
      acts.append(b);
      row.append(acts);
      list.append(row);
    }
    show('hall');
    $('btn-hall-back').focus({ preventScroll: true });
  }

  function card(html, onClick, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `card ${cls}`.trim();
    b.innerHTML = html;
    if (onClick) b.addEventListener('click', onClick);
    else b.disabled = true;
    return b;
  }
  const actionBtn = (label, fn, primary) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (primary ? ' primary' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };

  function itemCard(o, extra = '') {
    const it = { id: o.id, tier: o.tier };
    const tpl = K.ITEMS[o.id];
    const s = C.itemStats(it);
    const color = s.slot === 'weapon' ? V.TYPE_COLOR[s.type] : s.slot === 'armor' ? '#c0c8d0' : '#c9a8ff';
    const SLOT = { weapon: 'Оружие', armor: 'Броня', charm: 'Амулет' };
    return `<span class="type" style="color:${color}">${t(SLOT[tpl.slot])}</span><b>${t(tpl.name)}</b><span class="tier">${stars(o.tier)}</span><small>${itemDesc(it)}</small>${extra}`;
  }

  function showChoice() {
    const ph = run.phase;
    const cards = $('choice-cards'), actions = $('choice-actions');
    cards.innerHTML = '';
    actions.innerHTML = '';
    cards.className = 'cards';
    const lead = $('choice-lead');
    const title = $('choice-title');
    const bagBtn = actionBtn(t('Сумка'), openBag);
    if (ph === 'perk' || ph === 'shrine') {
      const times = ph === 'shrine' ? 2 : 1;
      title.textContent = ph === 'perk' ? t('Новый уровень!') : t('Святилище');
      lead.textContent = ph === 'perk'
        ? t('Уровень {n}: {title}. Выбери умение.', { n: run.hero.level, title: t(C.title(run.hero.level)) })
        : t('Благословение: умение в двойной силе.');
      run.offer.forEach((id, i) => cards.append(card(`<b>${t(K.PERKS[id].name)}</b><small>${perkDesc(id, times)}</small>`, () => {
        if (ph === 'perk') C.pickPerk(run, i); else C.pickReward(run, i);
        sfx('levelup');
        acted();
      })));
      if (ph === 'shrine') actions.append(actionBtn(t('Пропустить'), () => { C.pickReward(run, null); acted(); }));
    } else if (ph === 'chest' || ph === 'loot') {
      title.textContent = ph === 'chest' ? t('Сундук') : t('Добыча');
      lead.textContent = t('Возьми одну вещь. В сумке: {n} из {m}.', { n: run.bag.length, m: C.bagMax(run) });
      run.offer.forEach((o, i) => cards.append(card(itemCard(o), () => {
        const r = C.pickReward(run, i);
        if (r === 'full') { note = t('Сумка полна: выброси вещь, чтобы взять новую.'); showChoice(); openBag(); return; }
        note = '';
        acted();
      })));
      actions.append(bagBtn, actionBtn(t('Пропустить'), () => { note = ''; C.pickReward(run, null); acted(); }));
    } else if (ph === 'shop') {
      title.textContent = t('Торговец');
      lead.textContent = t('Золото: {n}. В сумке: {m} из {k}.', { n: V.fmt(run.gold), m: run.bag.length, k: C.bagMax(run) });
      run.offer.forEach((o, i) => {
        const price = `<span class="price">${t('{p} зол.', { p: o.price })}</span>`;
        const html = o.kind === 'potion'
          ? `<span class="type" style="color:#8fe39a">${t('Зелье')}</span><b>${t('Зелье лечения')}</b><small>${t('Лечит {p}% здоровья', { p: Math.round(C.POTION_HEAL * 100) })}</small>${price}`
          : itemCard(o.item, price);
        const ok = !o.sold && run.gold >= o.price && (o.kind === 'potion' ? run.hero.potions < C.MAX_POTIONS : true);
        cards.append(card(o.sold ? `${html}<small>${t('Продано')}</small>` : html, ok ? () => {
          const r = C.buy(run, i);
          if (r === 'full') { note = t('Сумка полна: выброси или продай вещь.'); showChoice(); openBag(); return; }
          note = '';
          handle(C.drain(run));
          persistRun();
          showChoice();
          renderHUD();
        } : null));
      });
      actions.append(bagBtn, actionBtn(t('Уйти'), () => { note = ''; C.leave(run); acted(); }, true));
    } else if (ph === 'forge') {
      title.textContent = t('Кузница');
      lead.textContent = t('Улучши одну вещь или перекуй оружие в другую стихию.');
      cards.className = 'list';
      for (const it of run.bag) {
        const row = document.createElement('div');
        row.className = 'item' + (Object.values(run.eq).includes(it.uid) ? ' on' : '');
        row.innerHTML = `<b>${itemName(it)} <span class="tier">${stars(it.tier)}</span></b><small>${itemDesc(it)}</small>`;
        const acts = document.createElement('div');
        acts.className = 'acts';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'chip';
        up.textContent = it.tier >= C.MAX_TIER ? t('Максимум') : t('Улучшить');
        up.disabled = it.tier >= C.MAX_TIER;
        up.addEventListener('click', () => { C.forge(run, it.uid, 'upgrade'); acted(); });
        acts.append(up);
        if (K.ITEMS[it.id].slot === 'weapon') {
          for (const type of K.TYPES) {
            if (C.itemStats(it).type === type) continue;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.style.color = V.TYPE_COLOR[type];
            b.textContent = V.TYPE_ICON[type];
            b.title = t('Перековать: {type}', { type: typeName(type) });
            b.setAttribute('aria-label', b.title);
            b.addEventListener('click', () => { C.forge(run, it.uid, 'reforge', type); acted(); });
            acts.append(b);
          }
        }
        row.append(acts);
        cards.append(row);
      }
      actions.append(actionBtn(t('Уйти'), () => { C.leave(run); acted(); }));
    } else if (ph === 'camp') {
      title.textContent = t('Привал');
      lead.textContent = t('Костёр в ночи. Отдохнуть или потренироваться?');
      cards.append(card(`<b>${t('Отдохнуть')}</b><small>${t('+{p}% здоровья', { p: Math.round(C.CAMP_HEAL * 100) })}</small>`, () => { C.camp(run, 'rest'); acted(); }));
      cards.append(card(`<b>${t('Тренироваться')}</b><small>${t('+1 уровень')}</small>`, () => { C.camp(run, 'train'); acted(); }));
    }
    $('choice-note').textContent = note;
    $('choice-note').hidden = !note;
    show('choice');
    const first = cards.querySelector('button:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  }

  function openBag() {
    if (!run || screen === 'battle' || screen === 'after') return;
    bagOpen = true;
    renderBag();
    $('bag').hidden = false;
    $('btn-bag-close').focus({ preventScroll: true });
  }

  function closeBag() {
    bagOpen = false;
    $('bag').hidden = true;
    if (screen === 'choice') showChoice();
    renderHUD();
  }

  function renderBag() {
    const list = $('bag-list');
    list.innerHTML = '';
    $('bag-lead').textContent = t('Вещей: {n} из {m}. Первые четыре оружия — кнопки в бою.', { n: run.bag.length, m: C.bagMax(run) });
    const inShop = run.phase === 'shop';
    run.bag.forEach((it, i) => {
      const slot = K.ITEMS[it.id].slot, on = run.eq[slot] === it.uid;
      const row = document.createElement('div');
      row.className = 'item' + (on ? ' on' : '');
      row.innerHTML = `<b>${itemName(it)} <span class="tier">${stars(it.tier)}</span>${on ? ` · ${t('надето')}` : ''}</b><small>${itemDesc(it)}</small>`;
      const acts = document.createElement('div');
      acts.className = 'acts';
      const add = (label, fn, title) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = label;
        if (title) { b.title = title; b.setAttribute('aria-label', title); }
        b.addEventListener('click', () => { fn(); handle(C.drain(run)); persistRun(); renderBag(); renderHUD(); });
        acts.append(b);
      };
      if (!on) add(t('Надеть'), () => C.equip(run, it.uid));
      if (i > 0) add('↑', () => C.moveItem(run, it.uid, i - 1), t('Выше'));
      if (inShop) add(t('Продать за {p}', { p: C.sellPrice(it) }), () => C.sell(run, it.uid));
      else add(t('Выбросить'), () => C.discard(run, it.uid));
      row.append(acts);
      list.append(row);
    });
  }

  function showResult() {
    screen = 'result';
    paused = false;
    $('battlebar').hidden = true;
    $('foe').hidden = true;
    const won = run.phase === 'won';
    const title = $('res-title');
    title.textContent = won ? t('Повелитель пепла повержен!') : t('Герой пал');
    title.classList.toggle('won', won);
    title.classList.toggle('lost', !won);
    $('res-main').textContent = t('{title}, уровень {n}', { title: t(C.title(run.hero.level)), n: run.hero.level });
    $('res-note').textContent = t('Слава: +{g}. Пройдено мест: {d}, врагов повержено: {k}.', { g: C.glory(run), d: run.depth, k: run.kills });
    renderHUD();
    show('result');
    $('btn-again').focus({ preventScroll: true });
  }

  function togglePause() {
    if (screen !== 'battle') return;
    paused = !paused;
    show(paused ? 'pause' : null);
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

  // ───────────── Drawing: backgrounds ─────────────
  const ACT_SKY = {
    1: ['#1d3326', '#3f6b45', '#9fc07a'],
    2: ['#121018', '#2b2638', '#5a5070'],
    3: ['#1a0806', '#5a160c', '#e0602a'],
  };

  function drawBackground(act, w, h, ground) {
    const [a, b, c] = ACT_SKY[act] || ACT_SKY[1];
    const g = ctx.createLinearGradient(0, 0, 0, ground);
    g.addColorStop(0, a);
    g.addColorStop(0.7, b);
    g.addColorStop(1, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const drift = time * 6;
    if (act === 1) {
      for (let layer = 0; layer < 2; layer++) {
        ctx.fillStyle = layer ? '#18301f' : '#244a2e';
        const sz = layer ? 70 : 46, off = (drift * (layer ? 0.6 : 0.3)) % (sz * 1.6);
        for (let x = -sz * 2 - off; x < w + sz; x += sz * 1.6) {
          const ty = ground - (layer ? 8 : 26);
          ctx.beginPath();
          ctx.moveTo(x, ty);
          ctx.lineTo(x + sz * 0.5, ty - sz * (1.6 + (layer ? 0.4 : 0)));
          ctx.lineTo(x + sz, ty);
          ctx.fill();
        }
      }
    } else if (act === 2) {
      ctx.fillStyle = '#1b1824';
      const span = 120, off = (drift * 0.4) % span;
      for (let x = -span - off; x < w + span; x += span) {
        ctx.fillRect(x, ground - h * 0.75, 18, h * 0.75);
        ctx.beginPath();
        ctx.arc(x + span / 2 + 9, ground - h * 0.75, span / 2, Math.PI, 0);
        ctx.lineWidth = 14;
        ctx.strokeStyle = '#1b1824';
        ctx.stroke();
      }
      for (let k = 0; k < 4; k++) { // torches
        const x = ((k * w) / 4 + w / 8 - drift * 0.4) % w;
        const fl = 0.7 + 0.3 * Math.sin(time * 9 + k);
        ctx.fillStyle = `rgba(255,170,80,${0.15 * fl})`;
        ctx.beginPath(); ctx.arc(x, ground - h * 0.45, 26, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffb347';
        ctx.beginPath(); ctx.arc(x, ground - h * 0.45, 3 + fl * 2, 0, TAU); ctx.fill();
      }
    } else {
      ctx.fillStyle = '#2a0b07';
      ctx.beginPath();
      ctx.moveTo(0, ground);
      for (let x = 0; x <= w; x += 30) ctx.lineTo(x, ground - h * 0.25 - Math.sin((x + drift * 0.3) / 70) * h * 0.08);
      ctx.lineTo(w, ground);
      ctx.fill();
      for (let k = 0; k < 14; k++) { // embers
        const x = (k * 97 + time * 20) % w, y = ground - ((time * 30 + k * 53) % (h * 0.9));
        ctx.fillStyle = `rgba(255,${120 + (k % 3) * 40},60,.7)`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.fillStyle = act === 3 ? '#3a120a' : act === 2 ? '#25212e' : '#2d4a26';
    ctx.fillRect(0, ground, w, h - ground);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(0, ground, w, 3);
    if (act === 3) {
      ctx.fillStyle = `rgba(255,110,40,${0.25 + 0.1 * Math.sin(time * 2)})`;
      ctx.fillRect(0, ground + 6, w, 3);
    }
  }

  // ───────────── Drawing: the hero ─────────────
  function drawWeapon(x, y, s, wpn, swing) {
    if (!wpn) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.9 + swing * 1.8);
    const glow = wpn.type !== 'phys';
    if (glow) { ctx.shadowColor = wpn.color; ctx.shadowBlur = 8 + wpn.tier * 2; }
    const blade = wpn.type === 'phys' ? (wpn.id === 'rusty_sword' ? '#9a7b5c' : '#d8dde3') : wpn.color;
    ctx.fillStyle = '#5a3b22';
    ctx.strokeStyle = blade;
    ctx.fillStyle = blade;
    const L = s * 0.95;
    switch (wpn.shape) {
      case 'axe':
        ctx.fillStyle = '#6b4a2c'; ctx.fillRect(-2, -L, 4, L);
        ctx.fillStyle = blade;
        ctx.beginPath(); ctx.moveTo(2, -L); ctx.quadraticCurveTo(s * 0.45, -L + s * 0.15, 2, -L + s * 0.38); ctx.fill();
        break;
      case 'dagger':
        ctx.fillRect(-2, -L * 0.55, 4, L * 0.55);
        ctx.fillStyle = '#6b4a2c'; ctx.fillRect(-5, -4, 10, 3);
        break;
      case 'spear':
        ctx.fillStyle = '#6b4a2c'; ctx.fillRect(-1.5, -L * 1.3, 3, L * 1.5);
        ctx.fillStyle = blade;
        ctx.beginPath(); ctx.moveTo(0, -L * 1.55); ctx.lineTo(5, -L * 1.28); ctx.lineTo(-5, -L * 1.28); ctx.fill();
        break;
      case 'sickle':
        ctx.fillStyle = '#6b4a2c'; ctx.fillRect(-2, -L * 0.6, 4, L * 0.6);
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(s * 0.2, -L * 0.6, s * 0.22, Math.PI, Math.PI * 1.9); ctx.stroke();
        break;
      case 'staff':
        ctx.fillStyle = '#6b4a2c'; ctx.fillRect(-2, -L * 1.2, 4, L * 1.4);
        ctx.fillStyle = blade;
        ctx.beginPath(); ctx.arc(0, -L * 1.25, 5 + wpn.tier, 0, TAU); ctx.fill();
        break;
      case 'mace': case 'hammer':
        ctx.fillStyle = '#6b4a2c'; ctx.fillRect(-2, -L, 4, L);
        ctx.fillStyle = blade;
        if (wpn.shape === 'mace') { ctx.beginPath(); ctx.arc(0, -L, s * 0.16, 0, TAU); ctx.fill(); }
        else ctx.fillRect(-s * 0.22, -L - s * 0.12, s * 0.44, s * 0.24);
        break;
      default: // sword
        ctx.fillRect(-2.5, -L, 5, L * 0.85);
        ctx.beginPath(); ctx.moveTo(-2.5, -L); ctx.lineTo(0, -L - 6); ctx.lineTo(2.5, -L); ctx.fill();
        ctx.fillStyle = '#6b4a2c'; ctx.fillRect(-7, -L * 0.15 - 3, 14, 3);
    }
    ctx.restore();
  }

  function drawHero(x, y, s, look, pose) {
    const bob = Math.sin(time * 4) * s * 0.02;
    const lunge = pose.atk > 0 ? Math.sin((1 - pose.atk / 0.22) * Math.PI) * s * 0.25 : 0;
    const hx = x + lunge, hy = y + bob;
    if (look.aura) {
      const g = ctx.createRadialGradient(hx, hy - s * 0.9, s * 0.2, hx, hy - s * 0.9, s * 1.3);
      g.addColorStop(0, 'rgba(255,224,102,.35)');
      g.addColorStop(1, 'rgba(255,224,102,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(hx, hy - s * 0.9, s * 1.3, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(hx, y + 2, s * 0.4, s * 0.08, 0, 0, TAU); ctx.fill();
    if (look.cape) {
      ctx.fillStyle = '#b3203a';
      ctx.beginPath();
      ctx.moveTo(hx - s * 0.18, hy - s * 1.25);
      ctx.quadraticCurveTo(hx - s * 0.55, hy - s * 0.6 + Math.sin(time * 3) * 4, hx - s * 0.45, hy - s * 0.1);
      ctx.lineTo(hx - s * 0.05, hy - s * 0.3);
      ctx.fill();
    }
    // legs
    ctx.fillStyle = '#3b2c22';
    ctx.fillRect(hx - s * 0.17, hy - s * 0.45, s * 0.13, s * 0.45);
    ctx.fillRect(hx + s * 0.04, hy - s * 0.45, s * 0.13, s * 0.45);
    // torso
    const body = look.armor ? look.armor.color : '#8a6a48';
    ctx.fillStyle = pose.hurt > 0 ? '#ff8a7a' : body;
    roundRect(hx - s * 0.24, hy - s * 1.25, s * 0.48, s * 0.82, s * 0.1);
    if (look.armor && look.armor.tier >= 3) {
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillRect(hx - s * 0.2, hy - s * 1.15, s * 0.4, s * 0.06);
    }
    // belt
    ctx.fillStyle = '#4a3020';
    ctx.fillRect(hx - s * 0.24, hy - s * 0.6, s * 0.48, s * 0.07);
    // head
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath(); ctx.arc(hx, hy - s * 1.45, s * 0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a1c14';
    ctx.fillRect(hx + s * 0.06, hy - s * 1.5, s * 0.05, s * 0.05);
    if (look.helmet) {
      ctx.fillStyle = look.aura ? '#ffd34d' : '#b8c0c8';
      ctx.beginPath(); ctx.arc(hx, hy - s * 1.5, s * 0.22, Math.PI, 0); ctx.fill();
      ctx.fillRect(hx - s * 0.22, hy - s * 1.52, s * 0.44, s * 0.06);
      if (look.cape) { ctx.fillStyle = '#d6324f'; ctx.fillRect(hx - s * 0.03, hy - s * 1.85, s * 0.06, s * 0.16); }
    } else {
      ctx.fillStyle = '#6b4a2c';
      ctx.beginPath(); ctx.arc(hx - s * 0.03, hy - s * 1.55, s * 0.19, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    }
    // arm and weapon
    const swing = pose.atk > 0 ? 1 - pose.atk / 0.22 : 0.15;
    const spin = pose.swap > 0 ? (1 - pose.swap / C.SWAP_TIME) * TAU : 0;
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath(); ctx.arc(hx + s * 0.3, hy - s * 0.9, s * 0.08, 0, TAU); ctx.fill();
    if (pose.swap > 0) {
      ctx.save();
      ctx.translate(hx + s * 0.3, hy - s * 0.9);
      ctx.rotate(spin);
      ctx.translate(-(hx + s * 0.3), -(hy - s * 0.9));
      drawWeapon(hx + s * 0.3, hy - s * 0.9, s, look.weapon, 0.5);
      ctx.restore();
    } else {
      drawWeapon(hx + s * 0.3, hy - s * 0.9, s, look.weapon, swing);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.fill();
  }

  // ───────────── Drawing: enemies ─────────────
  function drawEnemy(e, x, y, s0, flash) {
    const big = e.boss ? 1.7 : e.elite ? 1.2 : 1;
    const s = s0 * big;
    const bob = Math.sin(time * 3 + e.uid) * s * 0.03;
    const tint = (c) => (flash > 0 ? '#ffffff' : c);
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(-1, 1); // they face the hero
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(0, -bob + 2, s * 0.45, s * 0.08, 0, 0, TAU); ctx.fill();
    if (e.elite) { ctx.shadowColor = '#ff6f91'; ctx.shadowBlur = 10; }
    switch (e.kind) {
      case 'wolf': case 'wolf_king': {
        ctx.fillStyle = tint(e.kind === 'wolf_king' ? '#7a7f8c' : '#6a6458');
        ctx.beginPath(); ctx.ellipse(0, -s * 0.45, s * 0.5, s * 0.22, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(s * 0.45, -s * 0.62, s * 0.2, s * 0.15, -0.3, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(s * 0.4, -s * 0.75); ctx.lineTo(s * 0.47, -s * 0.95); ctx.lineTo(s * 0.55, -s * 0.74); ctx.fill();
        for (const lx of [-0.35, -0.15, 0.2, 0.35]) ctx.fillRect(lx * s, -s * 0.3, s * 0.08, s * 0.3);
        ctx.beginPath(); ctx.moveTo(-s * 0.48, -s * 0.5); ctx.quadraticCurveTo(-s * 0.8, -s * 0.7, -s * 0.75, -s * 0.35); ctx.lineTo(-s * 0.5, -s * 0.42); ctx.fill();
        ctx.fillStyle = '#ffd34d';
        ctx.fillRect(s * 0.5, -s * 0.66, s * 0.05, s * 0.04);
        if (e.kind === 'wolf_king') {
          ctx.fillStyle = '#ffd34d';
          ctx.beginPath(); ctx.moveTo(s * 0.3, -s * 0.78); ctx.lineTo(s * 0.35, -s * 0.95); ctx.lineTo(s * 0.42, -s * 0.84); ctx.lineTo(s * 0.48, -s * 0.97); ctx.lineTo(s * 0.52, -s * 0.8); ctx.fill();
        }
        break;
      }
      case 'bandit': case 'knight': case 'skeleton': case 'bone_lord': {
        const col = { bandit: '#5a4a6a', knight: '#2a2a33', skeleton: '#d8d2c0', bone_lord: '#e0dac8' }[e.kind];
        const bones = e.kind === 'skeleton' || e.kind === 'bone_lord';
        ctx.fillStyle = tint(bones ? col : '#2b2230');
        ctx.fillRect(-s * 0.16, -s * 0.45, s * 0.12, s * 0.45);
        ctx.fillRect(s * 0.04, -s * 0.45, s * 0.12, s * 0.45);
        ctx.fillStyle = tint(e.kind === 'bone_lord' ? '#4a2a5a' : col);
        if (bones && e.kind === 'skeleton') {
          for (let k = 0; k < 4; k++) ctx.fillRect(-s * 0.2, -s * (1.15 - k * 0.15), s * 0.4, s * 0.06);
          ctx.fillRect(-s * 0.03, -s * 1.2, s * 0.06, s * 0.75);
        } else {
          roundRect(-s * 0.24, -s * 1.22, s * 0.48, s * 0.8, s * 0.08);
        }
        ctx.fillStyle = tint(bones ? '#e8e2d0' : e.kind === 'knight' ? '#3a3a46' : '#d9b48f');
        ctx.beginPath(); ctx.arc(0, -s * 1.42, s * 0.19, 0, TAU); ctx.fill();
        if (e.kind === 'bandit') { ctx.fillStyle = tint('#3a2f48'); ctx.beginPath(); ctx.arc(0, -s * 1.45, s * 0.22, Math.PI, 0); ctx.fill(); ctx.fillRect(-s * 0.22, -s * 1.42, s * 0.44, s * 0.08); }
        if (bones) { ctx.fillStyle = '#1a1420'; ctx.fillRect(s * 0.02, -s * 1.47, s * 0.06, s * 0.06); ctx.fillRect(-s * 0.1, -s * 1.47, s * 0.06, s * 0.06); }
        if (e.kind === 'knight') { ctx.fillStyle = '#ff3b3b'; ctx.fillRect(s * 0.0, -s * 1.46, s * 0.14, s * 0.03); }
        if (e.kind === 'bone_lord') { ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.moveTo(-s * 0.18, -s * 1.58); ctx.lineTo(-s * 0.12, -s * 1.78); ctx.lineTo(0, -s * 1.62); ctx.lineTo(s * 0.12, -s * 1.78); ctx.lineTo(s * 0.18, -s * 1.58); ctx.fill(); }
        // weapon / shield
        ctx.fillStyle = '#b8c0c8';
        ctx.fillRect(s * 0.28, -s * 1.3, s * 0.05, s * 0.6);
        if (e.kind === 'knight' || e.kind === 'skeleton') {
          ctx.fillStyle = e.shield > 0 ? '#7a8aa0' : '#4a4a55';
          ctx.beginPath(); ctx.ellipse(s * 0.3, -s * 0.85, s * 0.14, s * 0.24, 0, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'slime': {
        const squash = 1 + Math.sin(time * 5 + e.uid) * 0.08;
        ctx.fillStyle = tint('rgba(110,200,90,.9)');
        ctx.beginPath(); ctx.ellipse(0, -s * 0.3 * squash, s * 0.45 / squash, s * 0.32 * squash, 0, Math.PI, 0); ctx.lineTo(s * 0.45, 0); ctx.lineTo(-s * 0.45, 0); ctx.fill();
        ctx.fillStyle = '#1a2a14';
        ctx.fillRect(s * 0.08, -s * 0.38, s * 0.06, s * 0.08); ctx.fillRect(s * 0.22, -s * 0.38, s * 0.06, s * 0.08);
        break;
      }
      case 'ghost': {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = tint('#bcd8ff');
        ctx.beginPath(); ctx.arc(0, -s * 1.2, s * 0.32, Math.PI, 0);
        for (let k = 0; k <= 4; k++) ctx.lineTo(s * 0.32 - k * s * 0.16, -s * 0.3 + (k % 2) * s * 0.12 + Math.sin(time * 4 + k) * 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#20304a';
        ctx.beginPath(); ctx.arc(s * 0.1, -s * 1.22, s * 0.05, 0, TAU); ctx.arc(-s * 0.08, -s * 1.22, s * 0.05, 0, TAU); ctx.fill();
        break;
      }
      case 'troll': {
        ctx.fillStyle = tint('#5f7a46');
        ctx.beginPath(); ctx.ellipse(0, -s * 0.85, s * 0.42, s * 0.55, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.1, -s * 1.5, s * 0.2, 0, TAU); ctx.fill();
        ctx.fillRect(-s * 0.3, -s * 0.35, s * 0.18, s * 0.35); ctx.fillRect(s * 0.12, -s * 0.35, s * 0.18, s * 0.35);
        ctx.fillStyle = '#6b4a2c'; ctx.fillRect(s * 0.38, -s * 1.3, s * 0.12, s * 0.8);
        ctx.fillStyle = '#ffeb8a'; ctx.fillRect(s * 0.15, -s * 1.55, s * 0.05, s * 0.05);
        break;
      }
      case 'imp': {
        ctx.fillStyle = tint('#d6402a');
        ctx.beginPath(); ctx.ellipse(0, -s * 0.75, s * 0.2, s * 0.28, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -s * 1.12, s * 0.16, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-s * 0.1, -s * 1.22); ctx.lineTo(-s * 0.16, -s * 1.42); ctx.lineTo(-s * 0.02, -s * 1.26); ctx.fill();
        ctx.beginPath(); ctx.moveTo(s * 0.1, -s * 1.22); ctx.lineTo(s * 0.16, -s * 1.42); ctx.lineTo(s * 0.02, -s * 1.26); ctx.fill();
        const flap = Math.sin(time * 14) * s * 0.12;
        ctx.fillStyle = tint('#8a1f14');
        ctx.beginPath(); ctx.moveTo(-s * 0.1, -s * 0.85); ctx.lineTo(-s * 0.55, -s * 1.05 - flap); ctx.lineTo(-s * 0.35, -s * 0.7); ctx.fill();
        ctx.fillStyle = '#ffd34d'; ctx.fillRect(s * 0.05, -s * 1.15, s * 0.04, s * 0.04);
        break;
      }
      case 'golem': {
        ctx.fillStyle = tint('#4a3a34');
        roundRect(-s * 0.45, -s * 1.5, s * 0.9, s * 1.1, s * 0.12);
        ctx.fillRect(-s * 0.4, -s * 0.4, s * 0.28, s * 0.4); ctx.fillRect(s * 0.12, -s * 0.4, s * 0.28, s * 0.4);
        ctx.strokeStyle = `rgba(255,${120 + 60 * Math.sin(time * 3)},40,.9)`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 1.3); ctx.lineTo(-s * 0.05, -s * 1.0); ctx.lineTo(-s * 0.2, -s * 0.7); ctx.moveTo(s * 0.2, -s * 1.4); ctx.lineTo(s * 0.1, -s * 0.9); ctx.stroke();
        ctx.fillStyle = '#ffb347'; ctx.fillRect(s * 0.15, -s * 1.3, s * 0.1, s * 0.06);
        break;
      }
      case 'ash_lord': {
        const ph = e.phase;
        const col = ph === 0 ? '#5a5f6a' : ph === 1 ? '#e0602a' : '#2a1838';
        if (ph === 1) { ctx.shadowColor = '#ff8a3d'; ctx.shadowBlur = 24; }
        if (ph === 2) { ctx.shadowColor = '#9a6aff'; ctx.shadowBlur = 20; ctx.globalAlpha = 0.85; }
        ctx.fillStyle = tint(col);
        ctx.fillRect(-s * 0.2, -s * 0.5, s * 0.14, s * 0.5);
        ctx.fillRect(s * 0.06, -s * 0.5, s * 0.14, s * 0.5);
        roundRect(-s * 0.32, -s * 1.35, s * 0.64, s * 0.9, s * 0.1);
        ctx.beginPath(); ctx.arc(0, -s * 1.55, s * 0.2, 0, TAU); ctx.fill();
        ctx.fillStyle = ph === 2 ? '#c9a8ff' : '#ffd34d';
        ctx.beginPath(); ctx.moveTo(-s * 0.22, -s * 1.7); ctx.lineTo(-s * 0.15, -s * 1.95); ctx.lineTo(-s * 0.05, -s * 1.74); ctx.lineTo(0, -s * 2); ctx.lineTo(s * 0.05, -s * 1.74); ctx.lineTo(s * 0.15, -s * 1.95); ctx.lineTo(s * 0.22, -s * 1.7); ctx.fill();
        ctx.fillStyle = ph === 1 ? '#fff3b0' : '#ff3b3b';
        ctx.fillRect(s * 0.05, -s * 1.6, s * 0.06, s * 0.04);
        ctx.fillStyle = ph === 0 ? '#9aa4ad' : ph === 1 ? '#ffb347' : '#6a4aa0';
        ctx.fillRect(s * 0.38, -s * 1.6, s * 0.07, s * 1.2);
        ctx.globalAlpha = 1;
        break;
      }
      default:
        ctx.fillStyle = tint('#888');
        ctx.fillRect(-s * 0.3, -s, s * 0.6, s);
    }
    ctx.restore();
    ctx.shadowBlur = 0;
    // health bar
    const bw = s * 0.9, by = y - s * (e.boss ? 2.2 : 1.85);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(x - bw / 2, by, bw, 5);
    ctx.fillStyle = e.boss ? '#ff6f91' : '#e05a4a';
    ctx.fillRect(x - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), 5);
    if (e.slowT > 0) { ctx.fillStyle = '#7fd8ff'; ctx.fillRect(x - bw / 2, by + 6, bw * 0.2, 2); }
    if (e.regenStop > 0 && e.regen) { ctx.fillStyle = '#ff8a3d'; ctx.fillRect(x - bw / 2 + bw * 0.25, by + 6, bw * 0.2, 2); }
  }

  // ───────────── Drawing: scenes ─────────────
  function drawBattle(dt) {
    const b = run.battle;
    const enemies = b ? b.enemies.filter((e) => !e.dead) : [];
    const L = V.battleLayout(view, Math.max(1, enemies.length));
    drawBackground(run.act, view.w, view.h, L.ground);
    const look = V.heroLook(run);
    const enter = fx.enter > 0 ? fx.enter / 0.6 : 0;
    drawHero(L.hero.x - enter * L.s * 2, L.hero.y, L.s, look, { atk: fx.heroAtk, hurt: fx.heroHurt, swap: fx.swap });
    enemies.forEach((e, i) => {
      const slot = L.slots[i];
      const p = fx.pos[e.uid] || (fx.pos[e.uid] = { x: slot.x + view.w * 0.3, y: slot.y });
      p.x += (slot.x - p.x) * Math.min(1, dt * 6);
      p.y = slot.y;
      drawEnemy(e, p.x, p.y, L.s, fx.flash[e.uid] || 0);
    });
    for (const sp of fx.spells) drawSpell(sp, L);
    if (fx.phase > 0) {
      ctx.fillStyle = `rgba(255,240,220,${fx.phase * 0.5})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (b && b.enraged) {
      ctx.fillStyle = `rgba(255,40,40,${0.08 + 0.05 * Math.sin(time * 6)})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }

  function drawSpell(sp, L) {
    const k = sp.t / 0.5;
    const hx = L.hero.x, hy = L.hero.y - L.s;
    const target = run.battle && run.battle.enemies.find((e) => !e.dead);
    const tp = target ? enemyPos(target.uid) : { x: view.w * 0.7, y: L.ground };
    if (sp.spell === 'fireball' || sp.spell === 'smite') {
      const color = sp.spell === 'fireball' ? '#ff8a3d' : '#ffe066';
      const x = hx + (tp.x - hx) * k, y = hy + (tp.y - L.s - hy) * k - Math.sin(k * Math.PI) * L.s * 0.6;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(x, y, L.s * 0.14, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (sp.spell === 'nova') {
      ctx.strokeStyle = `rgba(127,216,255,${1 - k})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(hx, hy, k * view.w * 0.7, -0.6, 0.6); ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(143,227,154,${1 - k})`;
      for (let i = 0; i < 6; i++) ctx.fillRect(hx - L.s * 0.3 + i * L.s * 0.12, hy - k * L.s, 3, 3);
    }
  }

  function drawMap() {
    const map = run.map;
    const L = V.mapLayout(map, view);
    const [a, b] = ACT_SKY[run.act] || ACT_SKY[1];
    const g = ctx.createLinearGradient(0, 0, view.w, view.h);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = `700 ${Math.max(12, Math.round(view.w / 40))}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(t('Акт {n}: {name}', { n: run.act, name: t(K.ACT_NAMES[run.act]) }), 10, 8);
    const cur = run.at == null ? -1 : map.nodes[run.at].row;
    const reach = C.reachable(run);
    // paths
    for (const n of map.nodes) {
      for (const k of n.next) {
        const p = L.pos[n.id], q = L.pos[k];
        const done = n.row < cur || (n.id === run.at);
        ctx.strokeStyle = done && (k === run.at || reach.includes(k)) ? 'rgba(255,224,160,.8)' : n.row < cur ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.3)';
        ctx.lineWidth = 2;
        ctx.setLineDash(n.row >= cur ? [4, 5] : []);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const focusId = reach[mapFocus % Math.max(1, reach.length)];
    for (const n of map.nodes) {
      const p = L.pos[n.id];
      const isReach = reach.includes(n.id), past = n.row <= cur && n.id !== run.at;
      const pulse = isReach ? 1 + Math.sin(time * 5) * 0.08 : 1;
      const r = L.r * (n.kind === 'boss' ? 1.35 : 1) * pulse;
      ctx.globalAlpha = past ? 0.35 : 1;
      ctx.fillStyle = n.kind === 'boss' ? '#5a1a2a' : n.kind === 'elite' ? '#4a1d36' : '#2a2238';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      ctx.lineWidth = isReach ? 3 : 1.5;
      ctx.strokeStyle = n.id === run.at ? '#ffd34d' : isReach ? '#ff9bb2' : 'rgba(255,255,255,.4)';
      ctx.stroke();
      if (isReach && n.id === focusId && keyboardMap) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = '#f5eefc';
      ctx.font = `${Math.round(r * 1.05)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(V.KIND_ICON[n.kind], p.x, p.y + 1);
      ctx.globalAlpha = 1;
    }
    // the hero token
    const at = run.at == null ? null : L.pos[run.at];
    const hp = at || { x: L.pos[map.rows[0][0]].x - L.r * 2.2, y: view.h / 2 };
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath(); ctx.arc(hp.x, hp.y - L.r - 8 + Math.sin(time * 4) * 2, 6, 0, TAU); ctx.fill();
    if (reach.length) {
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.font = `600 ${Math.max(11, Math.round(view.w / 52))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(t('Выбери, куда идти'), view.w / 2, view.h - 6);
    }
  }
  let keyboardMap = false;

  function drawFloats(dt) {
    fx.floats = fx.floats.filter((f) => (f.t += dt) < f.life);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of fx.floats) {
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `800 ${f.big ? 22 : 16}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(f.text, f.x, f.y - k * 34);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - k * 34);
    }
    ctx.globalAlpha = 1;
    fx.particles = fx.particles.filter((p) => (p.t += dt) < p.life);
    for (const p of fx.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt;
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawMenuScene() {
    const L = V.battleLayout(view, 1);
    drawBackground(1 + (Math.floor(time / 8) % 3), view.w, view.h, L.ground);
    const fake = { hero: { level: 1 + (Math.floor(time / 2.5) % 16) }, eq: { weapon: 1, armor: 2 }, bag: [{ uid: 1, id: ['rusty_sword', 'flame_blade', 'frost_staff', 'sun_mace'][Math.floor(time / 2.5) % 4], tier: 1 }, { uid: 2, id: 'chain', tier: 1 + (Math.floor(time / 2.5) % 5) }] };
    drawHero(view.w / 2, L.ground, L.s * 1.1, V.heroLook(fake), { atk: 0, hurt: 0, swap: 0 });
  }

  // ───────────── Frame ─────────────
  function frame(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    time += dt;
    if (fx) {
      fx.heroAtk = Math.max(0, fx.heroAtk - dt);
      fx.heroHurt = Math.max(0, fx.heroHurt - dt);
      fx.swap = Math.max(0, fx.swap - dt);
      fx.shake = Math.max(0, fx.shake - dt * 20);
      fx.phase = Math.max(0, fx.phase - dt * 1.5);
      for (const k of Object.keys(fx.flash)) { fx.flash[k] -= dt; if (fx.flash[k] <= 0) delete fx.flash[k]; }
      fx.spells = fx.spells.filter((s) => (s.t += dt) < 0.5);
      if (fx.banner) { fx.banner.t -= dt; if (fx.banner.t <= 0) { fx.banner = null; $('banner').hidden = true; } }
    }
    if (screen === 'battle') battleFrame(dt);
    if (screen === 'after') {
      after -= dt;
      if (after <= 0) sync();
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    if (fx && fx.shake > 0) ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
    if (!run) drawMenuScene();
    else if (run.phase === 'battle' || screen === 'after') {
      if (run.battle || screen === 'after') drawBattle(dt); else drawMap();
    } else if (run.phase === 'map') drawMap();
    else drawBattle(dt);
    if (fx) drawFloats(dt);
    if ((screen === 'battle' || screen === 'after') && run) {
      if (Math.floor(time * 4) !== Math.floor((time - dt) * 4)) { renderHUD(); renderFoe(); }
    }
    requestAnimationFrame(frame);
  }

  // ───────────── Input ─────────────
  canvas.addEventListener('pointerdown', (e) => {
    if (screen !== 'map' || !run) return;
    Sound.unlock();
    keyboardMap = false;
    const r = canvas.getBoundingClientRect();
    const L = V.mapLayout(run.map, view);
    const id = V.nodeAt(L, e.clientX - r.left, e.clientY - r.top);
    if (id != null && C.choose(run, id)) acted();
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.code;
    if (k === 'KeyM') { toggleSound(); return; }
    if (k === 'Escape') {
      if (bagOpen) { closeBag(); return; }
      if (screen === 'battle') { if (!paused) togglePause(); else showMenu(); return; }
      if (screen === 'hall' || screen === 'result' || screen === 'map' || screen === 'choice' || !$('confirm').hidden) showMenu();
      return;
    }
    if (!run) return;
    Sound.unlock();
    if (screen === 'battle') {
      if (/^Digit[1-4]$/.test(k)) { swapTo(Number(k.slice(5)) - 1); e.preventDefault(); }
      else if (k === 'KeyQ') drinkPotion();
      else if (k === 'Space') { togglePause(); e.preventDefault(); }
      return;
    }
    if (k === 'KeyB') { if (bagOpen) closeBag(); else openBag(); return; }
    if (k === 'KeyQ') { drinkPotion(); return; }
    if (screen === 'map') {
      const reach = C.reachable(run);
      if (!reach.length) return;
      if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(k)) {
        keyboardMap = true;
        mapFocus = (mapFocus + (k === 'ArrowUp' || k === 'ArrowLeft' ? reach.length - 1 : 1)) % reach.length;
        e.preventDefault();
      } else if (k === 'Enter' || k === 'Space') {
        keyboardMap = true;
        if (C.choose(run, reach[mapFocus % reach.length])) acted();
        e.preventDefault();
      }
    }
  });

  $('btn-run').addEventListener('click', () => { Sound.unlock(); if (save.current) resumeRun(); else startRun(); });
  $('btn-new').addEventListener('click', () => { show('confirm'); $('btn-confirm-no').focus(); });
  $('btn-confirm-no').addEventListener('click', showMenu);
  $('btn-confirm-yes').addEventListener('click', () => { save.current = null; persist(); startRun(); });
  $('btn-hall').addEventListener('click', showHall);
  $('btn-hall-back').addEventListener('click', () => (run && run.phase !== 'won' && run.phase !== 'lost' ? sync() : showMenu()));
  $('btn-sound-menu').addEventListener('click', toggleSound);
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-bag').addEventListener('click', () => (bagOpen ? closeBag() : openBag()));
  $('btn-bag-close').addEventListener('click', closeBag);
  $('btn-potion').addEventListener('click', () => { Sound.unlock(); drinkPotion(); });
  $('btn-speed').addEventListener('click', () => { speed = speed === 1 ? 2 : 1; renderHUD(); });
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-pause-menu').addEventListener('click', showMenu);
  $('btn-res-menu').addEventListener('click', showMenu);
  $('btn-res-hall').addEventListener('click', () => { run = null; showHall(); });
  $('btn-again').addEventListener('click', startRun);

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  window.addEventListener('pagehide', () => { if (run && screen !== 'battle') persistRun(); });
  window.addEventListener('blur', () => { if (screen === 'battle' && !paused) togglePause(); });

  // ───────────── Boot ─────────────
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = t(meta.content);
  const actions = $('top-actions');
  actions.append(window.I18n.toggle('chip'));
  if (window.GameNav) actions.append(window.GameNav.home('chip'));
  // The run on screen, for the browser smoke test. Read-only use only.
  window.heroDebugRun = () => run;
  clearFx();
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
