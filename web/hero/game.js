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
    const h = Math.max(160, Math.floor(Math.min(stage.clientHeight - padY, w * 1.15)));
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
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
        freshBattleFx();
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
  // Everything here is visual. The battle keeps its fixed step whatever the effects do: the "hit-stop" only slows
  // the animations for a few frames, never the simulation.
  function clearFx() {
    fx = {
      pos: {}, seen: {}, flash: {}, kb: {}, eAtk: {}, dodge: {}, guard: {}, hpShow: {}, dying: [], later: [], spells: [], bursts: [],
      heroAtk: 0, heroHurt: 0, heroFlash: 0, heroDodge: 0, swap: 0, swapFlash: 0, stop: 0, punch: 0,
      phase: 0, phaseColor: '#ffffff', lvl: 0, rank: 0, enter: 0, outcome: null, outT: 0, banner: null,
    };
    parts.clear();
    floaters = new F.Floaters();
    shake.trauma = 0;
  }

  // A new battle: enemies slide in again and nothing of the last fight lingers.
  function freshBattleFx() {
    fx.pos = {}; fx.seen = {}; fx.flash = {}; fx.kb = {}; fx.eAtk = {}; fx.dodge = {}; fx.guard = {}; fx.hpShow = {};
    fx.dying = []; fx.later = []; fx.spells = []; fx.outcome = null; fx.outT = 0;
  }

  // Enemies by uid, kept after they die so the last blow of a battle still knows who it hit.
  const foeOf = (uid) => fx.seen[uid] || (run && run.battle ? run.battle.enemies.find((x) => x.uid === uid) : null);
  const sizeOf = (e) => (e && e.boss ? 1.7 : e && e.elite ? 1.2 : 1);

  function enemyPos(uid) {
    const p = fx.pos[uid];
    return p ? { x: p.x, y: p.y } : { x: view.w * 0.7, y: V.battleLayout(view).ground };
  }

  function float(x, y, text, color, big) {
    floaters.add(text, x + (Math.random() - 0.5) * 14, y, { color, size: big ? 23 : 17, life: big ? 1.2 : 0.9, rise: big ? 40 : 30 });
  }

  function later(t, fn) { fx.later.push({ t, fn }); }

  // The burst where a blow lands, by damage type: steel sparks, fire and smoke, ice shards, holy stars.
  function impact(x, y, type, crit, scale = 1) {
    const k = (crit ? 1.55 : 1) * scale;
    const col = V.TYPE_COLOR[type] || '#ffffff';
    parts.emit({ x, y, shape: 'ring', size: 7 * k, grow: 130 * k, life: 0.26, color: crit ? '#fff3c0' : col });
    fx.bursts.push({ x, y, r: 30 * k, color: col, t: 0, life: crit ? 0.22 : 0.14 });
    const n = Math.round((crit ? 14 : 8) * scale);
    if (type === 'fire') {
      parts.burst(x, y, n, { shape: 'spark', colors: ['#fff2a0', '#ffb347', '#ff6a2a'], speed: 230 * k, life: 0.3, size: 2.2, drag: 0.9, gravity: 120 });
      parts.burst(x, y, 3, { shape: 'smoke', color: '#3a2420', speed: 30, life: 0.7, size: 5 * scale, grow: 18, gravity: -40, alpha: 0.6 });
      parts.burst(x, y, 4, { shape: 'dot', color: '#ffb347', speed: 90, life: 0.6, size: 1.6, gravity: -80 });
    } else if (type === 'ice') {
      parts.burst(x, y, n, { shape: 'chunk', colors: ['#e8fbff', '#9fe6ff', '#5ec2f0'], speed: 200 * k, life: 0.45, size: 3.5 * scale, spin: 14, gravity: 420, drag: 0.6 });
      parts.burst(x, y, 4, { shape: 'star', color: '#ffffff', speed: 60, life: 0.4, size: 3 });
    } else if (type === 'holy') {
      parts.burst(x, y, n, { shape: 'spark', colors: ['#ffffff', '#fff3b0', '#ffe066'], speed: 250 * k, life: 0.3, size: 2, drag: 0.9 });
      parts.burst(x, y, 5, { shape: 'star', colors: ['#ffe066', '#fffbe0'], speed: 80, life: 0.55, size: 3.5, spin: 6, gravity: -30 });
    } else {
      parts.burst(x, y, n, { shape: 'spark', colors: ['#ffffff', '#ffe9b0', '#cfd8e6'], speed: 260 * k, life: 0.24, size: 2, drag: 0.92, gravity: 300 });
    }
    if (crit) parts.emit({ x, y, shape: 'star', size: 18, life: 0.2, color: '#ffffff', angle: Math.random() });
  }

  function banner(text, seconds = 1.6) {
    fx.banner = { text, t: seconds };
    const b = $('banner');
    b.textContent = text;
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth; // restart the pop-in for every new banner
    b.style.animation = '';
  }

  const SPELL_DELAY = { fireball: 0.24, smite: 0.14, nova: 0.16 };

  function handle(events) {
    const L = V.battleLayout(view);
    const s = L.s;
    const hx = L.hero.x, hy = L.hero.y - s * 1.2;
    const hand = { x: hx + s * 0.45, y: L.hero.y - s * 1.0 };
    let spell = null;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const p = enemyPos(e.uid), k = sizeOf(foeOf(e.uid)), col = V.TYPE_COLOR[e.dmgType];
          const land = () => {
            fx.flash[e.uid] = e.crit ? 0.16 : 0.11;
            fx.kb[e.uid] = Math.min(1.6, (fx.kb[e.uid] || 0) + (e.crit ? 1 : 0.55) / k);
            floaters.add(e.crit ? `${e.dmg}!` : String(e.dmg), p.x - s * 0.3 * k + (Math.random() - 0.5) * 16, p.y - s * 1.25 * k,
              { color: col, size: e.crit ? 31 : 18, life: e.crit ? 1.15 : 0.85, rise: e.crit ? 46 : 30 });
            impact(p.x - s * 0.2 * k, p.y - s * 0.85 * k, e.dmgType, e.crit);
            if (e.crit) { shake.add(0.4); fx.punch = 1; }
          };
          if (e.spell) later(SPELL_DELAY[spell] || 0.12, land);
          else { land(); fx.heroAtk = SWING; fx.stop = e.crit ? 0.1 : 0.055; }
          sfx(e.crit ? 'crit' : 'hit', { type: e.dmgType });
          break;
        }
        case 'miss': {
          const p = enemyPos(e.uid);
          float(p.x, p.y - s * 1.5, t('Промах'), '#c9c3d6');
          fx.dodge[e.uid] = 0.32; fx.heroAtk = SWING;
          parts.burst(p.x - s * 0.3, p.y - s * 0.7, 5, { shape: 'smoke', color: '#d9d2e8', speed: 40, life: 0.45, size: 4, grow: 10, alpha: 0.5 });
          sfx('dodge');
          break;
        }
        case 'block': {
          const p = enemyPos(e.uid);
          float(p.x, p.y - s * 1.5, t('Блок'), '#9fd0ff');
          fx.guard[e.uid] = 0.4; fx.heroAtk = SWING; fx.stop = 0.045;
          parts.burst(p.x - s * 0.45, p.y - s * 0.85, 9, { shape: 'spark', colors: ['#ffffff', '#bfe3ff'], speed: 220, life: 0.25, size: 2, drag: 0.9, gravity: 250 });
          sfx('block');
          break;
        }
        case 'immune': {
          const p = enemyPos(e.uid);
          float(p.x, p.y - s * 1.5, t('Иммунитет'), '#ff8a7a', true);
          fx.guard[e.uid] = 0.45; fx.heroAtk = SWING;
          parts.burst(p.x - s * 0.4, p.y - s * 0.85, 8, { shape: 'chunk', color: '#ff8a7a', speed: 120, life: 0.4, size: 3, spin: 10, gravity: 300 });
          sfx('block');
          break;
        }
        case 'thorns':
          float(hx, hy - s * 0.4, `−${e.dmg}`, '#ff8a7a');
          fx.heroFlash = Math.max(fx.heroFlash, 0.08);
          parts.burst(hand.x, hand.y, 6, { shape: 'chunk', color: '#d04a6a', speed: 110, life: 0.35, size: 2.5, spin: 10, gravity: 200 });
          break;
        case 'hurt': {
          fx.heroHurt = 0.28; fx.heroFlash = 0.14; fx.eAtk[e.uid] = E_ATK;
          shake.add(0.24);
          float(hx, hy - s * 0.4, `−${e.dmg}`, '#ff6a5c');
          impact(hx + s * 0.15, L.hero.y - s * 0.95, e.dmgType || 'phys', false, 0.7);
          sfx('hurt');
          break;
        }
        case 'dodge':
          float(hx, hy - s * 0.4, t('Уклонение'), '#c9c3d6');
          fx.heroDodge = 0.32; fx.eAtk[e.uid] = E_ATK;
          sfx('dodge');
          break;
        case 'spell':
          spell = e.spell;
          fx.spells.push({ spell: e.spell, t: 0 });
          if (e.amount) float(hx, hy - s * 0.4, `+${e.amount}`, '#8fe39a');
          if (e.spell === 'heal') parts.burst(hx, L.hero.y - s * 0.6, 14, { shape: 'dot', colors: ['#8fe39a', '#d8ffd8', '#4fd27a'], speed: 50, life: 0.9, size: 2.2, gravity: -90 });
          sfx('spell', { spell: e.spell });
          break;
        case 'swap': {
          fx.swap = C.SWAP_TIME;
          const w = run && V.heroLook(run).weapon;
          parts.emit({ x: hand.x, y: hand.y, shape: 'ring', size: 4, grow: 90, life: 0.3, color: w ? w.color : '#ffffff' });
          sfx('swap');
          renderSlots();
          break;
        }
        case 'swapped': {
          fx.swapFlash = 0.45;
          const w = run && V.heroLook(run).weapon;
          const col = w ? w.color : '#ffffff';
          parts.emit({ x: hand.x, y: hand.y - s * 0.3, shape: 'ring', size: 6, grow: 160, life: 0.35, color: col });
          parts.burst(hand.x, hand.y - s * 0.3, 14, { shape: 'star', colors: [col, '#ffffff'], speed: 120, life: 0.5, size: 3, spin: 8 });
          renderSlots();
          break;
        }
        case 'kill': {
          const p = enemyPos(e.uid), en = foeOf(e.uid), k = sizeOf(en);
          if (en) fx.dying.push({ e: en, x: p.x, y: p.y, t: 0 });
          parts.burst(p.x, p.y - s * 0.8 * k, Math.round(14 * k), { shape: 'smoke', colors: ['#d9cbe8', '#8a7fa0', '#5a4f6a'], speed: 70 * k, life: 0.8, size: 5 * k, grow: 14, gravity: -30, alpha: 0.6 });
          parts.burst(p.x, p.y - s * 0.8 * k, 10, { shape: 'spark', colors: ['#ffffff', '#ffd7e0'], speed: 240 * k, life: 0.3, size: 2, drag: 0.9 });
          shake.add(e.boss ? 0.7 : 0.18);
          if (e.gold) {
            float(p.x, p.y - s * 2.1 * k, `+${e.gold}`, '#ffd34d');
            parts.burst(p.x, p.y - s * 0.9 * k, Math.min(12, 3 + e.gold), { shape: 'dot', color: '#ffd34d', speed: 140, angle: -Math.PI / 2, spread: 1.6, life: 0.7, size: 2.6, gravity: 520 });
          }
          sfx('death');
          break;
        }
        case 'summon':
          banner(t('Подмога: {name}', { name: t(K.ENEMIES[e.kind].name) }), 1.2);
          parts.burst(view.w * 0.86, L.ground - s * 0.6, 14, { shape: 'smoke', colors: ['#2a2238', '#4a3f5e'], speed: 60, life: 0.7, size: 6, grow: 16, alpha: 0.7 });
          break;
        case 'phase': {
          fx.phase = 1;
          fx.phaseColor = e.phase === 1 ? '#ff8a3d' : e.phase === 2 ? '#a77bff' : '#ffffff';
          shake.add(0.9);
          const p = enemyPos(e.uid);
          for (let i = 0; i < 3; i++) parts.emit({ x: p.x, y: p.y - s * 1.6, shape: 'ring', size: 6 + i * 6, grow: 260 + i * 80, life: 0.6 + i * 0.12, color: fx.phaseColor });
          parts.burst(p.x, p.y - s * 1.6, 30, { shape: e.phase === 1 ? 'spark' : 'smoke', colors: [fx.phaseColor, '#ffffff', F.shade(fx.phaseColor, -0.4)], speed: 260, life: 0.8, size: e.phase === 1 ? 3 : 7, grow: e.phase === 1 ? 0 : 16, drag: 0.6 });
          banner(t('Повелитель пепла: {name}!', { name: t(K.BOSSES.ash_lord.phases[e.phase].name) }));
          sfx('phase');
          break;
        }
        case 'enrage': banner(t('Враги в ярости!'), 1.4); shake.add(0.3); break;
        case 'levelup': {
          fx.lvl = 1.4;
          if (C.title(e.level) !== C.title(e.level - 1)) fx.rank = 1.9;
          parts.burst(hx, L.hero.y - s * 0.9, fx.rank > 0 ? 34 : 20, { shape: 'star', colors: ['#ffe066', '#fffbe0', '#ffb347'], speed: fx.rank > 0 ? 220 : 150, life: 0.9, size: 3.5, spin: 8, drag: 0.5, gravity: 60 });
          banner(t('Новый уровень: {n} — {title}', { n: e.level, title: t(e.title) }), 2);
          sfx('levelup');
          break;
        }
        case 'potion':
          float(hx, hy - s * 0.4, `+${e.amount}`, '#8fe39a');
          parts.burst(hx, L.hero.y - s * 0.7, 16, { shape: 'dot', colors: ['#8fe39a', '#d8ffd8', '#ff8fb0'], speed: 60, life: 0.9, size: 2.2, gravity: -100 });
          sfx('potion');
          break;
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
      if (run.phase === 'won') {
        const L = V.battleLayout(view);
        for (const x of [0.2, 0.5, 0.8]) parts.burst(view.w * x, L.ground - L.s * 3, 24, { shape: 'confetti', colors: ['#ffd34d', '#ff6f91', '#7fd8ff', '#8fe39a', '#ffffff'], speed: 220, life: 1.6, size: 5, spin: 12, gravity: 260, drag: 0.4 });
      }
    } else {
      persistRun();
    }
    fx.outcome = run.phase === 'lost' ? 'lose' : 'win';
    fx.outT = 0;
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

  // ───────────── Drawing: kit ─────────────
  // The look: one light from the top left, lit volumes, soft contact shadows and additive glows (window.Fx).
  // Characters are painted into a scratch canvas first, so a hit can flash the whole figure white, a death can
  // dissolve it, and its glows land additively on the stage. Nothing here reads input or changes the run.
  const F = window.Fx;
  const ease = F.ease;
  const lerp = F.lerp;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const parts = new F.Particles(320);
  const shake = new F.Shake(9, 2.4);
  let floaters = new F.Floaters();
  let LS = -1;               // the lit side of the figure being painted, in its own x: −1 the hero, +1 a mirrored enemy
  const cam = { z: 1, x: 0 }; // battle camera: zoom about the ground line and a small parallax drift
  const SWING = 0.34;         // seconds of the hero's swing and recovery after a blow lands
  const WIND = 0.2;           // seconds of wind-up before a blow, read from the battle's own timer
  const E_WIND = 0.3, E_ATK = 0.32, DIE = 0.85;
  const REST = 0.45, BACK = -1.55, END = 2.2; // weapon angles: 0 points up, + leans forward

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // A small seeded random source for the baked scenery: the same act always looks the same.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let q = a;
      q = Math.imul(q ^ (q >>> 15), q | 1);
      q ^= q + Math.imul(q ^ (q >>> 7), q | 61);
      return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A ball lit from the figure's lit side.
  function ball(g, x, y, r, c, gloss = true) {
    if (r <= 0) return;
    const hx = x + LS * r * 0.42, hy = y - r * 0.45;
    const gr = g.createRadialGradient(hx, hy, r * 0.05, x, y, r);
    gr.addColorStop(0, F.shade(c, 0.5));
    gr.addColorStop(0.4, c);
    gr.addColorStop(0.88, F.shade(c, -0.45));
    gr.addColorStop(1, F.shade(c, -0.2));
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (gloss) {
      g.fillStyle = 'rgba(255,255,255,.42)';
      g.beginPath(); g.ellipse(hx, hy - r * 0.05, r * 0.24, r * 0.14, LS * 0.6, 0, TAU); g.fill();
    }
  }
  function oval(g, x, y, rx, ry, c, gloss = false, rot = 0) {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(rx / ry, 1); ball(g, 0, 0, ry, c, gloss); g.restore();
  }
  // A horizontal gradient across [x0, x1], bright on the lit side: torsos, robes, blocks.
  function side(g, x0, x1, c, k = 1) {
    const a = LS < 0 ? x0 : x1, b = LS < 0 ? x1 : x0;
    const gr = g.createLinearGradient(a, 0, b, 0);
    gr.addColorStop(0, F.shade(c, 0.34 * k));
    gr.addColorStop(0.35, c);
    gr.addColorStop(0.85, F.shade(c, -0.42 * k));
    gr.addColorStop(1, F.shade(c, -0.22 * k));
    return gr;
  }
  // A limb: a round-capped stroke shaded across its width.
  function limb(g, x0, y0, x1, y1, w, c) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const sg = nx * LS * 0.6 - ny * 0.8 >= 0 ? 1 : -1;
    const gr = g.createLinearGradient(mx + nx * sg * w / 2, my + ny * sg * w / 2, mx - nx * sg * w / 2, my - ny * sg * w / 2);
    gr.addColorStop(0, F.shade(c, 0.32));
    gr.addColorStop(0.4, c);
    gr.addColorStop(1, F.shade(c, -0.45));
    g.strokeStyle = gr;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  function poly(g, fill, pts) {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.fill();
  }

  // ───────────── Drawing: characters through a scratch canvas ─────────────
  const scratch = { cv: null, g: null };
  const emis = [];               // glows recorded while painting into the scratch, drawn on the stage after it
  let spr = null;                // where the scratch lands: { x0, y0, z }
  // An additive glow from inside a painter: recorded in scratch pixels, placed on the stage later.
  function glowAt(g, x, y, r, color, a = 1) {
    const m = g.getTransform();
    emis.push({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, r: r * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), color, a });
  }
  // Where a point inside a painter lands on the stage (for particles from a weapon tip).
  function worldOf(g, x, y) {
    const m = g.getTransform();
    return { x: spr.x0 + (m.a * x + m.c * y + m.e) / spr.z, y: spr.y0 + (m.b * x + m.d * y + m.f) / spr.z };
  }
  const DISSOLVE = (() => { const R = rng(4242), out = []; for (let i = 0; i < 80; i++) { const v = 0.1 + R() * 0.75; out.push({ u: 0.2 + R() * 0.6, v, th: R() * 0.55 + v * 0.35 }); } return out; })();

  // Paints a figure with its feet at (x, y). box: half the width of the area it may use (it reaches 1.6 box up).
  // o: { flash, flashColor, dissolve, burn, alpha }
  function sprite(x, y, box, o, paint) {
    const z = cam.z * view.dpr;
    const W = Math.ceil(box * 2 * z), H = Math.ceil(box * 2 * z);
    if (!scratch.cv || scratch.cv.width < W || scratch.cv.height < H) {
      scratch.cv = makeCanvas(Math.max(W, scratch.cv ? scratch.cv.width : 0), Math.max(H, scratch.cv ? scratch.cv.height : 0));
      scratch.g = scratch.cv.getContext('2d');
    }
    const g = scratch.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W + 2, H + 2);
    g.setTransform(z, 0, 0, z, box * z, box * 1.6 * z);
    emis.length = 0;
    spr = { x0: x - box, y0: y - box * 1.6, z };
    paint(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const dis = o.dissolve || 0;
    if (dis > 0) {
      const rmax = W * 0.2;
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = o.burn || '#ffb36b';
      for (const p of DISSOLVE) {
        const r = (dis - p.th) * rmax * 1.9;
        if (r > 0) { g.beginPath(); g.arc(p.u * W, p.v * H, r * 1.3 + 2, 0, TAU); g.fill(); }
      }
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      for (const p of DISSOLVE) {
        const r = (dis - p.th) * rmax * 1.9;
        if (r > 0) { g.beginPath(); g.arc(p.u * W, p.v * H, r, 0, TAU); g.fill(); }
      }
    }
    if (o.flash > 0) {
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = Math.min(1, o.flash);
      g.fillStyle = o.flashColor || '#ffffff';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = 'source-over';
    const a = (o.alpha == null ? 1 : o.alpha);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.drawImage(scratch.cv, 0, 0, W, H, x - box, y - box * 1.6, W / z, H / z);
    ctx.restore();
    const ga = a * (1 - dis);
    if (ga > 0.02) for (const e of emis) F.glow(ctx, x - box + e.x / z, y - box * 1.6 + e.y / z, e.r / z, e.color, e.a * ga);
  }

  // ───────────── Drawing: weapons ─────────────
  const MAT = {
    phys: { base: '#c9d1dc', hi: '#ffffff', lo: '#4f5a6b', guard: '#8c96a6' },
    rust: { base: '#9b6c4b', hi: '#e0b088', lo: '#3e2618', guard: '#6d5a4a' },
    fire: { base: '#ff7a2a', hi: '#fff3a8', lo: '#8e1806', guard: '#3a2624', glow: '#ff7a2a' },
    ice: { base: '#8fe3ff', hi: '#ffffff', lo: '#2a6fb0', guard: '#c8e8ff', glow: '#7fd8ff' },
    holy: { base: '#ffd34d', hi: '#fffbe0', lo: '#a26d08', guard: '#ffe9a0', glow: '#ffe066' },
  };
  const WOOD = '#7a5232';
  function matGrad(g, x0, x1, m) {
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, m.hi);
    gr.addColorStop(0.42, m.base);
    gr.addColorStop(0.58, F.shade(m.base, -0.18));
    gr.addColorStop(1, m.lo);
    return gr;
  }
  function edge(g, m, w) { g.strokeStyle = F.withAlpha(m.lo, 0.9); g.lineWidth = w; g.lineJoin = 'round'; g.stroke(); }

  // A weapon in the hand at (x, y), pointing along `ang` (0 = up). Steel shines, fire burns, ice glitters, light glows.
  function paintWeapon(g, x, y, s, w, ang, emit) {
    if (!w) return;
    const L = s * (0.9 + w.tier * 0.03);
    const m = w.id === 'rusty_sword' ? MAT.rust : MAT[w.type] || MAT.phys;
    const glowK = 0.35 + w.tier * 0.09 + 0.08 * Math.sin(time * 5);
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const grip = () => { limb(g, 0, L * 0.2, 0, -L * 0.02, L * 0.07, '#4a2e1c'); ball(g, 0, L * 0.24, L * 0.05, m.guard, false); };
    let tip = -L;
    switch (w.shape) {
      case 'axe': {
        limb(g, 0, L * 0.22, 0, -L * 1.0, L * 0.075, WOOD);
        g.beginPath();
        g.moveTo(0, -L * 0.98);
        g.bezierCurveTo(L * 0.22, -L * 1.14, L * 0.46, -L * 1.02, L * 0.44, -L * 0.8);
        g.bezierCurveTo(L * 0.44, -L * 0.6, L * 0.22, -L * 0.54, 0, -L * 0.66);
        g.closePath();
        g.fillStyle = matGrad(g, L * 0.44, 0, m);
        g.fill(); edge(g, m, L * 0.02);
        g.strokeStyle = F.withAlpha(m.hi, 0.8); g.lineWidth = L * 0.025;
        g.beginPath(); g.moveTo(L * 0.3, -L * 1.03); g.quadraticCurveTo(L * 0.47, -L * 0.92, L * 0.4, -L * 0.68); g.stroke();
        poly(g, F.shade(m.base, -0.25), [0, -L * 0.94, -L * 0.16, -L * 0.82, 0, -L * 0.74]);
        if (m.glow) glowAt(g, L * 0.25, -L * 0.84, L * 0.55, m.glow, glowK);
        tip = -L * 0.85;
        break;
      }
      case 'dagger': {
        grip();
        const bw = L * 0.07;
        g.beginPath(); g.moveTo(-bw, -L * 0.04); g.lineTo(-bw * 0.9, -L * 0.45); g.lineTo(0, -L * 0.62); g.lineTo(bw * 0.9, -L * 0.45); g.lineTo(bw, -L * 0.04); g.closePath();
        g.fillStyle = matGrad(g, -bw, bw, m); g.fill(); edge(g, m, L * 0.015);
        F.metalBar(g, -L * 0.13, 0, L * 0.13, 0, L * 0.05, m.guard);
        tip = -L * 0.6;
        if (m.glow) glowAt(g, 0, -L * 0.35, L * 0.4, m.glow, glowK);
        break;
      }
      case 'spear': {
        limb(g, 0, L * 0.35, 0, -L * 1.3, L * 0.065, WOOD);
        const bw = L * 0.085;
        g.beginPath(); g.moveTo(0, -L * 1.66); g.quadraticCurveTo(bw * 1.6, -L * 1.42, 0, -L * 1.26); g.quadraticCurveTo(-bw * 1.6, -L * 1.42, 0, -L * 1.66); g.closePath();
        g.fillStyle = matGrad(g, -bw, bw, m); g.fill(); edge(g, m, L * 0.015);
        g.strokeStyle = F.withAlpha(m.hi, 0.75); g.lineWidth = L * 0.015;
        g.beginPath(); g.moveTo(0, -L * 1.62); g.lineTo(0, -L * 1.3); g.stroke();
        limb(g, 0, -L * 1.3, 0, -L * 1.22, L * 0.1, '#d4a84a');
        if (m.glow) glowAt(g, 0, -L * 1.45, L * 0.45, m.glow, glowK);
        tip = -L * 1.62;
        break;
      }
      case 'sickle': {
        grip();
        limb(g, 0, -L * 0.02, 0, -L * 0.45, L * 0.06, '#5a3a24');
        g.beginPath();
        g.arc(L * 0.2, -L * 0.48, L * 0.32, Math.PI * 1.02, Math.PI * 1.98);
        g.arc(L * 0.24, -L * 0.42, L * 0.22, Math.PI * 1.9, Math.PI * 1.06, true);
        g.closePath();
        g.fillStyle = matGrad(g, -L * 0.1, L * 0.5, m); g.fill(); edge(g, m, L * 0.015);
        g.strokeStyle = F.withAlpha(m.hi, 0.8); g.lineWidth = L * 0.02;
        g.beginPath(); g.arc(L * 0.2, -L * 0.48, L * 0.3, Math.PI * 1.15, Math.PI * 1.6); g.stroke();
        glowAt(g, L * 0.2, -L * 0.7, L * 0.3, '#ff3b5c', 0.25 + w.tier * 0.06);
        tip = -L * 0.8;
        break;
      }
      case 'staff': {
        limb(g, 0, L * 0.35, 0, -L * 1.12, L * 0.075, WOOD);
        limb(g, 0, -L * 0.15, 0, -L * 0.05, L * 0.1, '#c8a050');
        const cy = -L * 1.3;
        if (w.type === 'ice') {
          for (const [dx, h, wd] of [[-L * 0.1, L * 0.3, L * 0.07], [L * 0.1, L * 0.26, L * 0.06], [0, L * 0.42, L * 0.09]]) {
            g.beginPath(); g.moveTo(dx, cy + L * 0.12); g.lineTo(dx - wd, cy + L * 0.12 - h * 0.45); g.lineTo(dx, cy + L * 0.12 - h); g.lineTo(dx + wd, cy + L * 0.12 - h * 0.45); g.closePath();
            g.fillStyle = matGrad(g, dx - wd, dx + wd, m); g.globalAlpha = 0.92; g.fill(); g.globalAlpha = 1; edge(g, m, L * 0.012);
          }
        } else {
          ball(g, 0, cy, L * 0.13, m.base);
        }
        g.strokeStyle = '#c8a050'; g.lineWidth = L * 0.03;
        g.beginPath(); g.moveTo(-L * 0.12, cy + L * 0.2); g.quadraticCurveTo(-L * 0.16, cy, -L * 0.06, cy - L * 0.08); g.moveTo(L * 0.12, cy + L * 0.2); g.quadraticCurveTo(L * 0.16, cy, L * 0.06, cy - L * 0.08); g.stroke();
        glowAt(g, 0, cy - L * 0.08, L * 0.6, m.glow || '#c9a8ff', glowK + 0.1);
        tip = cy - L * 0.2;
        break;
      }
      case 'mace': case 'hammer': {
        limb(g, 0, L * 0.25, 0, -L * 0.88, L * 0.075, WOOD);
        limb(g, 0, L * 0.12, 0, L * 0.02, L * 0.1, m.guard);
        if (w.shape === 'mace') {
          const r = L * 0.17, cy = -L * 0.95;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU + 0.3;
            poly(g, F.shade(m.base, -0.15), [Math.cos(a - 0.3) * r * 0.8, cy + Math.sin(a - 0.3) * r * 0.8, Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5, Math.cos(a + 0.3) * r * 0.8, cy + Math.sin(a + 0.3) * r * 0.8]);
          }
          ball(g, 0, cy, r, m.base);
          if (m.glow) glowAt(g, 0, cy, L * 0.6, m.glow, glowK);
          tip = cy;
        } else {
          const hw = L * 0.27, hh = L * 0.15, cy = -L * 1.0;
          g.save(); LS = -LS; F.block(g, -hw, cy - hh, hw * 2, hh * 2, L * 0.04, m.base, { gloss: true }); LS = -LS; g.restore();
          F.rrect(g, -hw - L * 0.03, cy - hh * 0.55, L * 0.08, hh * 1.1, L * 0.02); g.fillStyle = m.guard; g.fill();
          F.rrect(g, hw - L * 0.05, cy - hh * 0.55, L * 0.08, hh * 1.1, L * 0.02); g.fill();
          if (m.glow) glowAt(g, 0, cy, L * 0.7, m.glow, glowK + 0.05);
          tip = cy;
        }
        break;
      }
      default: { // sword
        grip();
        const bw = L * 0.085;
        g.beginPath(); g.moveTo(-bw, -L * 0.05); g.lineTo(-bw, -L * 0.84); g.lineTo(0, -L * 1.02); g.lineTo(bw, -L * 0.84); g.lineTo(bw, -L * 0.05); g.closePath();
        g.fillStyle = matGrad(g, -bw, bw, m); g.fill(); edge(g, m, L * 0.016);
        g.strokeStyle = F.withAlpha(m.hi, 0.7); g.lineWidth = L * 0.018;
        g.beginPath(); g.moveTo(-bw * 0.15, -L * 0.1); g.lineTo(-bw * 0.15, -L * 0.82); g.stroke();
        if (w.id === 'rusty_sword') {
          g.fillStyle = 'rgba(90,40,20,.55)';
          for (const [px, py, pr] of [[-0.3, 0.3, 0.5], [0.4, 0.55, 0.4], [-0.2, 0.72, 0.35]]) { g.beginPath(); g.arc(px * bw, -L * py, pr * bw, 0, TAU); g.fill(); }
        }
        if (w.type === 'fire') { // licking flames along the edges
          g.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 4; i++) {
            const fy = -L * (0.25 + i * 0.18), fl = Math.sin(time * 14 + i * 2.1) * 0.5 + 0.5;
            poly(g, F.withAlpha(i % 2 ? '#ffd27a' : '#ff8a3d', 0.75), [bw, fy, bw + L * (0.1 + 0.08 * fl), fy - L * 0.12, bw * 0.4, fy - L * 0.1]);
          }
          g.globalCompositeOperation = 'source-over';
        }
        F.metalBar(g, -L * 0.2, 0, L * 0.2, 0, L * 0.06, m.guard);
        if (m.glow) { glowAt(g, 0, -L * 0.35, L * 0.45, m.glow, glowK); glowAt(g, 0, -L * 0.78, L * 0.45, m.glow, glowK); }
        tip = -L;
      }
    }
    if (w.type === 'ice') { const tw = 0.5 + 0.5 * Math.sin(time * 4.3); glowAt(g, 0, tip, L * 0.18, '#ffffff', tw * 0.8); }
    if (emit && m.glow && Math.random() < 0.18) {
      const p = worldOf(g, (Math.random() - 0.5) * L * 0.15, tip * (0.4 + Math.random() * 0.6));
      if (w.type === 'fire') parts.emit({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 30, shape: 'dot', size: 1.4, life: 0.6, color: Math.random() < 0.5 ? '#ffb347' : '#ff7a2a' });
      else if (w.type === 'ice') parts.emit({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 16, vy: 10, shape: 'star', size: 2, life: 0.6, color: '#e8fbff' });
      else parts.emit({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 20, vy: -25, shape: 'dot', size: 1.5, life: 0.7, color: '#fff3b0' });
    }
    g.restore();
  }

  // ───────────── Drawing: the hero ─────────────
  // Rank 0 a hooded novice, 1 a steel helmet, 2 a plumed helmet and a cape, 3 a golden winged helm and an aura.
  const rankOf = (look) => (look.aura ? 3 : look.cape ? 2 : look.helmet ? 1 : 0);
  const SKIN = '#f2c39b';

  function paintHero(g, s, look, pose) {
    const rank = rankOf(look), arm = look.armor;
    const body = arm ? arm.color : '#8a6a48';
    const style = arm ? arm.id : 'cloth';
    const trim = rank >= 3 ? '#ffd34d' : arm && arm.tier >= 3 ? '#e8c35a' : null;
    const heavy = style === 'plate' || style === 'scale' || style === 'chain';
    g.rotate(pose.lean);
    g.scale(pose.sx, pose.sy);
    // the cape, behind everything
    if (look.cape) {
      const wave = Math.sin(time * 3.2) * s * 0.05 + (pose.kick || 0) * s * 0.18;
      const capeC = rank >= 3 ? '#a5163a' : '#b3203a';
      g.fillStyle = side(g, -s * 0.7, 0, capeC);
      g.beginPath();
      g.moveTo(-s * 0.16, -s * 1.2);
      g.bezierCurveTo(-s * 0.42, -s * 0.95, -s * 0.55 - wave, -s * 0.5, -s * 0.66 - wave * 1.5, -s * 0.1);
      g.quadraticCurveTo(-s * 0.36, -s * 0.0 + wave * 0.4, -s * 0.06, -s * 0.24);
      g.lineTo(s * 0.06, -s * 1.16);
      g.closePath();
      g.fill();
      g.strokeStyle = trim || F.shade(capeC, 0.35);
      g.lineWidth = s * 0.035;
      g.beginPath(); g.moveTo(-s * 0.66 - wave * 1.5, -s * 0.1); g.quadraticCurveTo(-s * 0.36, -s * 0.0 + wave * 0.4, -s * 0.06, -s * 0.24); g.stroke();
    }
    const legC = heavy && arm.tier >= 2 ? F.shade(body, -0.15) : '#3f3550';
    const bootC = heavy && arm.tier >= 3 ? F.shade(body, -0.25) : '#4a2e1c';
    const walk = Math.sin(time * 4) * s * 0.015;
    // back arm and leg are a touch darker: depth
    limb(g, -s * 0.09, -s * 0.52, -s * 0.12 - walk, -s * 0.1, s * 0.15, F.shade(legC, -0.2));
    oval(g, -s * 0.09 - walk, -s * 0.07, s * 0.12, s * 0.075, F.shade(bootC, -0.2));
    limb(g, s * 0.09, -s * 0.52, s * 0.12 + walk, -s * 0.1, s * 0.15, legC);
    oval(g, s * 0.15 + walk, -s * 0.07, s * 0.125, s * 0.078, bootC, true);
    limb(g, -s * 0.18, -s * 1.08, -s * 0.28, -s * 0.74, s * 0.12, F.shade(heavy ? body : '#7a5a3c', -0.25));
    ball(g, -s * 0.29, -s * 0.7, s * 0.07, F.shade(SKIN, -0.2), false);
    // the torso
    const robe = style === 'robe';
    g.beginPath();
    g.moveTo(-s * 0.27, -s * 1.16);
    g.quadraticCurveTo(0, -s * 1.28, s * 0.27, -s * 1.16);
    if (robe) { g.lineTo(s * 0.34, -s * 0.12); g.quadraticCurveTo(0, -s * 0.04, -s * 0.34, -s * 0.12); }
    else { g.lineTo(s * 0.24, -s * 0.5); g.quadraticCurveTo(0, -s * 0.44, -s * 0.24, -s * 0.5); }
    g.closePath();
    g.fillStyle = side(g, -s * 0.3, s * 0.3, body);
    g.fill();
    g.save();
    g.clip();
    // armour detail, clipped to the torso
    g.lineWidth = s * 0.025;
    if (style === 'chain' || style === 'scale') {
      g.strokeStyle = F.withAlpha(F.shade(body, -0.45), 0.6);
      const step = s * (style === 'scale' ? 0.11 : 0.07);
      for (let yy = -s * 1.2, row = 0; yy < -s * 0.1; yy += step * 0.7, row++) {
        for (let xx = -s * 0.36 + (row % 2) * step / 2; xx < s * 0.36; xx += step) { g.beginPath(); g.arc(xx, yy, step / 2, 0.15, Math.PI - 0.15); g.stroke(); }
      }
    } else if (style === 'leather' || style === 'cloth') {
      g.strokeStyle = F.shade(body, -0.4);
      g.lineWidth = s * 0.07;
      g.beginPath(); g.moveTo(-s * 0.28, -s * 1.18); g.lineTo(s * 0.26, -s * 0.55); g.stroke();
      g.strokeStyle = F.withAlpha('#fff2d8', 0.25); g.lineWidth = s * 0.012; g.setLineDash([s * 0.03, s * 0.03]);
      g.beginPath(); g.moveTo(-s * 0.28, -s * 1.14); g.lineTo(s * 0.26, -s * 0.51); g.stroke(); g.setLineDash([]);
    } else if (style === 'plate') {
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.beginPath(); g.ellipse(-s * 0.08, -s * 0.98, s * 0.09, s * 0.16, 0.25, 0, TAU); g.fill();
      g.strokeStyle = F.shade(body, -0.35); g.lineWidth = s * 0.02;
      g.beginPath(); g.moveTo(s * 0.02, -s * 1.2); g.lineTo(s * 0.02, -s * 0.58); g.stroke();
    } else if (style === 'fur') {
      g.fillStyle = F.shade(body, -0.25);
      for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(-s * 0.3 + i * s * 0.08, -s * 0.52 + (i % 2) * s * 0.03, s * 0.05, 0, TAU); g.fill(); }
    } else if (robe) {
      g.fillStyle = F.shade(body, -0.3);
      g.fillRect(-s * 0.05, -s * 1.2, s * 0.1, s * 1.1);
    }
    if (trim) { g.strokeStyle = trim; g.lineWidth = s * 0.04; g.beginPath(); g.moveTo(-s * 0.4, robe ? -s * 0.16 : -s * 0.53); g.lineTo(s * 0.4, robe ? -s * 0.16 : -s * 0.53); g.stroke(); }
    g.restore();
    if (style === 'fur') for (let i = 0; i < 6; i++) ball(g, -s * 0.24 + i * s * 0.1, -s * 1.17 + Math.abs(i - 2.5) * s * 0.01, s * 0.075, '#e8d8b8', false);
    // belt and buckle
    F.rrect(g, -s * 0.26, -s * 0.66, s * 0.52, s * 0.08, s * 0.02);
    g.fillStyle = side(g, -s * 0.26, s * 0.26, '#4a2e1c'); g.fill();
    F.rrect(g, s * 0.02, -s * 0.675, s * 0.1, s * 0.1, s * 0.02);
    g.fillStyle = trim || '#c8a050'; g.fill();
    if ((arm && arm.tier >= 5) || rank >= 3) { ball(g, 0, -s * 0.98, s * 0.06, rank >= 3 ? '#ff5a7a' : '#7fe8ff'); glowAt(g, 0, -s * 0.98, s * 0.3, rank >= 3 ? '#ff5a7a' : '#7fe8ff', 0.6); }
    // the head
    limb(g, 0, -s * 1.2, 0, -s * 1.28, s * 0.12, F.shade(SKIN, -0.15));
    const hx = s * 0.02, hy = -s * 1.48, hr = s * 0.26;
    ball(g, hx, hy, hr, SKIN, false);
    g.fillStyle = 'rgba(255,120,120,.28)';
    g.beginPath(); g.ellipse(hx + hr * 0.45, hy + hr * 0.3, hr * 0.18, hr * 0.11, 0, 0, TAU); g.fill();
    // eye: big and bright; squints when hurt, beams when cheering
    const ex = hx + hr * 0.42, ey = hy - hr * 0.05;
    if (pose.squint) {
      g.strokeStyle = '#2a1c14'; g.lineWidth = s * 0.03; g.lineCap = 'round';
      g.beginPath(); g.moveTo(ex - hr * 0.14, ey - hr * 0.1); g.lineTo(ex + hr * 0.06, ey); g.lineTo(ex - hr * 0.14, ey + hr * 0.1); g.stroke();
    } else {
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(ex, ey, hr * 0.17, hr * 0.22, 0, 0, TAU); g.fill();
      g.fillStyle = '#2a1c30'; g.beginPath(); g.ellipse(ex + hr * 0.05, ey + hr * 0.02, hr * 0.11, hr * 0.15, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ex + hr * 0.01, ey - hr * 0.06, hr * 0.05, 0, TAU); g.fill();
    }
    g.strokeStyle = '#3a2418'; g.lineWidth = s * 0.03; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ex - hr * 0.2, ey - hr * 0.34); g.lineTo(ex + hr * 0.18, ey - hr * 0.26); g.stroke();
    g.beginPath();
    if (pose.cheer) { g.fillStyle = '#7a2a2a'; g.arc(hx + hr * 0.5, hy + hr * 0.45, hr * 0.14, 0, Math.PI); g.fill(); }
    else { g.moveTo(hx + hr * 0.38, hy + hr * 0.5); g.lineTo(hx + hr * 0.6, hy + hr * 0.46); g.stroke(); }
    // hair or helmet
    if (rank === 0) {
      g.fillStyle = side(g, hx - hr, hx + hr, '#6b4428');
      g.beginPath();
      g.arc(hx, hy, hr * 1.04, Math.PI * 0.95, Math.PI * 1.9);
      g.lineTo(hx + hr * 0.7, hy - hr * 0.45); g.lineTo(hx + hr * 0.35, hy - hr * 0.6); g.lineTo(hx + hr * 0.1, hy - hr * 0.35);
      g.lineTo(hx - hr * 0.3, hy - hr * 0.2); g.lineTo(hx - hr * 0.55, hy + hr * 0.35); g.lineTo(hx - hr * 1.0, hy + hr * 0.25);
      g.closePath(); g.fill();
      g.strokeStyle = '#b8323a'; g.lineWidth = s * 0.05;
      g.beginPath(); g.arc(hx, hy, hr * 1.0, Math.PI * 1.02, Math.PI * 1.75); g.stroke();
    } else {
      const metal = rank >= 3 ? '#ffcf4d' : '#b9c3d0';
      g.save();
      g.beginPath(); g.arc(hx, hy - hr * 0.05, hr * 1.1, Math.PI, 0); g.lineTo(hx + hr * 1.1, hy + hr * 0.05); g.lineTo(hx - hr * 1.1, hy + hr * 0.05); g.closePath();
      g.clip();
      ball(g, hx, hy - hr * 0.05, hr * 1.1, metal, true);
      g.restore();
      F.metalBar(g, hx - hr * 1.12, hy - hr * 0.02, hx + hr * 1.12, hy - hr * 0.02, hr * 0.22, F.shade(metal, -0.1));
      F.metalBar(g, hx + hr * 0.75, hy - hr * 0.05, hx + hr * 0.78, hy + hr * 0.42, hr * 0.14, metal);
      g.fillStyle = F.shade(metal, -0.5);
      for (const rx of [-0.6, -0.1]) { g.beginPath(); g.arc(hx + hr * rx, hy - hr * 0.02, hr * 0.06, 0, TAU); g.fill(); }
      if (rank >= 2) { // a plume streaming back
        const pw = Math.sin(time * 5) * hr * 0.12 - (pose.kick || 0) * hr * 0.3;
        g.fillStyle = side(g, hx - hr * 1.5, hx, rank >= 3 ? '#ffffff' : '#d6324f');
        g.beginPath(); g.moveTo(hx + hr * 0.1, hy - hr * 1.1);
        g.bezierCurveTo(hx - hr * 0.4, hy - hr * 1.7 + pw, hx - hr * 1.3, hy - hr * 1.1 + pw, hx - hr * 1.5, hy - hr * 0.4 + pw);
        g.bezierCurveTo(hx - hr * 1.0, hy - hr * 0.8, hx - hr * 0.5, hy - hr * 0.95, hx - hr * 0.1, hy - hr * 0.95);
        g.closePath(); g.fill();
      }
      if (rank >= 3) { // golden wings on the helm
        for (const k of [1, 0.6]) {
          g.fillStyle = side(g, hx - hr * 1.6, hx - hr * 0.6, k === 1 ? '#fffbe8' : '#ffe9a0');
          g.beginPath(); g.moveTo(hx - hr * 0.75, hy - hr * 0.3);
          g.quadraticCurveTo(hx - hr * 1.3, hy - hr * (1.1 + k * 0.3), hx - hr * (1.5 + k * 0.2), hy - hr * (1.2 + k * 0.4));
          g.quadraticCurveTo(hx - hr * 1.2, hy - hr * 0.6, hx - hr * 0.7, hy - hr * 0.05);
          g.closePath(); g.fill();
        }
        glowAt(g, hx, hy - hr * 0.6, hr * 2.2, '#ffe066', 0.35);
      }
    }
    // the front arm swings the weapon from the shoulder
    const sh = { x: s * 0.13, y: -s * 1.08 };
    const aa = 1.75 + (pose.aw - REST) * 0.8;
    const hand = { x: sh.x + Math.sin(aa) * s * 0.36, y: sh.y - Math.cos(aa) * s * 0.36 };
    const sleeve = heavy ? body : style === 'robe' ? body : '#7a5a3c';
    if (pose.aw < 0) paintWeapon(g, hand.x, hand.y, s, look.weapon, pose.aw + pose.spin, pose.emit);
    limb(g, sh.x, sh.y, hand.x, hand.y, s * 0.13, sleeve);
    if (pose.aw >= 0) paintWeapon(g, hand.x, hand.y, s, look.weapon, pose.aw + pose.spin, pose.emit);
    ball(g, hand.x, hand.y, s * 0.08, heavy && arm.tier >= 3 ? F.shade(body, -0.1) : '#5a3a26', false);
    if (heavy || rank >= 2) { // pauldrons
      const pc = rank >= 3 ? '#ffcf4d' : heavy ? body : '#9aa4ad';
      ball(g, -s * 0.2, -s * 1.13, s * 0.14, F.shade(pc, -0.2));
      ball(g, sh.x, sh.y - s * 0.03, s * 0.16, pc);
      if (trim) { g.strokeStyle = trim; g.lineWidth = s * 0.025; g.beginPath(); g.arc(sh.x, sh.y - s * 0.03, s * 0.15, 0.2, Math.PI - 0.2); g.stroke(); }
    }
    return hand;
  }

  // The hero's pose this frame: wind-up from the battle's own attack timer, the swing after a blow, recoil.
  function heroPose(b, alive) {
    const s = 1;
    let aw, lean = 0, sx = 1, sy = 1, dx = 0, kick = 0, cheer = false, squint = false;
    const idle = Math.sin(time * 2.2) * 0.07;
    if (fx.outcome === 'win') {
      const k = ease.outBack(clamp01(fx.outT * 3));
      aw = lerp(REST, -0.25, k) + Math.sin(time * 6) * 0.05 * k;
      sy = 1 + 0.04 * Math.sin(time * 8) * k;
      cheer = true;
    } else if (fx.heroAtk > 0) {
      const p = 1 - fx.heroAtk / SWING;
      if (p < 0.22) { const q = ease.outCubic(p / 0.22); aw = lerp(BACK, END, q); dx = 0.34 * q; sx = 1 + 0.08 * q; sy = 1 - 0.05 * q; lean = 0.12 * q; kick = q; }
      else { const q = ease.inOutQuad((p - 0.22) / 0.78); aw = lerp(END, REST, q); dx = 0.34 * (1 - q); lean = 0.12 * (1 - q); kick = 1 - q; }
    } else {
      let wind = 0;
      if (b && alive && screen === 'battle' && !paused && b.swapT <= 0 && fx.enter <= 0) wind = clamp01(1 - b.heroTimer / WIND);
      const q = ease.outCubic(wind);
      aw = lerp(REST + idle, BACK, q);
      lean = -0.12 * q; sy = 1 - 0.07 * q; sx = 1 + 0.05 * q; dx = -0.08 * q;
    }
    if (fx.heroHurt > 0) { const q = fx.heroHurt / 0.28; dx -= 0.25 * q * q; lean -= 0.16 * q; squint = q > 0.3; }
    if (fx.heroDodge > 0) { const q = ease.pulse(1 - fx.heroDodge / 0.32); dx -= 0.45 * q; sy *= 1 - 0.06 * q; }
    const spin = fx.swap > 0 ? ease.inOutCubic(1 - fx.swap / C.SWAP_TIME) * TAU * 2 : 0;
    return { aw, lean, sx, sy, dx: dx * s, kick, cheer, squint, spin, emit: true };
  }

  // The hero with feet at (x, y): aura, contact shadow, the figure, the swing smear.
  function drawHero(x, y, s, look, pose, o = {}) {
    const rank = rankOf(look);
    const px = x + pose.dx * s;
    if (look.aura && !o.small) {
      const pul = 0.5 + 0.5 * Math.sin(time * 3);
      F.glow(ctx, px, y - s * 0.9, s * 1.6, '#ffd34d', (0.28 + 0.12 * pul) * (o.alpha == null ? 1 : o.alpha));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = F.withAlpha('#ffe066', 0.45 + 0.2 * pul);
      ctx.lineWidth = 2;
      ctx.setLineDash([s * 0.18, s * 0.12]);
      ctx.lineDashOffset = -time * s * 0.6;
      ctx.beginPath(); ctx.ellipse(px, y, s * 0.7, s * 0.17, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      if (Math.random() < 0.25) parts.emit({ x: px + (Math.random() - 0.5) * s, y: y - Math.random() * s * 0.3, vy: -40 - Math.random() * 30, vx: 0, shape: 'dot', size: 1.5, life: 0.9, color: '#fff3b0' });
    } else if (rank >= 1 && !o.small) {
      F.glow(ctx, px, y - s * 0.9, s * 1.1, rank >= 2 ? '#ff8fb0' : '#9fd0ff', 0.12);
    }
    F.shadow(ctx, px, y + 1, s * 0.52 * (o.alpha == null ? 1 : 1), s * 0.13, 0.5 * (o.alpha == null ? 1 : o.alpha));
    let hand = null;
    sprite(px, y, s * 2.0, { flash: o.flash || 0, flashColor: o.flashColor, dissolve: o.dissolve || 0, burn: '#ffcf7a', alpha: o.alpha }, (g) => {
      LS = -1;
      hand = paintHero(g, s, look, pose);
    });
    // the swing smear: a crescent of light along the weapon's path, brightest at the blade
    if (!o.small && look.weapon && fx.heroAtk > 0) {
      const p = 1 - fx.heroAtk / SWING;
      const fade = p < 0.22 ? 1 : 1 - (p - 0.22) / 0.4;
      if (fade > 0) {
        const L = s * (0.9 + look.weapon.tier * 0.03) * (look.weapon.shape === 'spear' ? 1.6 : look.weapon.shape === 'staff' ? 1.3 : look.weapon.shape === 'dagger' ? 0.6 : 1);
        const a1 = Math.min(pose.aw, END), a0 = Math.max(BACK, a1 - 2.6);
        const at = (aw, r) => {
          const aa = 1.75 + (aw - REST) * 0.8;
          const hx = s * 0.13 + Math.sin(aa) * s * 0.36, hy = -s * 1.08 - Math.cos(aa) * s * 0.36;
          return { x: hx + Math.sin(aw) * r, y: hy - Math.cos(aw) * r };
        };
        const col = look.weapon.color;
        ctx.save();
        ctx.translate(px, y);
        ctx.rotate(pose.lean);
        ctx.scale(pose.sx, pose.sy);
        ctx.globalCompositeOperation = 'lighter';
        const N = 10;
        for (let i = 0; i < N; i++) {
          const u0 = i / N, u1 = (i + 1) / N;
          const b0 = lerp(a0, a1, u0), b1 = lerp(a0, a1, u1);
          const o0 = at(b0, L * 1.02), o1 = at(b1, L * 1.02), i0 = at(b0, L * (0.85 - 0.5 * u0)), i1 = at(b1, L * (0.85 - 0.5 * u1));
          ctx.fillStyle = F.withAlpha(i > N - 3 ? '#ffffff' : col, 0.55 * u1 * fade);
          ctx.beginPath(); ctx.moveTo(i0.x, i0.y); ctx.lineTo(o0.x, o0.y); ctx.lineTo(o1.x, o1.y); ctx.lineTo(i1.x, i1.y); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }
    return hand;
  }

  // ───────────── Drawing: enemies ─────────────
  // Painted facing +x (towards the hero once mirrored), feet at (0, 0), lit from +x after the mirror.
  const FOES = {
    wolf(g, s, e, p) { wolf(g, s, p, '#6e665a', '#c9b89a', '#ffd34d', false); },
    wolf_king(g, s, e, p) { wolf(g, s, p, '#8d95a8', '#e8eef8', '#ff5a3a', true); },
    bandit(g, s, e, p) {
      const cloak = '#5a4a6a';
      legs(g, s, '#2b2230', '#3a2618');
      limb(g, -s * 0.16, -s * 1.05, -s * 0.3, -s * 0.72, s * 0.12, F.shade(cloak, -0.25));
      F.metalBar(g, -s * 0.3, -s * 0.72, -s * 0.12, -s * 0.5, s * 0.05, '#c9d1dc');
      g.beginPath(); g.moveTo(-s * 0.26, -s * 1.15); g.quadraticCurveTo(0, -s * 1.3, s * 0.26, -s * 1.15); g.lineTo(s * 0.3, -s * 0.42); g.lineTo(-s * 0.34, -s * 0.4); g.closePath();
      g.fillStyle = side(g, -s * 0.3, s * 0.3, cloak); g.fill();
      g.fillStyle = '#3a2a1a'; g.fillRect(-s * 0.3, -s * 0.66, s * 0.6, s * 0.07);
      const sw = Math.sin(time * 4) * s * 0.04;
      g.fillStyle = '#8a2a3a'; g.beginPath(); g.moveTo(-s * 0.1, -s * 1.18); g.quadraticCurveTo(-s * 0.4, -s * 1.15 + sw, -s * 0.55, -s * 1.0 + sw); g.lineTo(-s * 0.1, -s * 1.08); g.closePath(); g.fill();
      ball(g, 0, -s * 1.42, s * 0.23, '#d9b48f', false);
      g.fillStyle = side(g, -s * 0.28, s * 0.28, '#3a2f48');
      g.beginPath(); g.arc(0, -s * 1.45, s * 0.28, Math.PI * 0.85, Math.PI * 2.1); g.lineTo(s * 0.1, -s * 1.42); g.lineTo(-s * 0.12, -s * 1.2); g.closePath(); g.fill();
      g.fillStyle = '#20182a'; g.fillRect(s * 0.0, -s * 1.38, s * 0.24, s * 0.12);
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(s * 0.15, -s * 1.47, s * 0.035, 0, TAU); g.fill();
      limb(g, s * 0.14, -s * 1.05, s * 0.32 + p.reach * s * 0.2, -s * 0.8, s * 0.12, cloak);
      F.metalBar(g, s * 0.32 + p.reach * s * 0.2, -s * 0.8, s * 0.6 + p.reach * s * 0.3, -s * 1.0, s * 0.06, '#d8dee8');
    },
    slime(g, s, e, p) {
      const sq = 1 + Math.sin(time * 5 + e.uid) * 0.08 + p.wind * 0.12;
      const rx = s * 0.5 / sq, ry = s * 0.42 * sq;
      g.save();
      g.beginPath(); g.ellipse(0, 0, rx, ry * 2, 0, Math.PI, 0); g.closePath();
      const gr = g.createRadialGradient(s * 0.15, -ry * 1.3, s * 0.05, 0, -ry * 0.6, s * 0.7);
      gr.addColorStop(0, '#d8ffb0'); gr.addColorStop(0.35, 'rgba(110,210,90,.92)'); gr.addColorStop(1, 'rgba(30,110,50,.95)');
      g.fillStyle = gr; g.fill();
      g.clip();
      g.fillStyle = 'rgba(30,90,40,.35)';
      for (const [bx, by, br] of [[-0.2, 0.3, 0.08], [0.05, 0.15, 0.05], [-0.05, 0.45, 0.06]]) { g.beginPath(); g.arc(bx * s, -by * s * sq, br * s, 0, TAU); g.fill(); }
      g.restore();
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.beginPath(); g.ellipse(s * 0.2, -ry * 1.45, rx * 0.25, ry * 0.18, -0.5, 0, TAU); g.fill();
      for (const ex of [0.08, 0.27]) {
        g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(ex * s, -ry * 1.05, s * 0.06, s * 0.08, 0, 0, TAU); g.fill();
        g.fillStyle = '#132a10'; g.beginPath(); g.arc(ex * s + s * 0.02, -ry * 1.02, s * 0.035, 0, TAU); g.fill();
      }
      g.strokeStyle = '#1a3a14'; g.lineWidth = s * 0.03;
      g.beginPath(); g.arc(s * 0.18, -ry * 0.8, s * 0.07, 0.2, Math.PI - 0.2); g.stroke();
    },
    skeleton(g, s, e, p) { skeleton(g, s, e, p, false); },
    bone_lord(g, s, e, p) { skeleton(g, s, e, p, true); },
    ghost(g, s, e, p) {
      const hover = -s * 0.25 + Math.sin(time * 2.5 + e.uid) * s * 0.06;
      g.translate(0, hover);
      g.globalAlpha = 0.85;
      const gr = g.createLinearGradient(0, -s * 1.5, 0, -s * 0.1);
      gr.addColorStop(0, '#eaf4ff'); gr.addColorStop(0.55, 'rgba(170,205,255,.85)'); gr.addColorStop(1, 'rgba(120,160,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, -s * 1.15, s * 0.36, Math.PI, 0);
      for (let k = 0; k <= 6; k++) g.lineTo(s * 0.36 - k * s * 0.12, -s * 0.2 + (k % 2) * s * 0.14 + Math.sin(time * 5 + k) * s * 0.05);
      g.closePath(); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.ellipse(s * 0.12, -s * 1.32, s * 0.1, s * 0.06, -0.4, 0, TAU); g.fill();
      g.fillStyle = '#1a2440';
      for (const ex of [0.02, 0.2]) { g.beginPath(); g.ellipse(ex * s, -s * 1.15, s * 0.06, s * 0.09, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#9fe6ff';
      for (const ex of [0.03, 0.21]) { g.beginPath(); g.arc(ex * s, -s * 1.13, s * 0.025, 0, TAU); g.fill(); glowAt(g, ex * s, -s * 1.13, s * 0.18, '#7fd8ff', 0.8); }
      g.beginPath(); g.ellipse(s * 0.12, -s * 0.95, s * 0.05, s * 0.07 + p.wind * s * 0.05, 0, 0, TAU); g.fillStyle = '#1a2440'; g.fill();
      glowAt(g, 0, -s * 0.9, s * 0.9, '#9fc8ff', 0.35);
    },
    troll(g, s, e, p) {
      const skin = '#6a8a4a';
      limb(g, -s * 0.18, -s * 0.5, -s * 0.22, -s * 0.08, s * 0.2, F.shade(skin, -0.25));
      limb(g, s * 0.16, -s * 0.5, s * 0.2, -s * 0.08, s * 0.2, skin);
      oval(g, -s * 0.2, -s * 0.06, s * 0.16, s * 0.08, F.shade(skin, -0.35));
      oval(g, s * 0.22, -s * 0.06, s * 0.17, s * 0.08, F.shade(skin, -0.2));
      limb(g, -s * 0.3, -s * 1.15, -s * 0.48, -s * 0.6, s * 0.17, F.shade(skin, -0.3));
      oval(g, 0, -s * 0.9, s * 0.48, s * 0.55, skin, true);
      oval(g, s * 0.1, -s * 0.72, s * 0.3, s * 0.3, F.mix(skin, '#d8d8a0', 0.35));
      g.fillStyle = '#5a3a24'; g.fillRect(-s * 0.46, -s * 0.62, s * 0.92, s * 0.12);
      ball(g, s * 0.22, -s * 1.42, s * 0.22, skin, false);
      g.fillStyle = '#3a4a2a'; g.beginPath(); g.arc(s * 0.15, -s * 1.6, s * 0.16, Math.PI, TAU); g.fill();
      poly(g, '#f2ead0', [s * 0.33, -s * 1.3, s * 0.38, -s * 1.46, s * 0.42, -s * 1.3]);
      g.fillStyle = '#ffeb8a'; g.beginPath(); g.arc(s * 0.3, -s * 1.46, s * 0.035, 0, TAU); g.fill();
      glowAt(g, s * 0.3, -s * 1.46, s * 0.12, '#ffeb8a', 0.6);
      const club = -0.4 - p.wind * 1.2 + p.reach * 1.9;
      g.save(); g.translate(s * 0.42, -s * 0.85); g.rotate(club);
      limb(g, 0, s * 0.1, 0, -s * 0.5, s * 0.1, WOOD);
      oval(g, 0, -s * 0.72, s * 0.15, s * 0.3, '#6b4a2c');
      for (const [kx, ky] of [[-0.14, -0.6], [0.14, -0.75], [-0.1, -0.88]]) poly(g, '#d8d8d0', [kx * s, ky * s, kx * s * 1.9, ky * s - s * 0.03, kx * s, ky * s - s * 0.07]);
      g.restore();
      limb(g, s * 0.3, -s * 1.15, s * 0.42, -s * 0.85, s * 0.17, skin);
    },
    imp(g, s, e, p) {
      const hover = -s * 0.35 + Math.sin(time * 6 + e.uid) * s * 0.06;
      g.translate(0, hover);
      const flap = Math.sin(time * 16) * s * 0.18;
      for (const k of [-1, 1]) {
        g.fillStyle = side(g, -s * 0.6, 0, k < 0 ? '#5a1410' : '#8a1f14');
        g.beginPath(); g.moveTo(-s * 0.05, -s * 0.9);
        g.lineTo(-s * 0.62, -s * 1.15 - flap * (k < 0 ? 0.7 : 1)); g.lineTo(-s * 0.5, -s * 0.85 - flap * 0.3); g.lineTo(-s * 0.55, -s * 0.7); g.lineTo(-s * 0.15, -s * 0.72);
        g.closePath(); g.fill();
      }
      g.strokeStyle = '#d6402a'; g.lineWidth = s * 0.04;
      g.beginPath(); g.moveTo(-s * 0.1, -s * 0.5); g.quadraticCurveTo(-s * 0.5, -s * 0.3, -s * 0.45, -s * 0.7); g.stroke();
      poly(g, '#ffb347', [-s * 0.45, -s * 0.82, -s * 0.38, -s * 0.66, -s * 0.52, -s * 0.66]);
      glowAt(g, -s * 0.45, -s * 0.72, s * 0.25, '#ff8a3d', 0.7);
      limb(g, -s * 0.05, -s * 0.5, -s * 0.08, -s * 0.25, s * 0.08, '#a82a1a');
      limb(g, s * 0.07, -s * 0.5, s * 0.1, -s * 0.25, s * 0.08, '#c8341f');
      oval(g, 0, -s * 0.72, s * 0.22, s * 0.28, '#d6402a', true);
      ball(g, s * 0.03, -s * 1.1, s * 0.19, '#e04a30', false);
      poly(g, '#3a1410', [-s * 0.08, -s * 1.22, -s * 0.18, -s * 1.46, -s * 0.0, -s * 1.27]);
      poly(g, '#3a1410', [s * 0.1, -s * 1.24, s * 0.16, -s * 1.48, s * 0.2, -s * 1.22]);
      g.fillStyle = '#ffe066'; g.beginPath(); g.ellipse(s * 0.12, -s * 1.12, s * 0.05, s * 0.035, 0, 0, TAU); g.fill();
      glowAt(g, s * 0.12, -s * 1.12, s * 0.15, '#ffd34d', 0.8);
      g.strokeStyle = '#3a1410'; g.lineWidth = s * 0.025; g.beginPath(); g.arc(s * 0.08, -s * 1.02, s * 0.07, 0.1, Math.PI * 0.8); g.stroke();
      ball(g, s * 0.25 + p.reach * s * 0.2, -s * 0.78, s * 0.07, '#e04a30', false);
      if (p.wind > 0.2) { ball(g, s * 0.3, -s * 0.85, s * 0.08 * p.wind, '#ffd27a', false); glowAt(g, s * 0.3, -s * 0.85, s * 0.35 * p.wind, '#ff8a3d', 0.9); }
    },
    golem(g, s, e, p) {
      const rock = '#4a3a34', lava = `rgba(255,${130 + 60 * Math.sin(time * 3)},50,.95)`;
      g.save(); LS = -LS;
      F.block(g, -s * 0.42, -s * 0.45, s * 0.3, s * 0.45, s * 0.06, F.shade(rock, -0.2));
      F.block(g, s * 0.12, -s * 0.45, s * 0.3, s * 0.45, s * 0.06, rock);
      F.block(g, -s * 0.62, -s * 1.3, s * 0.26, s * 0.6, s * 0.1, F.shade(rock, -0.3));
      F.block(g, -s * 0.48, -s * 1.55, s * 0.96, s * 1.15, s * 0.16, rock, { gloss: true });
      F.block(g, -s * 0.18, -s * 1.85, s * 0.42, s * 0.34, s * 0.08, F.shade(rock, 0.05));
      LS = -LS; g.restore();
      g.strokeStyle = lava; g.lineWidth = s * 0.04; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(-s * 0.3, -s * 1.4); g.lineTo(-s * 0.05, -s * 1.05); g.lineTo(-s * 0.22, -s * 0.72); g.moveTo(s * 0.25, -s * 1.45); g.lineTo(s * 0.1, -s * 0.95); g.lineTo(s * 0.3, -s * 0.6); g.stroke();
      glowAt(g, -s * 0.08, -s * 1.0, s * 0.6, '#ff7a2a', 0.55);
      g.fillStyle = '#ffd27a'; g.fillRect(s * 0.08, -s * 1.73, s * 0.12, s * 0.06);
      glowAt(g, s * 0.14, -s * 1.7, s * 0.25, '#ffb347', 0.9);
      const fist = p.reach * s * 0.35 - p.wind * s * 0.1;
      g.save(); LS = -LS;
      F.block(g, s * 0.36 + fist * 0.5, -s * 1.3, s * 0.28, s * 0.62, s * 0.1, F.shade(rock, 0.05));
      F.block(g, s * 0.34 + fist, -s * 0.8, s * 0.36, s * 0.32, s * 0.1, F.shade(rock, 0.1));
      LS = -LS; g.restore();
    },
    knight(g, s, e, p) {
      const steel = '#3c404c';
      legs(g, s, steel, '#24262e');
      limb(g, -s * 0.18, -s * 1.05, -s * 0.24, -s * 0.7, s * 0.13, F.shade(steel, -0.3));
      g.beginPath(); g.moveTo(-s * 0.27, -s * 1.18); g.quadraticCurveTo(0, -s * 1.3, s * 0.27, -s * 1.18); g.lineTo(s * 0.23, -s * 0.48); g.lineTo(-s * 0.25, -s * 0.48); g.closePath();
      g.fillStyle = side(g, -s * 0.3, s * 0.3, steel, 1.4); g.fill();
      g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.ellipse(s * 0.1, -s * 0.98, s * 0.07, s * 0.15, -0.25, 0, TAU); g.fill();
      g.fillStyle = '#7a1420'; g.fillRect(-s * 0.25, -s * 0.66, s * 0.48, s * 0.07);
      ball(g, 0, -s * 1.44, s * 0.24, steel);
      g.fillStyle = '#14141a'; g.fillRect(s * 0.02, -s * 1.5, s * 0.24, s * 0.06);
      g.fillStyle = '#ff3b3b'; g.fillRect(s * 0.08, -s * 1.49, s * 0.16, s * 0.035);
      glowAt(g, s * 0.16, -s * 1.47, s * 0.2, '#ff3b3b', 0.8);
      g.fillStyle = '#b3203a'; g.beginPath(); g.moveTo(-s * 0.02, -s * 1.66); g.quadraticCurveTo(-s * 0.4, -s * 1.8, -s * 0.5, -s * 1.4); g.quadraticCurveTo(-s * 0.3, -s * 1.6, -s * 0.05, -s * 1.58); g.fill();
      ball(g, s * 0.2, -s * 1.12, s * 0.15, steel);
      const sw = -0.3 - p.wind * 1.1 + p.reach * 2.0;
      g.save(); g.translate(s * 0.34, -s * 0.85); g.rotate(sw);
      F.metalBar(g, 0, 0, 0, -s * 0.95, s * 0.08, '#c9d1dc');
      F.metalBar(g, -s * 0.12, 0, s * 0.12, 0, s * 0.05, '#8a7a5a');
      g.restore();
      shieldFront(g, s, e, s * 0.36, -s * 0.85, true);
    },
    ash_lord(g, s, e, p) {
      const ph = e.phase || 0;
      const body = ph === 0 ? '#5d6370' : ph === 1 ? '#3a1a10' : '#2a1838';
      const trimC = ph === 2 ? '#c9a8ff' : '#ffd34d';
      if (ph === 2) g.globalAlpha = 0.9;
      legs(g, s, F.shade(body, -0.1), F.shade(body, -0.35));
      // a cloak behind
      g.fillStyle = side(g, -s * 0.7, 0, ph === 1 ? '#5a1a0a' : ph === 2 ? '#1a0e26' : '#3a2030');
      const wv = Math.sin(time * 2.5) * s * 0.06;
      g.beginPath(); g.moveTo(-s * 0.25, -s * 1.3); g.quadraticCurveTo(-s * 0.6, -s * 0.8, -s * 0.7 - wv, -s * 0.05); g.lineTo(-s * 0.1, -s * 0.1); g.closePath(); g.fill();
      limb(g, -s * 0.24, -s * 1.2, -s * 0.36, -s * 0.75, s * 0.15, F.shade(body, -0.3));
      g.beginPath(); g.moveTo(-s * 0.34, -s * 1.32); g.quadraticCurveTo(0, -s * 1.44, s * 0.34, -s * 1.32); g.lineTo(s * 0.28, -s * 0.45); g.lineTo(-s * 0.3, -s * 0.45); g.closePath();
      g.fillStyle = side(g, -s * 0.36, s * 0.36, body, 1.3); g.fill();
      g.strokeStyle = trimC; g.lineWidth = s * 0.03; g.stroke();
      if (ph === 1) { // molten cracks
        g.strokeStyle = `rgba(255,${150 + 60 * Math.sin(time * 5)},60,.95)`; g.lineWidth = s * 0.035;
        g.beginPath(); g.moveTo(-s * 0.2, -s * 1.25); g.lineTo(0, -s * 0.95); g.lineTo(-s * 0.12, -s * 0.6); g.moveTo(s * 0.2, -s * 1.2); g.lineTo(s * 0.08, -s * 0.85); g.stroke();
        glowAt(g, 0, -s * 0.95, s * 0.9, '#ff7a2a', 0.65);
      }
      if (ph === 2) glowAt(g, 0, -s * 1.0, s * 1.1, '#9a6aff', 0.5);
      g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.ellipse(s * 0.12, -s * 1.08, s * 0.08, s * 0.18, -0.2, 0, TAU); g.fill();
      ball(g, 0, -s * 1.6, s * 0.22, ph === 2 ? '#3a2650' : F.shade(body, 0.05));
      g.fillStyle = '#0c0812'; g.fillRect(s * 0.0, -s * 1.66, s * 0.22, s * 0.07);
      const eye = ph === 1 ? '#fff3b0' : ph === 2 ? '#e8d8ff' : '#ff3b3b';
      g.fillStyle = eye; g.fillRect(s * 0.06, -s * 1.65, s * 0.14, s * 0.04);
      glowAt(g, s * 0.13, -s * 1.63, s * 0.3, eye, 0.9);
      // horned crown
      poly(g, trimC, [-s * 0.22, -s * 1.74, -s * 0.16, -s * 2.0, -s * 0.06, -s * 1.78, 0, -s * 2.08, s * 0.06, -s * 1.78, s * 0.16, -s * 2.0, s * 0.22, -s * 1.74]);
      limb(g, -s * 0.2, -s * 1.76, -s * 0.42, -s * 1.95, s * 0.06, '#e8e0d0');
      limb(g, s * 0.18, -s * 1.76, s * 0.36, -s * 1.98, s * 0.06, '#e8e0d0');
      for (const k of [-1, 1]) ball(g, k * s * 0.3, -s * 1.3, s * 0.17, F.shade(body, 0.1));
      if (ph === 1 && Math.random() < 0.5) { const q = worldOf(g, (Math.random() - 0.5) * s * 0.7, -s * 1.35); parts.emit({ x: q.x, y: q.y, vx: (Math.random() - 0.5) * 20, vy: -60 - Math.random() * 40, shape: 'dot', size: 2, life: 0.7, color: Math.random() < 0.5 ? '#ffb347' : '#ff6a2a' }); }
      if (ph === 2 && Math.random() < 0.4) { const q = worldOf(g, (Math.random() - 0.5) * s * 0.8, -s * (0.3 + Math.random())); parts.emit({ x: q.x, y: q.y, vx: (Math.random() - 0.5) * 10, vy: -30, shape: 'smoke', size: 4, grow: 10, life: 0.9, color: '#3a2258', alpha: 0.6 }); }
      // the great sword
      const sw = -0.25 - p.wind * 1.2 + p.reach * 2.1;
      g.save(); g.translate(s * 0.4, -s * 0.9); g.rotate(sw);
      const bl = ph === 0 ? '#c9d1dc' : ph === 1 ? '#ff9a4a' : '#a77bff';
      F.metalBar(g, 0, -s * 0.05, 0, -s * 1.2, s * 0.13, bl);
      if (ph > 0) glowAt(g, 0, -s * 0.7, s * 0.6, bl, 0.6);
      F.metalBar(g, -s * 0.18, 0, s * 0.18, 0, s * 0.07, trimC);
      g.restore();
      limb(g, s * 0.26, -s * 1.2, s * 0.4, -s * 0.9, s * 0.15, body);
      g.globalAlpha = 1;
    },
  };

  function legs(g, s, c, boot) {
    limb(g, -s * 0.1, -s * 0.5, -s * 0.12, -s * 0.1, s * 0.14, F.shade(c, -0.2));
    limb(g, s * 0.1, -s * 0.5, s * 0.12, -s * 0.1, s * 0.14, c);
    oval(g, -s * 0.09, -s * 0.06, s * 0.12, s * 0.07, F.shade(boot, -0.2));
    oval(g, s * 0.15, -s * 0.06, s * 0.12, s * 0.07, boot, true);
  }

  function wolf(g, s, p, fur, belly, eye, king) {
    const open = Math.max(p.wind, p.reach);
    g.translate(p.reach * s * 0.25, 0);
    g.rotate(-p.wind * 0.12 + p.reach * 0.08);
    const wag = Math.sin(time * 6) * 0.15;
    g.save(); g.translate(-s * 0.45, -s * 0.52); g.rotate(-0.5 + wag);
    oval(g, -s * 0.18, 0, s * 0.24, s * 0.08, F.shade(fur, -0.1));
    g.restore();
    limb(g, -s * 0.3, -s * 0.4, -s * 0.34, -s * 0.03, s * 0.09, F.shade(fur, -0.35));
    limb(g, s * 0.26, -s * 0.4, s * 0.3, -s * 0.03, s * 0.09, F.shade(fur, -0.35));
    oval(g, 0, -s * 0.5, s * 0.5, s * 0.24, fur, true);
    oval(g, s * 0.28, -s * 0.42, s * 0.2, s * 0.17, belly);
    if (king) { g.fillStyle = side(g, -s * 0.1, s * 0.4, F.shade(fur, 0.25)); g.beginPath(); g.ellipse(s * 0.22, -s * 0.62, s * 0.24, s * 0.24, 0, 0, TAU); g.fill(); }
    limb(g, -s * 0.22, -s * 0.4, -s * 0.2, -s * 0.03, s * 0.1, F.shade(fur, -0.1));
    limb(g, s * 0.36, -s * 0.4, s * 0.38, -s * 0.03, s * 0.1, F.shade(fur, -0.1));
    // head
    g.save(); g.translate(s * 0.5, -s * 0.68); g.rotate(-open * 0.2);
    poly(g, F.shade(fur, -0.35), [-s * 0.08, -s * 0.1, -s * 0.03, -s * 0.32, s * 0.06, -s * 0.1]);
    oval(g, 0, 0, s * 0.2, s * 0.16, fur);
    oval(g, s * 0.18, s * 0.04 - open * s * 0.02, s * 0.14, s * 0.075, F.shade(fur, 0.1));
    if (open > 0.1) { oval(g, s * 0.16, s * 0.12, s * 0.12, s * 0.04 + open * s * 0.04, '#3a0e14'); poly(g, '#ffffff', [s * 0.2, s * 0.09, s * 0.23, s * 0.15, s * 0.26, s * 0.09]); }
    ball(g, s * 0.31, s * 0.02, s * 0.04, '#1a1418');
    g.fillStyle = eye; g.beginPath(); g.ellipse(s * 0.06, -s * 0.04, s * 0.045, s * 0.03, -0.2, 0, TAU); g.fill();
    glowAt(g, s * 0.06, -s * 0.04, s * 0.14, eye, 0.9);
    if (king) poly(g, '#ffd34d', [-s * 0.14, -s * 0.12, -s * 0.12, -s * 0.3, -s * 0.05, -s * 0.18, 0, -s * 0.34, s * 0.05, -s * 0.18, s * 0.1, -s * 0.28, s * 0.1, -s * 0.1]);
    g.restore();
  }

  function skeleton(g, s, e, p, lord) {
    const bone = '#e6dfcc';
    if (lord) {
      g.fillStyle = side(g, -s * 0.4, s * 0.4, '#4a2a5a');
      g.beginPath(); g.moveTo(-s * 0.26, -s * 1.2); g.lineTo(s * 0.26, -s * 1.2); g.lineTo(s * 0.4, -s * 0.02); g.lineTo(-s * 0.42, -s * 0.02); g.closePath(); g.fill();
      g.strokeStyle = '#ffd34d'; g.lineWidth = s * 0.03; g.beginPath(); g.moveTo(-s * 0.42, -s * 0.05); g.lineTo(s * 0.4, -s * 0.05); g.stroke();
    } else {
      limb(g, -s * 0.1, -s * 0.52, -s * 0.12, -s * 0.06, s * 0.06, F.shade(bone, -0.2));
      limb(g, s * 0.1, -s * 0.52, s * 0.12, -s * 0.06, s * 0.06, bone);
      ball(g, -s * 0.11, -s * 0.3, s * 0.045, bone, false); ball(g, s * 0.11, -s * 0.3, s * 0.045, bone, false);
      oval(g, s * 0.14, -s * 0.04, s * 0.1, s * 0.05, '#4a4450');
      oval(g, 0, -s * 0.55, s * 0.18, s * 0.07, bone);
    }
    limb(g, -s * 0.14, -s * 1.05, -s * 0.24, -s * 0.66, s * 0.06, F.shade(bone, -0.25));
    if (!lord) {
      limb(g, 0, -s * 1.2, 0, -s * 0.58, s * 0.06, bone);
      g.strokeStyle = bone; g.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        g.lineWidth = s * 0.05;
        g.beginPath(); g.ellipse(0, -s * (1.08 - k * 0.12), s * (0.2 - k * 0.02), s * 0.05, 0, Math.PI * 1.05, Math.PI * 1.95, true); g.stroke();
      }
    } else {
      for (const k of [-1, 1]) { ball(g, k * s * 0.26, -s * 1.15, s * 0.14, '#5a3a6a'); poly(g, bone, [k * s * 0.2, -s * 1.25, k * s * 0.3, -s * 1.5, k * s * 0.34, -s * 1.22]); }
    }
    // skull
    ball(g, 0, -s * 1.42, s * 0.21, bone);
    oval(g, s * 0.08, -s * 1.27, s * 0.11, s * 0.06, F.shade(bone, -0.1));
    g.fillStyle = '#1a1420';
    for (const ex of [-0.02, 0.13]) { g.beginPath(); g.ellipse(ex * s, -s * 1.45, s * 0.055, s * 0.065, 0, 0, TAU); g.fill(); }
    const eyeC = lord ? '#c9a8ff' : '#ff4a3a';
    for (const ex of [-0.01, 0.14]) { g.fillStyle = eyeC; g.beginPath(); g.arc(ex * s, -s * 1.45, s * 0.022, 0, TAU); g.fill(); glowAt(g, ex * s, -s * 1.45, s * 0.12, eyeC, 0.85); }
    if (lord) {
      poly(g, '#ffd34d', [-s * 0.2, -s * 1.56, -s * 0.15, -s * 1.8, -s * 0.05, -s * 1.62, s * 0.03, -s * 1.86, s * 0.1, -s * 1.62, s * 0.2, -s * 1.8, s * 0.22, -s * 1.56]);
      const st = -0.15 - p.wind * 0.6 + p.reach * 0.9;
      g.save(); g.translate(s * 0.36, -s * 0.8); g.rotate(st);
      limb(g, 0, s * 0.7, 0, -s * 0.8, s * 0.06, '#3a2a40');
      ball(g, 0, -s * 0.9, s * 0.12, '#a77bff');
      glowAt(g, 0, -s * 0.9, s * 0.6, '#9a6aff', 0.7 + 0.2 * Math.sin(time * 4));
      g.restore();
      limb(g, s * 0.14, -s * 1.05, s * 0.36, -s * 0.8, s * 0.07, bone);
    } else {
      const sw = -0.3 - p.wind * 1.1 + p.reach * 2.0;
      g.save(); g.translate(s * 0.3, -s * 0.8); g.rotate(sw);
      F.metalBar(g, 0, 0, 0, -s * 0.75, s * 0.07, '#a89a8a');
      F.metalBar(g, -s * 0.1, 0, s * 0.1, 0, s * 0.04, '#6a5a4a');
      g.restore();
      limb(g, s * 0.12, -s * 1.05, s * 0.3, -s * 0.8, s * 0.06, bone);
      shieldFront(g, s, e, s * 0.32, -s * 0.85, false);
    }
  }

  // A shield held in front: bright steel while it still has charges, dull and cracked once it is spent.
  function shieldFront(g, s, e, x, y, kite) {
    const up = e.shield > 0;
    const c = up ? '#8aa6c8' : '#4a4a55';
    g.save(); g.translate(x, y);
    g.beginPath();
    if (kite) { g.moveTo(0, -s * 0.32); g.quadraticCurveTo(s * 0.2, -s * 0.28, s * 0.18, 0); g.quadraticCurveTo(s * 0.14, s * 0.22, 0, s * 0.36); g.quadraticCurveTo(-s * 0.14, s * 0.22, -s * 0.18, 0); g.quadraticCurveTo(-s * 0.2, -s * 0.28, 0, -s * 0.32); }
    else g.ellipse(0, 0, s * 0.17, s * 0.26, 0, 0, TAU);
    g.fillStyle = side(g, -s * 0.2, s * 0.2, c, 1.3); g.fill();
    g.strokeStyle = up ? '#e8eef8' : '#2a2a30'; g.lineWidth = s * 0.03; g.stroke();
    if (up) {
      ball(g, 0, 0, s * 0.06, '#ffd34d');
      glowAt(g, 0, 0, s * 0.3, '#9fd0ff', 0.25);
    } else {
      g.strokeStyle = '#1a1a20'; g.lineWidth = s * 0.02;
      g.beginPath(); g.moveTo(-s * 0.05, -s * 0.2); g.lineTo(s * 0.03, -s * 0.02); g.lineTo(-s * 0.04, s * 0.15); g.stroke();
    }
    g.restore();
  }

  // An enemy's pose: wind-up from its own attack timer, the lunge after it strikes, knockback when hit.
  function foePose(e, b) {
    let wind = 0;
    if (b && !e.dead && screen === 'battle' && !paused && fx.enter <= 0 && !(e.pause > 0)) wind = clamp01(1 - e.timer / E_WIND);
    const atk = fx.eAtk[e.uid] > 0 ? 1 - fx.eAtk[e.uid] / E_ATK : 0;
    const reach = atk > 0 ? (atk < 0.25 ? ease.outCubic(atk / 0.25) : 1 - ease.inOutQuad((atk - 0.25) / 0.75)) : 0;
    return { wind: ease.outCubic(wind) * (1 - reach), reach };
  }

  function drawFoe(e, x, y, s0, b, o = {}) {
    const k = sizeOf(e), s = s0 * k;
    const p = o.pose || foePose(e, b);
    const kb = fx.kb[e.uid] || 0;
    const dodge = fx.dodge[e.uid] > 0 ? ease.pulse(1 - fx.dodge[e.uid] / 0.32) : 0;
    const flashT = fx.flash[e.uid] || 0;
    const fk = clamp01(flashT / 0.07) * (e.boss ? 0.75 : 1);
    const dx = kb * s * 0.3 - p.reach * s * 0.5 + p.wind * s * 0.08 + dodge * s * 0.5;
    const px = x + dx;
    const dying = o.dissolve > 0;
    // glows and marks on the ground
    if (e.boss) {
      const ph = e.phase || 0;
      const col = e.kind === 'ash_lord' ? (ph === 1 ? '#ff7a2a' : ph === 2 ? '#9a6aff' : '#ff6f91') : e.kind === 'bone_lord' ? '#9a6aff' : '#7fd8ff';
      F.glow(ctx, px, y - s * 0.8, s * 1.4, col, (0.22 + 0.08 * Math.sin(time * 3)) * (dying ? 1 - o.dissolve : 1));
    } else if (e.elite && !dying) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = F.withAlpha('#ff6f91', 0.45 + 0.2 * Math.sin(time * 4));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(px, y, s * 0.62, s * 0.15, 0, 0, TAU); ctx.stroke();
      ctx.restore();
      F.glow(ctx, px, y - s * 0.7, s * 1.1, '#ff6f91', 0.16);
    }
    if (e.thorns && !dying) {
      ctx.fillStyle = '#b83250';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + time * 0.4, ex = px + Math.cos(a) * s * 0.55, ey = y + Math.sin(a) * s * 0.13;
        ctx.beginPath(); ctx.moveTo(ex - 3, ey); ctx.lineTo(ex, ey - 8); ctx.lineTo(ex + 3, ey); ctx.fill();
      }
    }
    F.shadow(ctx, px, y + 1, s * 0.55, s * 0.13, 0.5 * (dying ? 1 - o.dissolve : 1));
    const slow = e.slowT > 0;
    const phaseFlash = e.boss && fx.phase > 0 ? fx.phase * 0.8 : 0;
    const flash = o.dissolve ? 0 : Math.max(fk, phaseFlash, slow ? 0.28 : 0);
    const flashColor = fk > 0 ? '#ffffff' : phaseFlash > 0 ? fx.phaseColor : '#9fe6ff';
    const sx = 1 - 0.12 * fk + p.wind * 0.04, sy = 1 + 0.08 * fk - p.wind * 0.05;
    sprite(px, y - (o.rise || 0), s * 2.0, { flash, flashColor, dissolve: o.dissolve || 0, burn: e.kind === 'ash_lord' || e.kind === 'golem' || e.kind === 'imp' ? '#ff9a3a' : e.kind === 'ghost' || e.kind === 'bone_lord' ? '#c9a8ff' : '#ffe6c0' }, (g) => {
      LS = 1;
      g.scale(-1, 1);
      g.rotate(-p.wind * 0.1 + p.reach * 0.08 - kb * 0.12);
      g.scale(sx, sy);
      g.translate(0, Math.sin(time * 3 + e.uid) * s * 0.012);
      (FOES[e.kind] || FOES.bandit)(g, s, e, p);
    });
    if (dying) return;
    // a shield barrier while it still has charges
    if (e.shield > 0 || fx.guard[e.uid] > 0) {
      const gk = fx.guard[e.uid] > 0 ? fx.guard[e.uid] / 0.4 : 0;
      const col = e.shield > 0 ? '#9fd0ff' : '#ff8a7a';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = F.withAlpha(col, 0.25 + 0.6 * gk);
      ctx.lineWidth = 1.5 + 2 * gk;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU + Math.PI / 6; const r = s * (0.95 + 0.1 * gk); const xx = px - s * 0.05 + Math.cos(a) * r * 0.75, yy = y - s * 0.85 + Math.sin(a) * r; if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
      ctx.stroke();
      ctx.fillStyle = F.withAlpha(col, 0.05 + 0.18 * gk);
      ctx.fill();
      ctx.restore();
    }
    if (e.regen && !(e.regenStop > 0) && Math.random() < 0.06) parts.emit({ x: px + (Math.random() - 0.5) * s * 0.6, y: y - s * (0.4 + Math.random() * 0.8), vy: -30, shape: 'dot', size: 2, life: 0.8, color: '#8fe39a' });
    if (e.regen && e.regenStop > 0 && Math.random() < 0.3) parts.emit({ x: px + (Math.random() - 0.5) * s * 0.6, y: y - s * (0.3 + Math.random() * 0.8), vy: -50, vx: 0, shape: 'dot', size: 1.8, life: 0.5, color: Math.random() < 0.5 ? '#ffb347' : '#ff6a2a' });
    if (slow && Math.random() < 0.15) parts.emit({ x: px + (Math.random() - 0.5) * s * 0.7, y: y - s * Math.random() * 1.2, vy: 12, shape: 'star', size: 2, life: 0.6, color: '#e8fbff' });
    // health bar with a lagging white chunk, then the defence medallions above it
    const frac = Math.max(0, e.hp / e.maxHp);
    const shown = fx.hpShow[e.uid] == null ? frac : fx.hpShow[e.uid];
    const bw = e.boss ? Math.min(view.w * 0.5, s * 1.3) : s * 0.95, bh = e.boss ? 9 : 6;
    const by = y - s * (e.boss ? 2.25 : e.kind === 'golem' ? 2.1 : 1.95) - (e.kind === 'imp' || e.kind === 'ghost' ? s * 0.25 : 0);
    hpBar(px - bw / 2, by, bw, bh, frac, shown, e.boss ? '#ff4f7a' : '#e8503f', e.boss && e.kind === 'ash_lord');
    if (e.boss) F.text(ctx, enemyName(e), px, by - 10, { size: 12, color: '#ffe1ea' });
    const icons = V.defenceIcons(e).filter((d) => d.type).slice(0, 4);
    const ir = 7.5, iy = by + bh + ir + 3;
    icons.forEach((d, i) => {
      const ix = px + (i - (icons.length - 1) / 2) * (ir * 2 + 3);
      const ring = d.kind === 'weak' ? '#5fd27a' : d.kind === 'resist' ? '#e0a040' : '#ff5a4a';
      ctx.fillStyle = 'rgba(14,8,26,.85)';
      ctx.beginPath(); ctx.arc(ix, iy, ir, 0, TAU); ctx.fill();
      ctx.strokeStyle = ring; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = V.TYPE_COLOR[d.type];
      ctx.font = `700 ${Math.round(ir * 1.25)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.icon, ix, iy + 0.5);
      if (d.kind === 'immune') { ctx.strokeStyle = '#ff5a4a'; ctx.beginPath(); ctx.moveTo(ix - ir * 0.7, iy + ir * 0.7); ctx.lineTo(ix + ir * 0.7, iy - ir * 0.7); ctx.stroke(); }
      else { ctx.fillStyle = ring; ctx.font = `800 ${Math.round(ir * 0.9)}px system-ui, sans-serif`; ctx.fillText(d.kind === 'weak' ? '▲' : '▼', ix + ir * 0.95, iy - ir * 0.75); }
    });
    if (e.shield > 0) {
      for (let i = 0; i < e.shield; i++) {
        const dxp = px + (i - (e.shield - 1) / 2) * 9, dyp = by - (e.boss ? 22 : 8);
        ctx.fillStyle = '#9fd0ff';
        ctx.beginPath(); ctx.moveTo(dxp, dyp - 4); ctx.lineTo(dxp + 3.5, dyp); ctx.lineTo(dxp, dyp + 4); ctx.lineTo(dxp - 3.5, dyp); ctx.closePath(); ctx.fill();
      }
    }
  }

  function hpBar(x, y, w, h, frac, shown, color, phases) {
    F.rrect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, (h + 3) / 2);
    ctx.fillStyle = 'rgba(12,6,22,.82)'; ctx.fill();
    if (shown > frac) { F.rrect(ctx, x, y, w * Math.min(1, shown), h, h / 2); ctx.fillStyle = 'rgba(255,240,230,.8)'; ctx.fill(); }
    if (frac > 0) {
      const gr = ctx.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, F.shade(color, 0.45)); gr.addColorStop(0.5, color); gr.addColorStop(1, F.shade(color, -0.35));
      F.rrect(ctx, x, y, Math.max(h, w * frac), h, h / 2); ctx.fillStyle = gr; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x + h / 2, y + 1, Math.max(0, w * frac - h), h * 0.28);
    }
    if (phases) { ctx.fillStyle = 'rgba(12,6,22,.9)'; for (const f of [0.66, 0.33]) ctx.fillRect(x + w * f - 1, y - 1, 2, h + 2); }
  }

  // ───────────── Drawing: the battle stage per act ─────────────
  // Each act is baked once per canvas size into layers: sky and far scenery, a middle row, the ground plane, an
  // emissive layer (lava) and a near foreground. Layers slide at different speeds with the camera: parallax.
  const stages = new Map();
  function stageFor(act, w, h, ground, s) {
    const key = `${act}|${w}|${h}|${view.dpr}`;
    let st = stages.get(key);
    if (st) return st;
    if (stages.size > 3) stages.clear();
    const M = Math.round(w * 0.06);
    const P = { w, h, ground, s, M, fy: ground - s * 0.5, lights: [] };
    const A = ART[act] || ART[1];
    const layer = (fn) => {
      if (!fn) return null;
      const c = makeCanvas((w + 2 * M) * view.dpr, h * view.dpr);
      const g = c.getContext('2d');
      g.setTransform(view.dpr, 0, 0, view.dpr, M * view.dpr, 0);
      LS = -1;
      fn(g, P, rng(act * 7919 + 17));
      return c;
    };
    st = { M, act, back: layer(A.back), mid: layer(A.mid), floor: layer(A.floor), glow: layer(A.glow), near: layer(A.near), lights: P.lights };
    stages.set(key, st);
    return st;
  }

  function pine(g, x, base, ht, dark, lit) {
    g.fillStyle = F.shade(dark, -0.35);
    g.fillRect(x - ht * 0.035, base - ht * 0.22, ht * 0.07, ht * 0.24);
    for (let i = 0; i < 4; i++) {
      const bot = base - ht * (0.14 + i * 0.2), top = bot - ht * 0.36, hw = ht * (0.3 - i * 0.055), droop = ht * 0.04;
      poly(g, dark, [x, top, x + hw, bot, x, bot - droop]);
      poly(g, lit, [x, top, x - hw, bot, x, bot - droop]);
    }
  }
  function hills(g, x0, x1, base, amp, color, R) {
    g.fillStyle = color;
    g.beginPath(); g.moveTo(x0, base + amp * 3);
    const ph = R() * 10;
    for (let x = x0; x <= x1 + 10; x += 10) g.lineTo(x, base - Math.sin(x / 90 + ph) * amp * 0.6 - Math.sin(x / 37 + ph * 2) * amp * 0.25);
    g.lineTo(x1, base + amp * 3); g.closePath(); g.fill();
  }
  function softBlob(g, x, y, r, color, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, F.withAlpha(color, a)); gr.addColorStop(1, F.withAlpha(color, 0));
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function fade(g, x, y, w, h, color, a0, a1) {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, F.withAlpha(color, a0)); gr.addColorStop(1, F.withAlpha(color, a1));
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  }
  // Lines of a floor seen in perspective: rows packed towards the horizon and rays to a vanishing point.
  function perspective(g, P, color, a, cols) {
    const { w, h, fy, M } = P, vx = w / 2, vy = fy - P.s * 5;
    g.strokeStyle = F.withAlpha(color, a); g.lineWidth = 1;
    for (let k = 1; k < 8; k++) { const y = fy + (h - fy) * Math.pow(k / 8, 1.7); g.beginPath(); g.moveTo(-M, y); g.lineTo(w + M, y); g.stroke(); }
    for (let i = -cols; i <= cols; i++) {
      const xb = vx + i * P.s * 1.1, xt = vx + (xb - vx) * (fy - vy) / (h - vy);
      g.beginPath(); g.moveTo(xt, fy); g.lineTo(xb, h); g.stroke();
    }
  }

  const ART = {
    1: { // the dark forest: dusk light through pines
      back(g, P, R) {
        const { w, h, ground, s, M } = P;
        const sky = g.createLinearGradient(0, 0, 0, ground);
        sky.addColorStop(0, '#0d2033'); sky.addColorStop(0.45, '#1d4b55'); sky.addColorStop(0.8, '#6aa086'); sky.addColorStop(1, '#d6e2a0');
        g.fillStyle = sky; g.fillRect(-M, 0, w + 2 * M, h);
        softBlob(g, w * 0.7, ground - h * 0.4, h * 0.55, '#fff0b8', 0.45);
        g.save(); g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 5; i++) {
          const x = w * (0.45 + i * 0.12), gr = g.createLinearGradient(x, 0, x - w * 0.3, ground);
          gr.addColorStop(0, 'rgba(255,245,200,.10)'); gr.addColorStop(1, 'rgba(255,245,200,0)');
          g.fillStyle = gr; g.beginPath(); g.moveTo(x, -10); g.lineTo(x + s * 0.4, -10); g.lineTo(x - w * 0.3 + s * 0.8, ground); g.lineTo(x - w * 0.3, ground); g.closePath(); g.fill();
        }
        g.restore();
        hills(g, -M, w + M, ground - s * 1.9, s * 0.7, '#5f8f84', R);
        for (let x = -M; x < w + M; x += s * (0.35 + R() * 0.3)) pine(g, x, ground - s * 0.9, s * (1.1 + R() * 0.7), '#3c6e66', '#4f8278');
        hills(g, -M, w + M, ground - s * 1.0, s * 0.45, '#36655a', R);
        for (let x = -M; x < w + M; x += s * (0.4 + R() * 0.35)) pine(g, x, ground - s * 0.55, s * (1.3 + R() * 0.8), '#285548', '#376a5a');
        fade(g, -M, ground - s * 1.6, w + 2 * M, s * 1.6, '#d8e8c0', 0, 0.4);
      },
      mid(g, P, R) {
        const { w, ground, s, M } = P;
        const xs = [-0.02, 0.1, 0.33, 0.52, 0.77, 0.95, 1.05];
        for (const fx0 of xs) {
          const x = fx0 * w + (R() - 0.5) * s * 0.4, ht = s * (2.8 + R() * 1.4);
          F.shadow(g, x, ground - s * 0.38, s * 0.6, s * 0.12, 0.4);
          pine(g, x, ground - s * 0.35, ht, '#163a2c', '#2e6a46');
        }
        for (let x = -M; x < w + M; x += s * (0.5 + R() * 0.4)) {
          const y = ground - s * 0.42;
          for (let k = 0; k < 3; k++) { LS = -1; ball(g, x + k * s * 0.18, y - (k % 2) * s * 0.1, s * (0.16 + R() * 0.08), '#245236', false); }
        }
      },
      floor(g, P, R) {
        const { w, h, ground, s, M, fy } = P;
        const gr = g.createLinearGradient(0, fy, 0, h);
        gr.addColorStop(0, '#6f9a4c'); gr.addColorStop(0.3, '#4b7a38'); gr.addColorStop(1, '#1f3d1e');
        g.fillStyle = gr; g.fillRect(-M, fy, w + 2 * M, h - fy);
        const pg = g.createLinearGradient(0, ground - s * 0.3, 0, ground + s * 0.35);
        pg.addColorStop(0, 'rgba(150,115,70,0)'); pg.addColorStop(0.45, 'rgba(150,115,70,.75)'); pg.addColorStop(1, 'rgba(110,80,50,0)');
        g.fillStyle = pg; g.fillRect(-M, ground - s * 0.3, w + 2 * M, s * 0.65);
        perspective(g, P, '#0e2410', 0.13, 10);
        for (let i = 0; i < 110; i++) {
          const d = Math.pow(R(), 1.3), y = fy + (h - fy) * d, x = -M + R() * (w + 2 * M), sz = s * (0.05 + 0.18 * d);
          if (Math.abs(y - ground) < s * 0.15 && R() < 0.7) continue;
          g.strokeStyle = R() < 0.5 ? '#8ab85a' : '#2e5a28'; g.lineWidth = 1 + d;
          g.beginPath(); g.moveTo(x - sz * 0.4, y - sz); g.quadraticCurveTo(x, y - sz * 0.2, x, y); g.quadraticCurveTo(x, y - sz * 0.4, x + sz * 0.3, y - sz * 1.1); g.stroke();
          if (R() < 0.12) { g.fillStyle = R() < 0.5 ? '#ffd8f0' : '#fff2a0'; g.beginPath(); g.arc(x, y - sz, 1 + d * 1.5, 0, TAU); g.fill(); }
        }
        fade(g, -M, fy - s * 0.1, w + 2 * M, s * 0.5, '#d8e8c0', 0.35, 0);
      },
      near(g, P, R) {
        const { w, h, s } = P;
        for (const [cx, k] of [[-s * 0.2, 1], [w + s * 0.2, -1]]) {
          for (let i = 0; i < 9; i++) {
            const bx = cx + k * R() * s * 1.2, ht = s * (0.5 + R() * 0.7);
            g.strokeStyle = R() < 0.5 ? '#0f2a14' : '#163a1c'; g.lineWidth = 3 + R() * 3; g.lineCap = 'round';
            g.beginPath(); g.moveTo(bx, h + 4); g.quadraticCurveTo(bx + k * s * 0.1, h - ht * 0.5, bx + k * s * (0.2 + R() * 0.4), h - ht); g.stroke();
          }
        }
      },
    },
    2: { // the crypt: arches, pillars, torchlight on stone
      back(g, P, R) {
        const { w, h, ground, s, M, fy } = P;
        const bg = g.createRadialGradient(w / 2, ground - s * 1.6, s, w / 2, ground - s * 1.6, w * 0.9);
        bg.addColorStop(0, '#3e3258'); bg.addColorStop(0.5, '#211a32'); bg.addColorStop(1, '#0c0914');
        g.fillStyle = bg; g.fillRect(-M, 0, w + 2 * M, h);
        const bh = s * 0.32;
        for (let row = 0, y = fy - bh; y > -bh; y -= bh, row++) {
          for (let x = -M - (row % 2) * s * 0.35; x < w + M; x += s * 0.7) {
            g.fillStyle = `rgba(255,240,255,${0.015 + R() * 0.04})`; g.fillRect(x + 1, y + 1, s * 0.7 - 2, bh - 2);
            g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y + bh - 1.5, s * 0.7, 1.5); g.fillRect(x, y, 1.5, bh);
          }
        }
        for (let i = -1; i < 5; i++) {
          const cx = w * (0.1 + i * 0.27), aw = s * 1.2, top = ground - s * 3.3;
          const ig = g.createLinearGradient(0, top, 0, fy);
          ig.addColorStop(0, '#05030a'); ig.addColorStop(1, '#1a1428');
          g.fillStyle = ig;
          g.beginPath(); g.moveTo(cx - aw / 2, fy); g.lineTo(cx - aw / 2, top + aw / 2); g.arc(cx, top + aw / 2, aw / 2, Math.PI, 0); g.lineTo(cx + aw / 2, fy); g.closePath(); g.fill();
          g.strokeStyle = '#5a4c78'; g.lineWidth = s * 0.12;
          g.beginPath(); g.moveTo(cx - aw / 2 - s * 0.06, fy); g.lineTo(cx - aw / 2 - s * 0.06, top + aw / 2); g.arc(cx, top + aw / 2, aw / 2 + s * 0.06, Math.PI, 0); g.lineTo(cx + aw / 2 + s * 0.06, fy); g.stroke();
          g.strokeStyle = 'rgba(255,230,255,.12)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, top + aw / 2, aw / 2 + s * 0.11, Math.PI, Math.PI * 1.5); g.stroke();
        }
        g.strokeStyle = 'rgba(140,130,160,.35)'; g.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const x = w * (0.2 + i * 0.22) + R() * s, len = s * (0.8 + R() * 1.5);
          g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + s * 0.2, len * 0.6, x + s * 0.05, len); g.stroke(); g.setLineDash([]);
        }
        fade(g, -M, fy - s * 1.4, w + 2 * M, s * 1.4, '#6a5a90', 0, 0.25);
      },
      mid(g, P, R) {
        const { w, ground, s, fy } = P;
        for (const fx0 of [0.02, 0.42, 0.86]) {
          const x = fx0 * w, pw = s * 0.62;
          const gr = g.createLinearGradient(x - pw / 2, 0, x + pw / 2, 0);
          gr.addColorStop(0, '#6c5c8c'); gr.addColorStop(0.3, '#4c4068'); gr.addColorStop(1, '#16101f');
          g.fillStyle = gr; g.fillRect(x - pw / 2, 0, pw, fy);
          g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = s * 0.4; y < fy; y += s * 0.55) g.fillRect(x - pw / 2, y, pw, 2);
          LS = -1;
          F.block(g, x - pw * 0.7, fy - s * 0.35, pw * 1.4, s * 0.4, 3, '#4a3e62');
          F.block(g, x - pw * 0.66, s * 0.1, pw * 1.32, s * 0.3, 3, '#4a3e62');
          const ty = ground - s * 2.1, tx = x + pw * 0.5 + s * 0.1;
          softBlob(g, tx, ty, s * 1.8, '#ff9a3a', 0.16);
          g.fillStyle = '#2a2230'; g.fillRect(tx - s * 0.12, ty + s * 0.18, s * 0.24, s * 0.06);
          limb(g, tx, ty + s * 0.4, tx, ty + s * 0.06, s * 0.07, '#5a3a24');
          P.lights.push({ x: tx, y: ty });
        }
        g.strokeStyle = 'rgba(230,225,240,.18)'; g.lineWidth = 1;
        for (const [cx, k] of [[0, 1], [w, -1]]) for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(cx, s * 0.3 * i); g.quadraticCurveTo(cx + k * s * 0.5, s * 0.4 + s * 0.15 * i, cx + k * s * (0.3 * i + 0.3), 0); g.stroke(); }
      },
      floor(g, P, R) {
        const { w, h, s, M, fy } = P;
        const gr = g.createLinearGradient(0, fy, 0, h);
        gr.addColorStop(0, '#4a3e62'); gr.addColorStop(0.35, '#2e2640'); gr.addColorStop(1, '#120e1c');
        g.fillStyle = gr; g.fillRect(-M, fy, w + 2 * M, h - fy);
        perspective(g, P, '#05030a', 0.5, 12);
        perspective(g, { ...P, fy: fy + 1.2, h: h + 1.2 }, '#ffffff', 0.05, 12);
        for (const fx0 of [0.02, 0.42, 0.86]) { g.save(); g.scale(1, 0.3); softBlob(g, fx0 * w + s * 0.5, (fy + s * 0.5) / 0.3, s * 2.2, '#ff9a3a', 0.16); g.restore(); }
        g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1;
        for (let i = 0; i < 10; i++) { let x = R() * w, y = fy + R() * (h - fy); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (R() - 0.5) * s * 0.6; y += (R() - 0.3) * s * 0.2; g.lineTo(x, y); } g.stroke(); }
        for (let i = 0; i < 6; i++) { const x = R() * w, y = fy + s * 0.2 + R() * (h - fy - s * 0.2); LS = -1; oval(g, x, y, s * 0.12, s * 0.035, '#cfc6b0'); }
      },
      near(g, P, R) {
        const { w, h, s } = P;
        LS = -1;
        F.block(g, -s * 0.3, h - s * 0.55, s * 0.9, s * 0.7, 5, '#2a2238', { gloss: true });
        F.block(g, s * 0.35, h - s * 0.3, s * 0.4, s * 0.4, 4, '#241c30');
        ball(g, w - s * 0.35, h - s * 0.15, s * 0.28, '#cfc6b0', true);
        g.fillStyle = '#1a1420'; g.beginPath(); g.arc(w - s * 0.28, h - s * 0.2, s * 0.06, 0, TAU); g.arc(w - s * 0.44, h - s * 0.2, s * 0.06, 0, TAU); g.fill();
      },
    },
    3: { // the volcano: ash sky, a smoking cone, basalt veined with lava
      back(g, P, R) {
        const { w, h, ground, s, M } = P;
        const sky = g.createLinearGradient(0, 0, 0, ground);
        sky.addColorStop(0, '#12040a'); sky.addColorStop(0.4, '#3a0d0e'); sky.addColorStop(0.78, '#9a2e12'); sky.addColorStop(1, '#ff9a48');
        g.fillStyle = sky; g.fillRect(-M, 0, w + 2 * M, h);
        for (let i = 0; i < 26; i++) softBlob(g, -M + R() * (w + 2 * M), R() * ground * 0.55, s * (0.8 + R() * 1.4), '#1a0606', 0.55);
        const vx = w * 0.66, vy = ground - s * 3.6, vb = s * 3.8;
        softBlob(g, vx, vy, s * 2.2, '#ff7a2a', 0.5);
        const vg = g.createLinearGradient(0, vy, 0, ground);
        vg.addColorStop(0, '#2a0c08'); vg.addColorStop(1, '#100404');
        g.fillStyle = vg;
        g.beginPath(); g.moveTo(vx - vb, ground); g.lineTo(vx - s * 0.5, vy); g.lineTo(vx + s * 0.5, vy); g.lineTo(vx + vb, ground); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,140,60,.45)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(vx - vb, ground); g.lineTo(vx - s * 0.5, vy); g.stroke();
        g.save(); g.globalCompositeOperation = 'lighter';
        for (const [a, b2] of [[-0.3, -1.6], [0.1, 0.7], [0.3, 2.1]]) {
          g.strokeStyle = 'rgba(255,110,30,.35)'; g.lineWidth = s * 0.16;
          g.beginPath(); g.moveTo(vx + a * s, vy); g.quadraticCurveTo(vx + b2 * s * 0.5, vy + s * 1.5, vx + b2 * s, ground - s * 0.6); g.stroke();
          g.strokeStyle = '#ffb347'; g.lineWidth = s * 0.05; g.stroke();
        }
        g.restore();
        for (let i = 0; i < 6; i++) softBlob(g, vx + (R() - 0.3) * s * 2, vy - s * (0.5 + i * 0.5), s * (0.6 + i * 0.25), '#2a1414', 0.5);
        g.fillStyle = '#1e0907';
        g.beginPath(); g.moveTo(-M, ground);
        let y0 = ground - s * 1.2;
        for (let x = -M; x <= w + M; x += s * 0.3) { y0 = Math.max(ground - s * 2, Math.min(ground - s * 0.7, y0 + (R() - 0.5) * s * 0.5)); g.lineTo(x, y0); }
        g.lineTo(w + M, ground); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,120,50,.4)'; g.lineWidth = 1.5; g.stroke();
        fade(g, -M, ground - s * 1.2, w + 2 * M, s * 1.2, '#ff6a2a', 0, 0.3);
      },
      mid(g, P, R) {
        const { w, ground, s } = P;
        for (const fx0 of [-0.03, 0.2, 0.48, 0.8, 1.02]) {
          const x = fx0 * w, ht = s * (1.3 + R() * 1.5), bw = s * (0.4 + R() * 0.3);
          const pts = [x - bw, ground - s * 0.4, x - bw * 0.5, ground - s * 0.4 - ht * 0.6, x - bw * 0.1, ground - s * 0.4 - ht, x + bw * 0.4, ground - s * 0.4 - ht * 0.7, x + bw, ground - s * 0.4];
          const gr = g.createLinearGradient(0, ground - s * 0.4 - ht, 0, ground);
          gr.addColorStop(0, '#3a1610'); gr.addColorStop(1, '#0e0504');
          poly(g, gr, pts);
          g.strokeStyle = 'rgba(255,150,70,.7)'; g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(pts[0], pts[1]); g.lineTo(pts[2], pts[3]); g.lineTo(pts[4], pts[5]); g.stroke();
        }
      },
      floor(g, P, R) {
        const { w, h, s, M, fy } = P;
        const gr = g.createLinearGradient(0, fy, 0, h);
        gr.addColorStop(0, '#4a2014'); gr.addColorStop(0.3, '#2c120c'); gr.addColorStop(1, '#100605');
        g.fillStyle = gr; g.fillRect(-M, fy, w + 2 * M, h - fy);
        perspective(g, P, '#000000', 0.18, 9);
        for (let i = 0; i < 40; i++) { const d = R(), y = fy + (h - fy) * d, x = -M + R() * (w + 2 * M); LS = -1; oval(g, x, y, s * (0.05 + d * 0.15), s * (0.02 + d * 0.05), '#3a1a12'); }
      },
      glow(g, P, R) {
        const { w, h, s, M, fy } = P;
        for (let i = 0; i < 7; i++) {
          let x = -M + R() * (w + 2 * M), y = fy + s * 0.2 + R() * (h - fy - s * 0.2);
          const pts = [x, y];
          for (let k = 0; k < 6; k++) { x += (R() - 0.5) * s * 1.2; y += (R() - 0.5) * s * 0.25; pts.push(x, y); }
          for (const [lw, c] of [[s * 0.22, 'rgba(255,90,20,.18)'], [s * 0.07, 'rgba(255,120,30,.8)'], [s * 0.025, '#ffe08a']]) {
            g.strokeStyle = c; g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round';
            g.beginPath(); g.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]); g.stroke();
          }
        }
        g.save(); g.scale(1, 0.28);
        softBlob(g, w * 0.88, (h - s * 0.2) / 0.28, s * 1.6, '#ff8a2a', 0.8);
        softBlob(g, w * 0.88, (h - s * 0.2) / 0.28, s * 0.8, '#fff0a0', 0.8);
        g.restore();
      },
      near(g, P, R) {
        const { w, h, s } = P;
        for (const [x, k] of [[-s * 0.1, 1], [w + s * 0.1, -1]]) {
          const pts = [x - k * s * 0.2, h + 2, x + k * s * 0.2, h - s * 0.75, x + k * s * 0.7, h - s * 0.5, x + k * s * 1.0, h + 2];
          poly(g, '#0c0403', pts);
          g.strokeStyle = 'rgba(255,130,50,.55)'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(pts[2], pts[3]); g.lineTo(pts[4], pts[5]); g.stroke();
        }
      },
    },
  };

  function drawStage(act, L) {
    const { w, h, ground, s } = L;
    const st = stageFor(act, w, h, ground, s);
    const M = st.M;
    const at = (k) => -M - Math.max(-M, Math.min(M, cam.x * k));
    ctx.drawImage(st.back, at(0.15), 0, w + 2 * M, h);
    ctx.drawImage(st.mid, at(0.4), 0, w + 2 * M, h);
    ctx.drawImage(st.floor, -M, 0, w + 2 * M, h);
    if (st.glow) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(time * 1.6);
      ctx.drawImage(st.glow, -M, 0, w + 2 * M, h);
      ctx.restore();
    }
    // living light: torches in the crypt
    for (const l of st.lights) {
      const x = l.x - Math.max(-M, Math.min(M, cam.x * 0.4)), y = l.y;
      const fl = 0.75 + 0.25 * Math.sin(time * 11 + l.x) * Math.sin(time * 7.3 + l.y);
      F.glow(ctx, x, y, s * 1.5, '#ff9a3a', 0.32 * fl);
      const fh = s * (0.32 + 0.08 * fl);
      const gr = ctx.createLinearGradient(0, y - fh, 0, y + s * 0.1);
      gr.addColorStop(0, 'rgba(255,240,180,0)'); gr.addColorStop(0.3, '#ffe08a'); gr.addColorStop(1, '#ff6a1a');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(x, y - fh); ctx.quadraticCurveTo(x + s * 0.14, y - fh * 0.2, x, y + s * 0.1); ctx.quadraticCurveTo(x - s * 0.14, y - fh * 0.2, x, y - fh); ctx.fill();
      F.glow(ctx, x, y - s * 0.05, s * 0.35, '#fff0b0', 0.6 * fl);
    }
    ambient(act, w, h, ground, s);
  }

  // Small living things in the air: fireflies, dust motes, embers.
  function ambient(act, w, h, ground, s) {
    if (act === 1) {
      for (let k = 0; k < 9; k++) {
        const x = ((k * 137 + time * (6 + k)) % (w + 40)) - 20 + Math.sin(time * 0.7 + k) * 20;
        const y = ground - s * 0.5 - ((k * 71) % (h * 0.45)) + Math.sin(time * 1.3 + k * 2) * 12;
        const a = 0.5 + 0.5 * Math.sin(time * 3 + k * 1.7);
        F.glow(ctx, x, y, 8, '#d8ff7a', a * 0.8);
        ctx.fillStyle = `rgba(250,255,210,${a})`; ctx.beginPath(); ctx.arc(x, y, 1.3, 0, TAU); ctx.fill();
      }
    } else if (act === 2) {
      ctx.fillStyle = 'rgba(220,210,255,.35)';
      for (let k = 0; k < 14; k++) {
        const x = (k * 97 + time * 7 + Math.sin(time * 0.5 + k) * 15) % w, y = (k * 53 + time * 4) % (ground - 10);
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    } else {
      for (let k = 0; k < 16; k++) {
        const x = (k * 97 + time * 18 + Math.sin(time + k) * 10) % w, y = ground - ((time * 34 + k * 53) % (h * 0.95));
        F.glow(ctx, x, y, 5, '#ff8a3d', 0.6);
        ctx.fillStyle = `rgba(255,${150 + (k % 3) * 35},80,.9)`; ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }

  // A vignette tinted with a colour, baked once per colour.
  function tintVignette(color, a) {
    const sp = F.bake('hero-vig|' + color, 128, (g, sz) => {
      const gr = g.createRadialGradient(sz / 2, sz / 2, sz * 0.28, sz / 2, sz / 2, sz * 0.72);
      gr.addColorStop(0, F.withAlpha(color, 0)); gr.addColorStop(1, F.withAlpha(color, 1));
      g.fillStyle = gr; g.fillRect(0, 0, sz, sz);
    });
    ctx.save(); ctx.globalAlpha = a; ctx.drawImage(sp, 0, 0, view.w, view.h); ctx.restore();
  }

  // ───────────── Drawing: the battle ─────────────
  function drawBattle(dt) {
    const b = run.battle;
    if (b) for (const e of b.enemies) fx.seen[e.uid] = e;
    const enemies = b ? b.enemies.filter((e) => !e.dead) : [];
    const L = V.battleLayout(view, Math.max(1, enemies.length));
    const s = L.s;
    const M = Math.round(view.w * 0.06);
    const lean = fx.heroAtk > 0 ? s * 0.25 : 0;
    cam.x = F.damp(cam.x, Math.sin(time * 0.25) * M * 0.5 + lean, 0.9, dt);
    // zoom in on tall screens as far as the hero and the last enemy still fit, about the middle of the fight
    const lastX = L.slots[L.slots.length - 1].x;
    const bigK = enemies.reduce((m, e) => Math.max(m, sizeOf(e)), 1);
    const ax = (L.hero.x + lastX) / 2;
    const want = 1 + 0.5 * clamp01((view.h / view.w - 0.75) / 0.35);
    const fit = Math.min((ax - 4) / Math.max(1, ax - (L.hero.x - s * 0.75)), (view.w - 4 - ax) / Math.max(1, lastX + s * 0.75 * bigK - ax));
    const zt = Math.max(1, Math.min(want, fit));
    cam.z0 = cam.z0 ? F.damp(cam.z0, zt, 0.95, dt) : zt;
    cam.ax = cam.ax ? F.damp(cam.ax, ax, 0.95, dt) : ax;
    cam.z = cam.z0 + fx.punch * 0.035;
    drawStage(run.act, L);
    ctx.save();
    ctx.translate(cam.ax, L.ground);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.ax, -L.ground);
    const look = V.heroLook(run);
    const enter = fx.enter > 0 ? ease.inQuad(fx.enter / 0.6) : 0;
    const hx = L.hero.x - enter * s * 2.2, hy = L.hero.y;
    // sunburst behind the hero on a win or a rank-up
    const burst = fx.outcome === 'win' ? clamp01(fx.outT * 2) : fx.rank > 0 ? fx.rank / 1.9 : 0;
    if (burst > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.translate(hx, hy - s * 1.0); ctx.rotate(time * 0.4);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(TAU / 12);
        const gr = ctx.createLinearGradient(0, 0, 0, -s * 3);
        gr.addColorStop(0, F.withAlpha('#ffe066', 0.35 * burst)); gr.addColorStop(1, 'rgba(255,224,102,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-s * 0.22, -s * 3); ctx.lineTo(s * 0.22, -s * 3); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // enemies from the back row to the front, the dying on top of them, then the hero
    enemies.forEach((e, i) => {
      const slot = L.slots[i];
      const p = fx.pos[e.uid] || (fx.pos[e.uid] = { x: slot.x + view.w * 0.3, y: slot.y });
      p.x += (slot.x - p.x) * Math.min(1, dt * 6);
      p.y = slot.y;
      const frac = Math.max(0, e.hp / e.maxHp);
      const sh = fx.hpShow[e.uid];
      fx.hpShow[e.uid] = sh == null ? frac : sh < frac ? frac : F.damp(sh, frac, 0.92, dt);
    });
    for (let i = enemies.length - 1; i >= 0; i--) { const e = enemies[i]; drawFoe(e, fx.pos[e.uid].x, fx.pos[e.uid].y, s, b); }
    for (const d of fx.dying) {
      const k = clamp01(d.t / DIE);
      drawFoe(d.e, d.x, d.y, s, null, { dissolve: ease.inOutQuad(k), rise: k * s * 0.15, pose: { wind: 0, reach: 0 } });
      if (Math.random() < 0.6) {
        const sz = sizeOf(d.e);
        parts.emit({ x: d.x + (Math.random() - 0.5) * s * 0.8 * sz, y: d.y - Math.random() * s * 1.6 * sz, vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 40, shape: 'dot', size: 1.6, life: 0.7, color: Math.random() < 0.5 ? '#ffd7a0' : '#8a7fa0' });
      }
    }
    const lose = fx.outcome === 'lose' ? clamp01(fx.outT / 0.9) : 0;
    const pose = heroPose(b, enemies.length > 0);
    if (lose > 0) { pose.lean -= 0.5 * ease.outCubic(lose); pose.squint = true; pose.aw = lerp(pose.aw, 2.6, lose); }
    const hurtFlash = fx.heroFlash > 0 ? clamp01(fx.heroFlash / 0.07) : 0;
    const swapFlash = fx.swapFlash > 0 ? fx.swapFlash / 0.45 * 0.6 : 0;
    const lvlFlash = fx.lvl > 1.1 ? (fx.lvl - 1.1) / 0.3 : 0;
    const hfl = Math.max(hurtFlash, swapFlash, lvlFlash);
    const hcol = hurtFlash >= hfl ? '#ffffff' : lvlFlash >= swapFlash ? '#fff0a0' : look.weapon ? look.weapon.color : '#ffffff';
    drawHero(hx, hy, s, look, pose, { flash: hfl, flashColor: hcol, dissolve: lose * 0.85 });
    // level-up: a column of light and rings at the feet
    if (fx.lvl > 0) {
      const q = 1 - fx.lvl / 1.4, a = 1 - q;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const cw = s * (fx.rank > 0 ? 1.3 : 0.9) * (1 - q * 0.6);
      const gr = ctx.createLinearGradient(hx - cw / 2, 0, hx + cw / 2, 0);
      gr.addColorStop(0, 'rgba(255,224,102,0)'); gr.addColorStop(0.5, F.withAlpha('#fff3b0', 0.55 * a)); gr.addColorStop(1, 'rgba(255,224,102,0)');
      ctx.fillStyle = gr; ctx.fillRect(hx - cw / 2, hy - s * 4, cw, s * 4);
      ctx.strokeStyle = F.withAlpha('#ffe066', a); ctx.lineWidth = 3 * a + 0.5;
      for (const d of [0, 0.25]) { const r = s * (0.4 + Math.max(0, q - d) * 2); ctx.beginPath(); ctx.ellipse(hx, hy, r, r * 0.25, 0, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
    // the weapon swap: a spinning ring of the weapon's colour
    if (fx.swap > 0 && look.weapon) {
      const q = 1 - fx.swap / C.SWAP_TIME;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = F.withAlpha(look.weapon.color, 0.7 * (1 - q * 0.5)); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(hx + s * 0.4, hy - s * 1.05, s * 0.75, time * 12, time * 12 + Math.PI * 1.3); ctx.stroke();
      ctx.restore();
    }
    for (const sp of fx.spells) drawSpell(sp, L);
    for (const bu of fx.bursts) {
      const q = bu.t / bu.life;
      F.glow(ctx, bu.x, bu.y, bu.r * (1 + q * 0.6), bu.color, 1 - q);
      F.glow(ctx, bu.x, bu.y, bu.r * 0.45, '#ffffff', (1 - q) * 0.9);
    }
    parts.draw(ctx);
    floaters.draw(ctx);
    ctx.restore();
    ctx.drawImage(stageFor(run.act, view.w, view.h, L.ground, s).near, -M - Math.max(-M, Math.min(M, cam.x)), 0, view.w + 2 * M, view.h);
    if (fx.phase > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = F.withAlpha(fx.phaseColor, fx.phase * 0.35);
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.restore();
    }
    if (b && b.enraged) tintVignette('#ff2030', 0.35 + 0.15 * Math.sin(time * 6));
    if (lose > 0) { ctx.fillStyle = `rgba(30,0,12,${0.45 * lose})`; ctx.fillRect(0, 0, view.w, view.h); tintVignette('#5a0010', 0.6 * lose); }
    F.vignette(ctx, view.w, view.h, 0.4);
  }

  const SPELL_LIFE = { fireball: 0.3, smite: 0.5, nova: 0.55, heal: 0.7 };
  function drawSpell(sp, L) {
    const s = L.s, hx = L.hero.x + s * 0.45, hy = L.hero.y - s * 1.05;
    const target = run.battle && run.battle.enemies.find((e) => !e.dead);
    const tp = target ? enemyPos(target.uid) : { x: view.w * 0.7, y: L.ground };
    const tk = sizeOf(target), ty = tp.y - s * 0.85 * tk;
    if (sp.spell === 'fireball') {
      const k = clamp01(sp.t / 0.24);
      if (k >= 1) return;
      const x = lerp(hx, tp.x, k), y = lerp(hy, ty, k) - Math.sin(k * Math.PI) * s * 0.6;
      F.glow(ctx, x, y, s * 0.7, '#ff7a2a', 0.9);
      const gr = ctx.createRadialGradient(x - s * 0.04, y - s * 0.04, 0, x, y, s * 0.17);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#ffe08a'); gr.addColorStop(1, '#ff6a1a');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, s * 0.17, 0, TAU); ctx.fill();
      parts.emit({ x, y, vx: -60, vy: -20, shape: 'dot', size: 3, life: 0.35, color: Math.random() < 0.5 ? '#ffb347' : '#ff6a2a' });
      parts.emit({ x, y, vx: -30, vy: -30, shape: 'smoke', size: 4, grow: 10, life: 0.5, color: '#3a2420', alpha: 0.5 });
    } else if (sp.spell === 'smite') {
      const k = clamp01(sp.t / 0.5), a = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
      const bw = s * 0.55 * (1 - k * 0.5);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createLinearGradient(tp.x - bw, 0, tp.x + bw, 0);
      gr.addColorStop(0, 'rgba(255,224,102,0)'); gr.addColorStop(0.5, F.withAlpha('#fffbe0', 0.85 * a)); gr.addColorStop(1, 'rgba(255,224,102,0)');
      ctx.fillStyle = gr; ctx.fillRect(tp.x - bw, -50, bw * 2, tp.y + 50);
      ctx.restore();
      F.glow(ctx, tp.x, tp.y - s * 0.2, s * 1.4, '#ffe066', a);
    } else if (sp.spell === 'nova') {
      const k = clamp01(sp.t / 0.55), r = k * view.w * 0.85;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = F.withAlpha('#7fd8ff', 0.35 * (1 - k)); ctx.lineWidth = 14 * (1 - k) + 2;
      ctx.beginPath(); ctx.ellipse(L.hero.x, L.ground, r, r * 0.16, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = F.withAlpha('#e8fbff', 0.9 * (1 - k)); ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      if (Math.random() < 0.8) parts.emit({ x: L.hero.x + r, y: L.ground - Math.random() * 6, vx: 30, vy: -80 - Math.random() * 60, shape: 'chunk', size: 3, spin: 10, gravity: 300, life: 0.5, color: Math.random() < 0.5 ? '#e8fbff' : '#7fd8ff' });
    } else {
      const k = clamp01(sp.t / 0.7);
      F.glow(ctx, L.hero.x, L.hero.y - s * 0.8, s * 1.3, '#8fe39a', 0.5 * (1 - k));
      ctx.strokeStyle = F.withAlpha('#8fe39a', 1 - k); ctx.lineWidth = 2.5;
      const r = s * (0.3 + k * 0.9);
      ctx.beginPath(); ctx.ellipse(L.hero.x, L.ground, r, r * 0.25, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = F.withAlpha('#d8ffd8', 1 - k);
      for (let i = 0; i < 3; i++) {
        const px = L.hero.x + (i - 1) * s * 0.4, py = L.hero.y - s * (0.8 + k * 1.2 + i * 0.2);
        ctx.fillRect(px - 1.5, py - 5, 3, 10); ctx.fillRect(px - 5, py - 1.5, 10, 3);
      }
    }
  }

  // ───────────── Drawing: the act map ─────────────
  // A themed ground seen from above, roads between the places and every place a minted medallion.
  const KIND_COLOR = { battle: '#c8423a', elite: '#8a3ac8', chest: '#c8902a', forge: '#d2642a', shrine: '#2aa8c8', camp: '#3a62c0', shop: '#3aa860', boss: '#b81e3c' };
  const maps = new Map();
  function mapBackdrop(act, w, h) {
    const key = `${act}|${w}|${h}|${view.dpr}`;
    let c = maps.get(key);
    if (c) return c;
    if (maps.size > 3) maps.clear();
    c = makeCanvas(w * view.dpr, h * view.dpr);
    const g = c.getContext('2d');
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const R = rng(act * 31 + 5);
    LS = -1;
    if (act === 1) {
      const bg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.7);
      bg.addColorStop(0, '#4f7a40'); bg.addColorStop(1, '#1a3320');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { const x = R() * w, y = R() * h; g.fillStyle = `rgba(${R() < 0.5 ? '160,200,110' : '20,50,25'},${0.05 + R() * 0.08})`; g.beginPath(); g.arc(x, y, 4 + R() * 14, 0, TAU); g.fill(); }
      for (let i = 0; i < 70; i++) {
        const edge = R() < 0.5, x = R() * w, y = edge ? R() * h * 0.16 : h - R() * h * 0.16, r = 8 + R() * 12;
        F.shadow(g, x + r * 0.3, y + r * 0.4, r * 1.1, r * 0.7, 0.4);
        ball(g, x, y, r, R() < 0.5 ? '#2a5a34' : '#336a3a', false);
      }
    } else if (act === 2) {
      g.fillStyle = '#1e1830'; g.fillRect(0, 0, w, h);
      const tsz = 48;
      for (let y = 0, row = 0; y < h; y += tsz, row++) for (let x = -(row % 2) * tsz / 2; x < w; x += tsz) F.block(g, x + 1, y + 1, tsz - 2, tsz - 2, 3, F.mix('#2c2440', '#221c34', R()));
      g.fillStyle = 'rgba(10,6,24,.35)'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1;
      for (let i = 0; i < 14; i++) { let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 30; y += (R() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
      softBlob(g, w / 2, h / 2, Math.max(w, h) * 0.5, '#7a5aa8', 0.18);
    } else {
      g.fillStyle = '#1c0a08'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 12; i++) {
        let x = R() * w, y = R() * h;
        const pts = [x, y];
        for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 60; y += (R() - 0.5) * 60; pts.push(x, y); }
        for (const [lw, cc] of [[8, 'rgba(255,90,20,.07)'], [2.5, 'rgba(255,110,30,.3)'], [0.8, 'rgba(255,210,122,.55)']]) {
          g.strokeStyle = cc; g.lineWidth = lw; g.lineJoin = 'round';
          g.beginPath(); g.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]); g.stroke();
        }
      }
      for (let i = 0; i < 40; i++) { const x = R() * w, y = R() * h, r = 4 + R() * 10; oval(g, x, y, r * 1.4, r, '#3a1a12'); }
      softBlob(g, w / 2, h / 2, Math.max(w, h) * 0.5, '#ff6a2a', 0.12);
    }
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(10,6,24,0)'); vg.addColorStop(1, 'rgba(10,6,24,.7)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    maps.set(key, c);
    return c;
  }

  const medals = new Map();
  function medal(kind, r, dim) {
    const key = `${kind}|${Math.round(r * 4)}|${dim ? 1 : 0}|${view.dpr}`;
    let c = medals.get(key);
    if (c) return c;
    if (medals.size > 80) medals.clear();
    const d = view.dpr, S = r * 2.8;
    c = makeCanvas(S * d, S * d);
    const g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    const cx = S / 2, cy = S / 2;
    const face = dim ? F.mix(KIND_COLOR[kind], '#4a4458', 0.7) : KIND_COLOR[kind];
    const metal = dim ? '#6a6478' : kind === 'boss' ? '#ffcf4d' : kind === 'elite' ? '#d8c8f0' : '#d09a58';
    g.fillStyle = F.shade(metal, -0.6);
    g.beginPath(); g.arc(cx, cy + r * 0.17, r, 0, TAU); g.fill();
    const rg = g.createLinearGradient(cx - r, cy - r, cx + r * 0.6, cy + r);
    rg.addColorStop(0, F.shade(metal, 0.6)); rg.addColorStop(0.45, metal); rg.addColorStop(1, F.shade(metal, -0.45));
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    const fr = r * 0.76;
    const fg = g.createRadialGradient(cx - fr * 0.35, cy - fr * 0.45, fr * 0.1, cx, cy, fr);
    fg.addColorStop(0, F.shade(face, 0.4)); fg.addColorStop(0.6, face); fg.addColorStop(1, F.shade(face, -0.4));
    g.fillStyle = fg; g.beginPath(); g.arc(cx, cy, fr, 0, TAU); g.fill();
    const bg = g.createLinearGradient(0, cy - fr, 0, cy + fr);
    bg.addColorStop(0, 'rgba(10,5,20,.6)'); bg.addColorStop(0.5, 'rgba(10,5,20,0)'); bg.addColorStop(1, 'rgba(255,255,255,.4)');
    g.strokeStyle = bg; g.lineWidth = r * 0.09; g.beginPath(); g.arc(cx, cy, fr, 0, TAU); g.stroke();
    g.font = `700 ${Math.round(r * 0.95)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const icon = V.KIND_ICON[kind];
    g.fillStyle = 'rgba(10,5,20,.6)'; g.fillText(icon, cx + r * 0.05, cy + r * 0.09);
    const ig = g.createLinearGradient(0, cy - r * 0.5, 0, cy + r * 0.5);
    ig.addColorStop(0, '#ffffff'); ig.addColorStop(1, dim ? '#b8b0c8' : '#f0dcc0');
    g.fillStyle = ig; g.fillText(icon, cx, cy + r * 0.03);
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = r * 0.07; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r * 0.88, Math.PI * 1.08, Math.PI * 1.42); g.stroke();
    medals.set(key, c);
    return c;
  }

  function road(p, q) {
    const mx = (p.x + q.x) / 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.bezierCurveTo(mx, p.y, mx, q.y, q.x, q.y);
  }
  function roadDots(p, q, gap, r, color) {
    const mx = (p.x + q.x) / 2, len = Math.hypot(q.x - p.x, q.y - p.y), n = Math.max(2, Math.floor(len / gap));
    ctx.fillStyle = color;
    for (let i = 1; i < n; i++) {
      const u = i / n, a = (1 - u) ** 3, b2 = 3 * (1 - u) ** 2 * u, c2 = 3 * (1 - u) * u * u, d = u ** 3;
      const x = a * p.x + b2 * mx + c2 * mx + d * q.x, y = a * p.y + b2 * p.y + c2 * q.y + d * q.y;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }

  function drawMap() {
    const map = run.map;
    const L = V.mapLayout(map, view);
    cam.z = 1;
    ctx.drawImage(mapBackdrop(run.act, view.w, view.h), 0, 0, view.w, view.h);
    ambient(run.act, view.w, view.h, view.h * 0.9, L.r * 2);
    const cur = run.at == null ? -1 : map.nodes[run.at].row;
    const reach = C.reachable(run);
    // roads: travelled, the glowing way on, and the dotted future
    ctx.lineCap = 'round';
    for (const n of map.nodes) {
      for (const k of n.next) {
        const p = L.pos[n.id], q = L.pos[k];
        const next = (n.id === run.at) && reach.includes(k);
        const trail = n.row < cur && k === run.at;
        if (next) {
          road(p, q);
          ctx.strokeStyle = 'rgba(10,5,20,.55)'; ctx.lineWidth = 7; ctx.stroke();
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(255,200,90,.25)'; ctx.lineWidth = 9; ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 3; ctx.setLineDash([7, 6]); ctx.lineDashOffset = -time * 24; ctx.stroke(); ctx.setLineDash([]);
        } else if (trail) {
          road(p, q); ctx.strokeStyle = 'rgba(10,5,20,.45)'; ctx.lineWidth = 6; ctx.stroke();
          ctx.strokeStyle = 'rgba(255,215,140,.6)'; ctx.lineWidth = 2.5; ctx.stroke();
        } else {
          roadDots(p, q, 8, 2.4, 'rgba(10,5,20,.45)');
          roadDots({ x: p.x, y: p.y - 1 }, { x: q.x, y: q.y - 1 }, 8, 1.6, n.row < cur ? 'rgba(255,255,255,.18)' : 'rgba(255,245,225,.5)');
        }
      }
    }
    const focusId = reach[mapFocus % Math.max(1, reach.length)];
    for (const n of map.nodes) {
      const p = L.pos[n.id];
      const isReach = reach.includes(n.id), past = n.row <= cur && n.id !== run.at;
      const r = L.r * (n.kind === 'boss' ? 1.35 : 1);
      const lift = isReach ? 3 + Math.sin(time * 4 + n.id) * 2 : 0;
      if (isReach || n.id === run.at) F.glow(ctx, p.x, p.y, r * 2.2, n.id === run.at ? '#ffd34d' : '#ff9bb2', isReach ? 0.35 + 0.15 * Math.sin(time * 5) : 0.3);
      if (n.kind === 'boss' && !past) F.glow(ctx, p.x, p.y, r * 2, '#ff3b5c', 0.3 + 0.1 * Math.sin(time * 2));
      F.shadow(ctx, p.x + r * 0.12, p.y + r * 0.95 + lift * 0.3, r * (1.05 + lift * 0.02), r * 0.35, 0.55 - lift * 0.03);
      const c = medal(n.kind, r, past);
      const S = r * 2.8;
      ctx.globalAlpha = past ? 0.75 : 1;
      ctx.drawImage(c, p.x - S / 2, p.y - S / 2 - lift, S, S);
      ctx.globalAlpha = 1;
      if (isReach) {
        ctx.strokeStyle = F.withAlpha('#ffd1dc', 0.6 + 0.4 * Math.sin(time * 5));
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y - lift, r + 4 + Math.sin(time * 5) * 1.5, 0, TAU); ctx.stroke();
      }
      if (n.id === run.at) { ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, TAU); ctx.stroke(); }
      if (isReach && n.id === focusId && keyboardMap) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -time * 20;
        ctx.beginPath(); ctx.arc(p.x, p.y - lift, r + 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // the hero stands on his place (above the first column before the first step)
    let hp;
    if (run.at != null) hp = { x: L.pos[run.at].x, y: L.pos[run.at].y - L.r * 0.55 };
    else { const first = map.rows[0].map((id) => L.pos[id]); hp = { x: first[0].x + L.r * 1.4, y: Math.min(...first.map((q) => q.y)) - L.r * 1.3 }; }
    const look = V.heroLook(run);
    const hs = Math.max(14, L.r * 1.05);
    drawHero(hp.x, hp.y + Math.sin(time * 4) * 1.5, hs, look, { aw: REST + Math.sin(time * 2) * 0.1, lean: 0, sx: 1, sy: 1, dx: 0, spin: 0, emit: false }, { small: true });
    parts.draw(ctx);
    floaters.draw(ctx);
    // title ribbon and the hint
    const title = t('Акт {n}: {name}', { n: run.act, name: t(K.ACT_NAMES[run.act]) });
    const fs = Math.max(13, Math.round(view.w / 34));
    ctx.font = `900 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(title).width;
    F.rrect(ctx, 8, 7, tw + 24, fs + 12, (fs + 12) / 2);
    ctx.fillStyle = 'rgba(14,8,26,.65)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,211,77,.5)'; ctx.lineWidth = 1; ctx.stroke();
    F.text(ctx, title, 20, 13 + fs / 2, { size: fs, color: '#ffe6a0', align: 'left' });
    if (reach.length) F.text(ctx, t('Выбери, куда идти'), view.w / 2, view.h - 12, { size: Math.max(12, Math.round(view.w / 44)), color: '#ffffff', weight: 800 });
  }
  let keyboardMap = false;

  function drawMenuScene() {
    const L = V.battleLayout(view, 1);
    cam.z = 1;
    cam.x = Math.sin(time * 0.25) * view.w * 0.03;
    const act = 1 + (Math.floor(time / 8) % 3);
    drawStage(act, L);
    const k = Math.floor(time / 2.5);
    const fake = { hero: { level: 1 + (k % 16) }, eq: { weapon: 1, armor: 2 }, bag: [{ uid: 1, id: ['rusty_sword', 'flame_blade', 'frost_staff', 'sun_mace', 'ice_lance', 'holy_hammer', 'ember_axe'][k % 7], tier: 1 + (k % 5) }, { uid: 2, id: ['leather', 'chain', 'plate', 'scale', 'robe'][k % 5], tier: 1 + (k % 5) }] };
    drawHero(view.w / 2, L.ground, L.s * 1.15, V.heroLook(fake), { aw: REST + Math.sin(time * 2.2) * 0.08, lean: 0, sx: 1, sy: 1, dx: 0, spin: 0, emit: true });
    parts.draw(ctx);
    F.vignette(ctx, view.w, view.h, 0.4);
  }

  // ───────────── Frame ─────────────
  function updateFx(dt) {
    // the visual hit-stop: animations crawl for a few frames after a blow; the battle itself never waits
    const adt = fx.stop > 0 ? dt * 0.12 : dt;
    fx.stop = Math.max(0, fx.stop - dt);
    fx.heroAtk = Math.max(0, fx.heroAtk - (fx.heroAtk > SWING * 0.78 ? dt : adt));
    fx.heroHurt = Math.max(0, fx.heroHurt - adt);
    fx.heroFlash = Math.max(0, fx.heroFlash - adt);
    fx.heroDodge = Math.max(0, fx.heroDodge - dt);
    fx.swap = Math.max(0, fx.swap - dt);
    fx.swapFlash = Math.max(0, fx.swapFlash - dt);
    fx.punch = Math.max(0, fx.punch - dt * 5);
    fx.phase = Math.max(0, fx.phase - dt * 1.5);
    fx.lvl = Math.max(0, fx.lvl - dt);
    fx.rank = Math.max(0, fx.rank - dt);
    if (fx.outcome) fx.outT += dt;
    for (const m of [fx.flash, fx.eAtk, fx.dodge, fx.guard]) for (const k of Object.keys(m)) { m[k] -= m === fx.flash ? adt : dt; if (m[k] <= 0) delete m[k]; }
    for (const k of Object.keys(fx.kb)) { fx.kb[k] *= Math.exp(-adt * 9); if (fx.kb[k] < 0.01) delete fx.kb[k]; }
    fx.spells = fx.spells.filter((sp) => (sp.t += dt) < (SPELL_LIFE[sp.spell] || 0.5));
    fx.bursts = fx.bursts.filter((bu) => (bu.t += dt) < bu.life);
    fx.dying = fx.dying.filter((d) => (d.t += dt) < DIE);
    if (fx.later.length) {
      const due = [];
      fx.later = fx.later.filter((l) => ((l.t -= dt) > 0 ? true : (due.push(l.fn), false)));
      for (const fn of due) fn();
    }
    parts.update(dt);
    floaters.update(dt);
    shake.update(dt);
    if (fx.banner) { fx.banner.t -= dt; if (fx.banner.t <= 0) { fx.banner = null; $('banner').hidden = true; } }
  }

  function frame(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    time += dt;
    if (fx) updateFx(dt);
    if (screen === 'battle') battleFrame(dt);
    if (screen === 'after') {
      after -= dt;
      if (after <= 0) sync();
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    const inBattle = run && (screen === 'battle' || screen === 'after');
    if (inBattle) { const o = shake.offset(); ctx.translate(o.x, o.y); }
    if (!run) drawMenuScene();
    else if (run.phase === 'battle' || screen === 'after') {
      if (run.battle || screen === 'after') drawBattle(dt); else drawMap();
    } else if (run.phase === 'map') drawMap();
    else drawBattle(dt);
    if (inBattle) {
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
