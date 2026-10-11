// Поле чудес — words, the wheel and turn rules. No DOM, so it runs in Node for checks and bot games.
// A game is a plain JSON object: game.js saves it after every move and restores it as is.
(function (root) {
  'use strict';

  // mulberry32: small, fast, seedable.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Ё is played as Е, like on the show. Romanian keeps its diacritic letters as separate letters.
  const ALPHABET = {
    ru: 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    ro: 'AĂÂBCDEFGHIÎJKLMNOPQRSȘTȚUVWXYZ',
  };
  // Letters from most to least common: bots call them in roughly this order.
  const FREQ = {
    ru: 'ОЕАИНТСРВЛКМДПУЯЫЬГЗБЧЙХЖШЮЦЩЭФЪ',
    ro: 'EAIRNTULCOSĂDPMÎVFBGȚȘZHÂJXKYWQ',
  };

  // The letter a typed character stands for, or '' when it is not a letter of the alphabet.
  function key(ch, lang) {
    let c = String(ch).toLocaleUpperCase(lang === 'ro' ? 'ro-RO' : 'ru-RU');
    if (lang === 'ru') c = c.replace('Ё', 'Е');
    else c = c.replace('Ş', 'Ș').replace('Ţ', 'Ț'); // cedilla forms from older keyboards
    return c.length === 1 && ALPHABET[lang].includes(c) ? c : '';
  }
  // A typed answer as letters only: case, Ё and spaces or hyphens do not matter.
  const normWord = (text, lang) => [...String(text)].map((c) => key(c, lang)).join('');

  // [answer, task]. The task is what the host reads out before the round.
  const WORDS = {
    ru: [
      ['ГРАММОФОН', 'Этот аппарат играл музыку с пластинок через большую трубу'],
      ['СНЕГОВИК', 'Его лепят зимой, а вместо носа у него морковка'],
      ['ПАРОВОЗ', 'Он тянул поезда задолго до электричек и пыхтел дымом'],
      ['ПОДСОЛНУХ', 'Цветок, который поворачивает голову вслед за солнцем'],
      ['КАЛЕЙДОСКОП', 'Трубка, в которой цветные стёклышки складываются в узоры'],
      ['ЧЕРЕПАХА', 'Животное, которое носит свой дом на спине'],
      ['АКВАРИУМ', 'Стеклянный дом для рыбок'],
      ['ГОЛОВОЛОМКА', 'Задача, над которой приходится поломать голову'],
      ['ЛЕДОКОЛ', 'Судно, которое прокладывает путь сквозь льды'],
      ['ПАРАШЮТ', 'Купол, который спасает при прыжке с самолёта'],
      ['СКВОРЕЧНИК', 'Домик для птиц, который вешают на дерево'],
      ['САМОВАР', 'Без него не обходилось старинное русское чаепитие'],
      ['ВЕЛОСИПЕД', 'Двухколёсный транспорт, который едет силой ног'],
      ['ТЕЛЕСКОП', 'Прибор, чтобы разглядывать далёкие звёзды'],
      ['ОДУВАНЧИК', 'Жёлтый цветок, который потом становится пушистым шариком'],
      ['КЕНГУРУ', 'Животное, которое носит детёныша в сумке'],
      ['МОРОЖЕНОЕ', 'Холодное лакомство в вафельном стаканчике'],
      ['ЛАБИРИНТ', 'Запутанные ходы, из которых трудно найти выход'],
      ['КОМПАС', 'Прибор, стрелка которого всегда показывает на север'],
      ['БАЛАЛАЙКА', 'Трёхструнный инструмент с треугольным корпусом'],
      ['ХАМЕЛЕОН', 'Ящерица, которая умеет менять цвет'],
      ['ВОДОПАД', 'Река, которая срывается с обрыва'],
      ['КАРУСЕЛЬ', 'Аттракцион, который катает по кругу'],
      ['ПОДКОВА', 'Её прибивают к копыту лошади, а найти её — к счастью'],
      ['ВУЛКАН', 'Гора, из которой может вырваться лава'],
      ['ФЕЙЕРВЕРК', 'Разноцветные огни в небе на праздник'],
      ['БЕГЕМОТ', 'Толстокожий житель африканских рек'],
      ['ПИНГВИН', 'Птица, которая не летает, зато отлично плавает'],
      ['КОСМОНАВТ', 'Человек, который летает за пределы Земли'],
      ['МАТРЁШКА', 'Деревянная кукла, внутри которой прячутся другие'],
      ['ШОКОЛАД', 'Сладость из какао-бобов'],
      ['МЕТЕОРИТ', 'Небесный камень, долетевший до Земли'],
      ['АПЕЛЬСИН', 'Оранжевый плод, который чистят от толстой кожуры'],
      ['БУТЕРБРОД', 'Хлеб с маслом, а в переводе с немецкого так и есть'],
      ['КОЛОКОЛЬЧИК', 'Лесной цветок, похожий на маленький колокол'],
      ['СОРОКОНОЖКА', 'Её имя обещает сорок ног, а на деле их бывает больше'],
      ['ПЫЛЕСОС', 'Домашний помощник, который собирает пыль'],
      ['ГИТАРА', 'Шестиструнный инструмент у костра'],
      ['ПАЛИТРА', 'Дощечка, на которой художник смешивает краски'],
      ['ВЕРТОЛЁТ', 'Летательный аппарат с винтом над кабиной'],
      ['РАДУГА', 'Разноцветная дуга в небе после дождя'],
      ['СВЕТЛЯЧОК', 'Жучок, который светится в темноте'],
    ],
    ro: [
      ['GRAMOFON', 'Aparat care cânta muzică de pe discuri printr-o pâlnie mare'],
      ['LOCOMOTIVĂ', 'Trage vagoanele trenului după ea'],
      ['CALEIDOSCOP', 'Tub în care cioburile colorate formează modele'],
      ['ȚESTOASĂ', 'Animal care își poartă casa în spinare'],
      ['ACVARIU', 'Casă de sticlă pentru pești'],
      ['PARAȘUTĂ', 'Te salvează când sari din avion'],
      ['BICICLETĂ', 'Vehicul cu două roți, pus în mișcare cu pedalele'],
      ['TELESCOP', 'Instrument prin care privești stelele îndepărtate'],
      ['PĂPĂDIE', 'Floare galbenă care se transformă într-un puf alb'],
      ['CANGUR', 'Animal care își poartă puiul într-un buzunar'],
      ['ÎNGHEȚATĂ', 'Desert rece, servit în cornet'],
      ['LABIRINT', 'Drumuri încurcate din care e greu să ieși'],
      ['BUSOLĂ', 'Instrument al cărui ac arată mereu nordul'],
      ['CAMELEON', 'Șopârlă care își schimbă culoarea'],
      ['CASCADĂ', 'Râu care cade de pe o stâncă'],
      ['CARUSEL', 'Atracție care te învârte în cerc'],
      ['POTCOAVĂ', 'Se bate la copita calului și aduce noroc'],
      ['VULCAN', 'Munte din care poate țâșni lavă'],
      ['ARTIFICII', 'Lumini colorate pe cer de sărbători'],
      ['HIPOPOTAM', 'Locuitor greoi al râurilor africane'],
      ['PINGUIN', 'Pasăre care nu zboară, dar înoată excelent'],
      ['ASTRONAUT', 'Om care zboară dincolo de Pământ'],
      ['CIOCOLATĂ', 'Dulce făcut din boabe de cacao'],
      ['METEORIT', 'Piatră cerească ajunsă pe Pământ'],
      ['PORTOCALĂ', 'Fruct rotund care și-a dat numele unei culori'],
      ['CLOPOȚEL', 'Floare de pădure care seamănă cu un clopot mic'],
      ['ASPIRATOR', 'Ajutor de casă care adună praful'],
      ['CHITARĂ', 'Instrument cu șase coarde, cântat lângă foc'],
      ['PALETĂ', 'Scândura pe care pictorul amestecă vopselele'],
      ['FLUTURE', 'Insectă cu aripi colorate, care a fost cândva omidă'],
      ['CURCUBEU', 'Arc colorat pe cer după ploaie'],
      ['VIOARĂ', 'Instrument cu coarde la care se cântă cu arcușul'],
      ['MĂRȚIȘOR', 'Șnur alb-roșu dăruit la 1 martie'],
      ['PLĂCINTĂ', 'Aluat copt cu brânză, varză sau mere'],
      ['SARMALE', 'Foi de varză umplute, nelipsite de pe masa de sărbători'],
      ['ELICOPTER', 'Aparat de zbor cu elice deasupra cabinei'],
      ['FELINAR', 'Lampă care luminează strada noaptea'],
      ['CRIZANTEMĂ', 'Floare de toamnă cu multe petale'],
      ['CAȘCAVAL', 'Brânză galbenă și tare'],
      ['LICURICI', 'Gândăcel care strălucește în întuneric'],
      ['TROTINETĂ', 'Placă pe două roți, cu ghidon, împinsă cu piciorul'],
      ['VEVERIȚĂ', 'Animal roșcat din pădure, cu coadă stufoasă'],
    ],
  };

  // The wheel, clockwise from the pointer. Points are paid per opened letter.
  const SECTORS = [
    { t: 'pts', v: 300 }, { t: 'pts', v: 500 }, { t: 'bankrupt' }, { t: 'pts', v: 400 },
    { t: 'pts', v: 800 }, { t: 'zero' }, { t: 'pts', v: 600 }, { t: 'double' },
    { t: 'pts', v: 1000 }, { t: 'pts', v: 350 }, { t: 'plus' }, { t: 'pts', v: 700 },
    { t: 'pts', v: 450 }, { t: 'pts', v: 250 }, { t: 'pts', v: 900 }, { t: 'pts', v: 550 },
  ];
  const STREAK = 3; // correct letters in a row that bring out the boxes
  const BOX_PRIZE = 1000;
  const SUPER_LETTERS = 3;
  const SUPER_SECONDS = 60;
  const SUPER_MIN = 2000; // a super-game win doubles the bank, and adds at least this much

  function newGame({ lang, players, rounds = 3, seed = Date.now() }) {
    const R = rng(seed);
    const pool = WORDS[lang].map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const s = {
      v: 1, lang, rounds, round: 0,
      words: pool.slice(0, rounds + 1), // the last one is for the super-game
      players: players.map((p) => ({ name: p.name, bot: !!p.bot, total: 0, wins: 0 })),
    };
    startRound(s);
    return s;
  }

  function startRound(s) {
    const [word, task] = WORDS[s.lang][s.words[s.round]];
    Object.assign(s, {
      word, task, open: new Array([...word].length).fill(false), used: [],
      score: s.players.map(() => 0), out: s.players.map(() => false),
      turn: s.round % s.players.length, streak: 0, sector: -1, winner: -1, phase: 'spin', super: null,
    });
  }

  const letters = (s) => [...s.word].map((c) => key(c, s.lang));
  const closed = (s) => s.open.filter((o) => !o).length;

  // Hands the turn to the next player still in the round.
  function pass(s) {
    s.streak = 0;
    s.sector = -1;
    s.phase = 'spin';
    const n = s.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (s.turn + k) % n;
      if (!s.out[i]) { s.turn = i; return; }
    }
  }

  function winRound(s, p) {
    s.open.fill(true);
    s.winner = p;
    s.players[p].total += s.score[p];
    s.players[p].wins++;
    s.phase = 'roundEnd';
  }

  // Shared by a lucky letter and the «+» sector: either the word is open or the streak grows.
  function opened(s, ev) {
    if (s.open.every(Boolean)) {
      winRound(s, ev.player);
      ev.solved = true;
      return ev;
    }
    s.sector = -1;
    s.streak++;
    if (s.streak >= STREAK) {
      s.streak = 0;
      s.phase = 'boxes';
      ev.boxes = true;
    } else s.phase = 'spin';
    return ev;
  }

  function reveal(s, k) {
    const at = [];
    letters(s).forEach((c, i) => { if (c === k && !s.open[i]) { s.open[i] = true; at.push(i); } });
    return at;
  }

  // The wheel stopped on sector idx (game.js picks it and animates the spin).
  function spin(s, idx) {
    if (s.phase !== 'spin' || !SECTORS[idx]) return null;
    const p = s.turn, sec = SECTORS[idx];
    s.sector = idx;
    if (sec.t === 'bankrupt' || sec.t === 'zero') {
      const lost = s.score[p];
      if (sec.t === 'bankrupt') s.score[p] = 0;
      pass(s);
      return { type: sec.t, player: p, lost, next: s.turn };
    }
    s.phase = sec.t === 'plus' ? 'plus' : 'letter';
    return { type: sec.t, player: p, value: sec.v || 0 };
  }

  function letter(s, ch) {
    const k = key(ch, s.lang);
    if (s.phase !== 'letter' || !k) return null;
    const p = s.turn, sec = SECTORS[s.sector];
    if (s.used.includes(k)) { pass(s); return { type: 'repeat', letter: k, player: p, next: s.turn }; }
    s.used.push(k);
    const at = reveal(s, k);
    if (!at.length) { pass(s); return { type: 'miss', letter: k, player: p, next: s.turn }; }
    const gain = sec.t === 'double' ? s.score[p] : sec.v * at.length;
    s.score[p] += gain;
    return opened(s, { type: 'hit', letter: k, count: at.length, at, gain, double: sec.t === 'double', player: p });
  }

  // «+» sector: the player opens the letter in any closed cell.
  function openCell(s, i) {
    if (s.phase !== 'plus' || s.open[i] !== false) return null;
    const k = letters(s)[i];
    if (!s.used.includes(k)) s.used.push(k);
    const at = reveal(s, k);
    return opened(s, { type: 'plus', letter: k, count: at.length, at, player: s.turn });
  }

  // Two boxes, one holds the prize. roll in [0, 1) decides which.
  function pickBox(s, i, roll) {
    if (s.phase !== 'boxes' || (i !== 0 && i !== 1)) return null;
    const prize = roll < 0.5 ? 0 : 1, p = s.turn, win = i === prize;
    if (win) s.score[p] += BOX_PRIZE;
    s.phase = 'spin';
    return { type: 'box', player: p, win, prize, gain: win ? BOX_PRIZE : 0 };
  }

  // Naming the whole word instead of spinning. A wrong word puts the player out of the round.
  function guessWord(s, text) {
    if (s.phase !== 'spin') return null;
    const p = s.turn;
    if (normWord(text, s.lang) === letters(s).join('')) {
      winRound(s, p);
      return { type: 'word', ok: true, player: p };
    }
    s.out[p] = true;
    s.score[p] = 0;
    if (s.out.every(Boolean)) {
      s.open.fill(true);
      s.phase = 'roundEnd';
      return { type: 'word', ok: false, player: p, all: true };
    }
    pass(s);
    return { type: 'word', ok: false, player: p, next: s.turn };
  }

  // The best bank goes to the super-game; a tie goes to more rounds won, then to the earlier seat.
  function finalist(s) {
    let best = 0;
    s.players.forEach((pl, i) => {
      const b = s.players[best];
      if (pl.total > b.total || (pl.total === b.total && pl.wins > b.wins)) best = i;
    });
    return best;
  }

  function nextRound(s) {
    if (s.phase !== 'roundEnd') return;
    s.round++;
    if (s.round < s.rounds) { startRound(s); return; }
    const [word, task] = WORDS[s.lang][s.words[s.rounds]];
    Object.assign(s, {
      word, task, open: new Array([...word].length).fill(false), used: [],
      turn: finalist(s), streak: 0, sector: -1, winner: -1, phase: 'superPick',
      super: { won: null, gain: 0 },
    });
  }

  function superLetter(s, ch) {
    const k = key(ch, s.lang);
    if (s.phase !== 'superPick' || !k || s.used.includes(k)) return null;
    s.used.push(k);
    const at = reveal(s, k);
    if (s.used.length >= SUPER_LETTERS) s.phase = 'superGuess';
    return { type: 'superLetter', letter: k, count: at.length, at, player: s.turn };
  }

  // text is the answer, or '' when the time ran out.
  function superWord(s, text) {
    if (s.phase !== 'superGuess') return null;
    const p = s.turn, pl = s.players[p];
    const won = normWord(text, s.lang) === letters(s).join('');
    const gain = won ? Math.max(pl.total, SUPER_MIN) : 0;
    pl.total += gain;
    s.super = { won, gain };
    s.open.fill(true);
    s.phase = 'over';
    return { type: 'superWord', ok: won, gain, player: p };
  }

  // Players ordered by bank for the final table.
  const standings = (s) => s.players.map((pl, i) => ({ ...pl, i })).sort((a, b) => b.total - a.total || b.wins - a.wins || a.i - b.i);

  // ───────────── Bots ─────────────
  // A bot does not read the answer to choose letters: it calls common letters first. It "recognises" the word
  // with a chance that grows as the board opens, and a hasty bot can name a wrong word and drop out.
  const share = (s) => 1 - closed(s) / s.open.length;
  function nextLetter(s, R) {
    const left = [...FREQ[s.lang]].filter((c) => !s.used.includes(c));
    const r = R();
    return left[Math.min(left.length - 1, r < 0.65 ? 0 : r < 0.88 ? 1 : 2)];
  }
  function wrongWord(s, R) {
    const same = WORDS[s.lang].map((w) => w[0]).filter((w) => w !== s.word && [...w].length === s.open.length);
    const pool = same.length ? same : WORDS[s.lang].map((w) => w[0]).filter((w) => w !== s.word);
    return pool[Math.floor(R() * pool.length)];
  }
  // What the current player would do now, as { act, ... } for game.js to carry out.
  function botMove(s, R = Math.random) {
    switch (s.phase) {
      case 'spin': {
        const f = share(s), left = closed(s);
        const tryIt = left <= 1 || R() < Math.min(0.85, Math.max(0, (f - 0.45) * 1.6));
        if (!tryIt) return { act: 'spin' };
        const sure = left <= 1 || R() < 0.55 + f * 0.45;
        return { act: 'word', text: sure ? s.word : wrongWord(s, R) };
      }
      case 'letter': return { act: 'letter', ch: nextLetter(s, R) };
      case 'plus': {
        const cells = s.open.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
        return { act: 'cell', i: cells[Math.floor(R() * cells.length)] };
      }
      case 'boxes': return { act: 'box', i: R() < 0.5 ? 0 : 1 };
      case 'superPick': return { act: 'superLetter', ch: nextLetter(s, R) };
      case 'superGuess': return { act: 'superWord', text: R() < 0.2 + share(s) * 0.75 ? s.word : wrongWord(s, R) };
      default: return null;
    }
  }

  const api = {
    rng, ALPHABET, FREQ, WORDS, SECTORS, STREAK, BOX_PRIZE, SUPER_LETTERS, SUPER_SECONDS, SUPER_MIN,
    key, normWord, letters, closed, newGame, spin, letter, openCell, pickBox, guessWord, nextRound,
    superLetter, superWord, finalist, standings, botMove,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WondersCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
