'use strict';
// Родник — pure client helpers (no DOM): camera, tile picking, formatting. Filled in by later tasks;
// works in the browser (window.VillageView) and in Node (module.exports) so it can be tested.
(function (root) {
  const TILE = 32; // tile size in CSS pixels

  const api = { TILE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VillageView = api;
})(typeof window !== 'undefined' ? window : globalThis);
