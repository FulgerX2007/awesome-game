// Путь героя — pure client helpers: the act map layout and hit-testing, the battle stage layout, the hero's look
// from his level and equipment, an enemy's defence icons and number formatting. No DOM; in the browser it reads
// window.HeroCore / window.HeroContent (loaded first), in Node it requires them.
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const C = node ? require('./core.js') : root.HeroCore;
  const K = node ? require('./content.js') : root.HeroContent;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Colours of the damage types (hit numbers, icons, the weapon glow).
  const TYPE_COLOR = { phys: '#e6e1d6', fire: '#ff8a3d', ice: '#7fd8ff', holy: '#ffe066' };
  const TYPE_NAME = { phys: 'Сталь', fire: 'Огонь', ice: 'Лёд', holy: 'Свет' };
  const TYPE_ICON = { phys: '⚔', fire: '✹', ice: '❄', holy: '☀' };
  const KIND_ICON = { battle: '⚔', elite: '☠', chest: '▣', forge: '⚒', shrine: '✧', camp: '☾', shop: '⚖', boss: '♛' };
  const KIND_NAME = {
    battle: 'Бой', elite: 'Элита', chest: 'Сундук', forge: 'Кузница', shrine: 'Святилище', camp: 'Привал', shop: 'Торговец', boss: 'Босс',
  };

  // The act map drawn left to right: one column per row of the map, nodes spread down each column.
  // vp: { w, h } css px → { r (node radius), pos: [{x, y}] by node id }
  function mapLayout(map, vp) {
    const w = Math.max(1, (vp && vp.w) || 640), h = Math.max(1, (vp && vp.h) || 360);
    const cols = map.rows.length;
    const padX = Math.min(40, w * 0.06), padY = Math.min(36, h * 0.1);
    const dx = (w - 2 * padX) / Math.max(1, cols - 1);
    const maxPer = Math.max(...map.rows.map((r) => r.length));
    const dy = (h - 2 * padY) / Math.max(1, maxPer);
    const r = clamp(Math.min(dx * 0.36, dy * 0.36), 9, 26);
    const pos = [];
    map.rows.forEach((ids, col) => {
      ids.forEach((id, i) => {
        pos[id] = { x: padX + col * dx, y: h / 2 + (i - (ids.length - 1) / 2) * dy };
      });
    });
    return { r, pos, w, h };
  }

  // The node under a point (with a padded hit area so a finger finds small nodes), or null.
  function nodeAt(layout, x, y) {
    let best = null, bestD = Infinity;
    const reach = Math.max(layout.r * 1.5, 18);
    layout.pos.forEach((p, id) => {
      if (!p) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= reach && d < bestD) { best = id; bestD = d; }
    });
    return best;
  }

  // The battle stage: the ground line, the hero on the left and up to `n` enemy slots on the right.
  function battleLayout(vp, n = 1) {
    const w = Math.max(1, (vp && vp.w) || 640), h = Math.max(1, (vp && vp.h) || 360);
    const s = clamp(Math.min(w / 9, h / 4.2), 26, 90); // one "body" in px
    const ground = h - Math.max(18, h * 0.16);
    const hero = { x: Math.max(s * 1.1, w * 0.2), y: ground, s };
    const slots = [];
    const span = Math.max(1, n);
    for (let i = 0; i < span; i++) slots.push({ x: w * 0.62 + i * Math.min(s * 1.3, (w * 0.34) / span), y: ground, s });
    return { w, h, ground, hero, slots, s };
  }

  // What the renderer draws for the hero: a plain description, so tests can check the "noob → legend" look.
  function heroLook(run) {
    const level = run.hero.level;
    const arm = run.eq.armor != null ? run.bag.find((x) => x.uid === run.eq.armor) : null;
    const wpn = run.bag.find((x) => x.uid === run.eq.weapon) || null;
    const ARMOR_COLOR = ['#8a6f4a', '#9aa4ad', '#c0c8d0', '#d9b44a', '#9fe0ff'];
    const w = wpn ? C.itemStats(wpn) : null;
    return {
      title: C.title(level),
      armor: arm ? { id: arm.id, color: ARMOR_COLOR[clamp(arm.tier, 1, 5) - 1], tier: arm.tier } : null,
      helmet: level >= 6,
      cape: level >= 12,
      aura: level >= 15,
      weapon: wpn ? { id: wpn.id, type: w.type, color: TYPE_COLOR[w.type], tier: wpn.tier, shape: WEAPON_SHAPE[wpn.id] || 'sword' } : null,
    };
  }
  const WEAPON_SHAPE = {
    rusty_sword: 'sword', sword: 'sword', flame_blade: 'sword', axe: 'axe', ember_axe: 'axe', dagger: 'dagger',
    spear: 'spear', ice_lance: 'spear', sickle: 'sickle', frost_staff: 'staff', sun_mace: 'mace', holy_hammer: 'hammer',
  };

  // The defence icons under an enemy: resistances and weaknesses by damage type, then the traits.
  // → [{ kind: 'weak'|'resist'|'immune'|'dodge'|'regen'|'thorns'|'shield', type?, value, icon }]
  function defenceIcons(e) {
    const out = [];
    for (const type of K.TYPES) {
      const v = e.res[type];
      if (v === 1) continue;
      out.push({ kind: v === 0 ? 'immune' : v > 1 ? 'weak' : 'resist', type, value: v, icon: TYPE_ICON[type] });
    }
    if (e.dodge) out.push({ kind: 'dodge', value: e.dodge, icon: '≈' });
    if (e.regen) out.push({ kind: 'regen', value: e.regen, icon: '✚' });
    if (e.thorns) out.push({ kind: 'thorns', value: e.thorns, icon: '✶' });
    if (e.shield) out.push({ kind: 'shield', value: e.shield, icon: '◆' });
    return out;
  }

  // 1234 → "1 234" (the narrow no-break space of both languages).
  function fmt(n) {
    const v = Math.round(Number(n) || 0);
    return String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace(/^/, v < 0 ? '−' : '');
  }

  // The stats line of an item card: "Огонь · урон 6.5 · 1.0 с" and the like (Russian keys; the client translates).
  function itemLine(item) {
    const s = C.itemStats(item);
    if (s.slot === 'weapon') return { type: s.type, dmg: Math.round(s.dmg * 10) / 10, speed: s.interval, traits: s.traits };
    if (s.slot === 'armor') return { armor: s.armor, ward: s.ward, hp: s.hp };
    return { spell: s.spell, power: s.spell === 'heal' ? Math.round(s.power * 100) : Math.round(s.power), cd: s.cd };
  }

  const api = { TYPE_COLOR, TYPE_NAME, TYPE_ICON, KIND_ICON, KIND_NAME, WEAPON_SHAPE, mapLayout, nodeAt, battleLayout, heroLook, defenceIcons, fmt, itemLine };
  if (node) module.exports = api;
  else root.HeroView = api;
})(typeof window !== 'undefined' ? window : globalThis);
