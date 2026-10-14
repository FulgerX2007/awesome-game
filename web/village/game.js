'use strict';
// Родник — client. Rules live in core.js (window.Village), pure helpers in view.js (window.VillageView).
// For now: load the saved state (or start a new game) and draw the map tiles and the HUD.
(() => {
  const V = window.Village;
  const { TILE } = window.VillageView;
  const { t } = window.I18n;
  const SAVE_KEY = 'village.save';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  };

  let S = null;
  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1;

  function loadState() {
    const raw = store.get(SAVE_KEY);
    if (raw) {
      const s = V.load(raw);
      if (!s.recovered) return s;
    }
    return V.newGame((Math.random() * 0x7fffffff) | 0);
  }

  // ───────────── Scene ─────────────
  const TILE_COLORS = {
    '.': '#6f9d48', '~': '#3f86a6', ':': '#d9c48f', '=': '#b89a6a', '#': '#c9b28a', b: '#3f86a6',
  };
  const RUIN_COLOR = '#7b6a55';
  const NODE_COLORS = { tree: '#2f5f2a', rock: '#8d8d86', clay: '#b0673c', bush: '#9c3a5a' };

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cw = Math.max(1, Math.round(r.width));
    ch = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#5d8a3e';
    ctx.fillRect(0, 0, cw, ch);
    // Camera centred on the player, clamped to the map edges.
    const mw = V.W * TILE, mh = V.H * TILE;
    const camX = mw <= cw ? (mw - cw) / 2 : clamp(S.player.x * TILE - cw / 2, 0, mw - cw);
    const camY = mh <= ch ? (mh - ch) / 2 : clamp(S.player.y * TILE - ch / 2, 0, mh - ch);
    ctx.translate(-Math.round(camX), -Math.round(camY));
    const x0 = Math.max(0, Math.floor(camX / TILE)), y0 = Math.max(0, Math.floor(camY / TILE));
    const x1 = Math.min(V.W - 1, Math.ceil((camX + cw) / TILE)), y1 = Math.min(V.H - 1, Math.ceil((camY + ch) / TILE));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = V.MAP[y][x];
        ctx.fillStyle = TILE_COLORS[c] || RUIN_COLOR;
        if (c === 'b' && S.built.bridge.done) ctx.fillStyle = '#8a6239';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    for (const n of S.nodes) {
      if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
      ctx.fillStyle = NODE_COLORS[n.kind];
      ctx.globalAlpha = n.hp > 0 ? 1 : 0.35;
      ctx.beginPath();
      ctx.arc((n.x + 0.5) * TILE, (n.y + 0.5) * TILE, TILE * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The player position is a tile-space centre.
    ctx.fillStyle = '#f3e7cf';
    ctx.beginPath();
    ctx.arc(S.player.x * TILE, S.player.y * TILE, TILE * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ───────────── HUD ─────────────
  function goalText(g) {
    if (!g) return t('Осмотрись вокруг');
    if (g.type === 'build') return t('Восстановить: {name}', { name: t(V.BUILDINGS[g.id].name) });
    if (g.type === 'tool') return t('Нужен инструмент: {name}', { name: t(V.TOOLS[g.tool].name) });
    return t('Украшай село');
  }

  function renderHUD() {
    for (const r of Object.keys(V.RESOURCES)) $(`r-${r}`).textContent = String(Math.floor(S.res[r]));
    const ids = Object.keys(V.BUILDINGS);
    const done = ids.filter((id) => S.built[id].done).length;
    $('built-label').textContent = t('Восстановлено {n}/{total}', { n: done, total: ids.length });
    $('goal-text').textContent = goalText(V.nextGoal(S));
  }

  // ───────────── Boot ─────────────
  function boot() {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t(meta.content);
    // Added after I18n.translateDOM has run, so the button's own labels stay as they are.
    const addToggle = () => document.querySelector('.brand').append(GameNav.home('lang-btn'), I18n.toggle('lang-btn'));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle); else addToggle();
    S = loadState();
    resize();
    window.addEventListener('resize', () => { resize(); draw(); });
    draw();
    renderHUD();
  }

  boot();
})();
