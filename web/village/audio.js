'use strict';
// Родник — sounds and music. A no-op stub for now: every call is safe without an AudioContext.
// Works in the browser (window.VillageAudio) and in Node (module.exports) so it can be tested.
(function (root) {
  const state = { music: true, sounds: true };

  const api = {
    state,
    unlock() {},
    play() {},
    setMusic(on) { state.music = !!on; },
    setSounds(on) { state.sounds = !!on; },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VillageAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
