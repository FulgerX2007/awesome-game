// Глубина — eat-and-grow ocean simulation. No DOM, so a bot can play it in Node.
// Everything is in world units; the camera zooms out as the player grows.
// The vertical axis is depth: five real ocean zones from the sunlit surface to the trench floor.
// Each zone has its own species, more food value and less light.
// Past the whale the game leaves biology: the last two stages are sea legends (kraken, leviathan).
(function (root) {
  'use strict';
  const I18n = typeof module === 'object' && module.exports ? require('../i18n.js') : root.I18n;

  // Size classes by absolute radius. speed is relative to the player's speed at the same size.
  const KINDS = [
    { id: 'plankton', max: 2.5, speed: 0.15 },
    { id: 'cell', max: 6, speed: 0.45 },
    { id: 'krill', max: 14, speed: 0.6, flee: true },
    { id: 'minnow', max: 30, speed: 0.75, flee: true, school: true },
    { id: 'fish', max: 70, speed: 0.78, flee: true, hunter: true },
    { id: 'squid', max: 150, speed: 0.8, flee: true, hunter: true },
    { id: 'shark', max: 330, speed: 0.82, hunter: true },
    { id: 'whale', max: 700, speed: 0.4 },
    { id: 'kraken', max: 1500, speed: 0.82, flee: true, hunter: true },
    { id: 'leviathan', max: Infinity, speed: 0.45 },
  ];
  const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));

  // Ocean zones. Depth is a progress value d in [0, 5]: zone i spans [i, i + 1).
  const ZONES = [
    { id: 'sunlit', name: 'Солнечная зона', top: 0, dark: 0, gain: 1, hunters: 3, food: 32,
      text: 'Свет, тепло и больше всего жизни.' },
    { id: 'twilight', name: 'Сумеречная зона', top: 200, dark: 0.5, gain: 1.25, hunters: 3, food: 34,
      text: 'Синий полумрак. Многие здесь светятся сами.' },
    { id: 'midnight', name: 'Полночная зона', top: 1000, dark: 0.9, gain: 1.5, hunters: 4, food: 36,
      text: 'Солнце сюда не доходит. Видно только тех, кто светится, и того, кто рядом.' },
    { id: 'abyss', name: 'Бездна', top: 4000, dark: 0.95, gain: 1.75, hunters: 4, food: 36,
      text: 'Холод и давление в сотни атмосфер. Еда редкая, но сытная.' },
    { id: 'trench', name: 'Глубоководный жёлоб', top: 6000, dark: 0.96, gain: 2, hunters: 5, food: 38,
      text: 'Самое дно океана. Сюда добирались единицы.' },
  ];
  const FLOOR_M = 10994; // Challenger Deep
  const MAX_DEPTH = ZONES.length;
  const ZONE_SWIM = 28; // seconds of straight diving at full speed to cross one zone, at any size

  // Real species. cls is the size class; zones lists where they live; the rest overrides class traits.
  // glow: bioluminescent (seen in the dark); lure: anglerfish bait; ambush: waits, then lunges.
  // legend: a creature from sea tales, not a real species (the fact tells what sailors may have seen).
  const SPECIES = [
    { id: 'diatom', cls: 'plankton', zones: [0], name: 'Диатомея',
      fact: 'Одноклеточная водоросль в стеклянном панцире. Диатомеи дают около пятой части всего кислорода Земли.' },
    { id: 'noctiluca', cls: 'plankton', zones: [0], glow: true, name: 'Ночесветка',
      fact: 'Из-за неё ночью светятся волны: клетка вспыхивает голубым, когда её тревожат.' },
    { id: 'snow', cls: 'plankton', zones: [1, 2, 3, 4], name: 'Морской снег',
      fact: 'Хлопья органики, которые медленно падают сверху. Для бездны это главная еда, путь на дно занимает недели.' },
    { id: 'ciliate', cls: 'cell', zones: [0], name: 'Морская инфузория',
      fact: 'Плавает тысячами ресничек. Некоторые морские инфузории глотают водоросли и оставляют себе их хлоропласты: те продолжают работать и кормят хозяина светом.' },
    { id: 'radiolarian', cls: 'cell', zones: [1, 2], name: 'Радиолярия',
      fact: 'Строит кружевной скелет из кремнезёма. Из таких скелетов сложены целые горные породы.' },
    { id: 'foram', cls: 'cell', zones: [3], name: 'Фораминифера',
      fact: 'Клетка в спиральной раковине из камер. Ракушки фораминифер есть в известняке пирамид.' },
    { id: 'xeno', cls: 'cell', zones: [4], name: 'Ксенофиофора',
      fact: 'Одна клетка размером с ладонь. Живёт даже на дне Марианской впадины.' },
    { id: 'copepod', cls: 'krill', zones: [0], name: 'Веслоногий рачок',
      fact: 'Самое многочисленное животное на планете. Прыгает на сотни длин тела в секунду.' },
    { id: 'krill', cls: 'krill', zones: [0, 1], name: 'Антарктический криль',
      fact: 'Весь антарктический криль весит примерно столько же, сколько всё человечество. Им питаются киты.' },
    { id: 'shrimp', cls: 'krill', zones: [2], glow: true, name: 'Глубоководная креветка',
      fact: 'Защищаясь, выплёвывает облако светящейся слизи прямо в морду хищнику.' },
    { id: 'amphipod', cls: 'krill', zones: [3, 4], name: 'Бокоплав',
      fact: 'Падальщик бездны. Бокоплавы находят упавшую на дно рыбу за считанные часы.' },
    { id: 'yeti', cls: 'krill', zones: [2], name: 'Краб-йети',
      fact: 'Весь в «шерсти» и почти слепой. Живёт у горячих источников на дне, машет клешнями над их водой и выращивает на волосках бактерий, которых потом ест.' },
    { id: 'anchovy', cls: 'minnow', zones: [0], name: 'Анчоус',
      fact: 'Плавает огромными косяками: так хищнику труднее выбрать одну рыбку.' },
    { id: 'lanternfish', cls: 'minnow', zones: [1, 2], glow: true, name: 'Рыба-фонарь',
      fact: 'Каждую ночь поднимается к поверхности за едой, а днём уходит на глубину. Это самая большая миграция на Земле.' },
    { id: 'hatchetfish', cls: 'minnow', zones: [1, 2], glow: true, name: 'Рыба-топорик',
      fact: 'Светится брюхом ровно так же, как свет сверху, поэтому снизу её не видно.' },
    { id: 'snailfish', cls: 'minnow', zones: [3, 4], name: 'Морской слизень',
      fact: 'Рыба-рекордсмен: её снимали на глубине 8 336 метров.' },
    { id: 'barreleye', cls: 'minnow', zones: [1], name: 'Бочкоглаз',
      fact: 'Голова прозрачная, как кабина вертолёта. Зелёные глаза-трубки внутри неё поворачиваются вверх и вперёд, а две тёмные точки над ртом — это ноздри.' },
    { id: 'seapig', cls: 'minnow', zones: [3], name: 'Морская свинья',
      fact: 'Это голотурия, родственница морских звёзд. Ходит по дну на ножках-трубочках и ест ил, а целые стада собираются там, куда упало что-нибудь съедобное.' },
    { id: 'mackerel', cls: 'fish', zones: [0], name: 'Скумбрия',
      fact: 'Не может остановиться: чтобы дышать, ей нужно всё время плыть.' },
    { id: 'moonjelly', cls: 'fish', zones: [0, 1], jelly: true, name: 'Медуза-аурелия',
      fact: 'У неё нет мозга, сердца и костей, а тело на 98% состоит из воды.' },
    { id: 'combjelly', cls: 'fish', zones: [1, 2], jelly: true, glow: true, name: 'Гребневик',
      fact: 'Ряды крошечных гребней переливаются радугой. По последним данным, гребневики — одна из самых древних ветвей животных.' },
    { id: 'viperfish', cls: 'fish', zones: [1, 2], glow: true, name: 'Рыба-гадюка',
      fact: 'Зубы такие длинные, что не помещаются в пасти и торчат наружу.' },
    { id: 'angler', cls: 'fish', zones: [2, 3], glow: true, lure: true, ambush: true, name: 'Удильщик',
      fact: 'Висит в темноте неподвижно и приманивает добычу светящейся «удочкой» на лбу. Не плыви на одинокий огонёк.' },
    { id: 'tripod', cls: 'fish', zones: [2, 3], flee: true, hunter: false, name: 'Рыба-тренога',
      fact: 'Стоит на дне на трёх длинных лучах плавников, как на ходулях, и ждёт, что принесёт течение.' },
    { id: 'fangtooth', cls: 'fish', zones: [2, 3], name: 'Саблезуб',
      fact: 'У него самые большие зубы относительно тела среди всех рыб. Чтобы закрыть пасть, длинные нижние клыки уходят в особые карманы по бокам мозга.' },
    { id: 'atolla', cls: 'fish', zones: [2, 3], jelly: true, glow: true, name: 'Медуза-атолла',
      fact: 'Когда её хватают, по куполу бегут синие огни. Это «охранная сигнализация»: свет зовёт хищника покрупнее, чтобы тот спугнул обидчика.' },
    { id: 'abysso', cls: 'fish', zones: [3, 4], name: 'Абиссобротула',
      fact: 'Её подняли тралом с глубины 8 370 метров в жёлобе Пуэрто-Рико: глубже рыбу не ловили ни разу.' },
    { id: 'squid', cls: 'squid', zones: [0, 1], name: 'Кальмар',
      fact: 'Плавает реактивно: набирает воду в мантию и с силой выталкивает её.' },
    { id: 'vampire', cls: 'squid', zones: [1, 2], glow: true, hunter: false, name: 'Адский вампир',
      fact: 'Несмотря на имя, ест морской снег. При опасности выворачивается плащом наизнанку.' },
    { id: 'gulper', cls: 'squid', zones: [2, 3], glow: true, name: 'Большерот',
      fact: 'Пасть больше всего остального тела и раскрывается, как сачок, но ловит он ею в основном мелких рачков. Кончик хвоста светится.' },
    { id: 'dumbo', cls: 'squid', zones: [3, 4], hunter: false, name: 'Осьминог-дамбо',
      fact: 'Машет плавниками, похожими на уши слонёнка. Живёт глубже всех осьминогов.' },
    { id: 'leatherback', cls: 'squid', zones: [0, 1], hunter: false, name: 'Кожистая черепаха',
      fact: 'Самая большая черепаха на свете: до 2 метров и 900 кг. Вместо твёрдого панциря у неё кожа с семью гребнями. Ныряет глубже километра и ест медуз.' },
    { id: 'shark', cls: 'shark', zones: [0, 1], name: 'Синяя акула',
      fact: 'Проплывает тысячи километров вслед за косяками рыб.' },
    { id: 'goblin', cls: 'shark', zones: [1, 2], name: 'Акула-домовой',
      fact: 'Выстреливает челюсти вперёд, чтобы схватить добычу. Розовая, потому что сквозь кожу видны сосуды.' },
    { id: 'giantsquid', cls: 'shark', zones: [1, 2], name: 'Гигантский кальмар',
      fact: 'Глаза размером с футбольный мяч, одни из самых больших в животном мире. Живым его впервые сфотографировали только в 2004 году.' },
    { id: 'orca', cls: 'shark', zones: [0], name: 'Косатка',
      fact: 'Самый крупный дельфин. Семьи косаток охотятся сообща, и у каждой популяции свой «диалект» звуков и свои охотничьи приёмы.' },
    { id: 'sunfish', cls: 'shark', zones: [0, 1], hunter: false, flee: true, name: 'Рыба-луна',
      fact: 'Самая тяжёлая костная рыба: больше 2 тонн. После охоты в холодной глубине поднимается к поверхности и греется на солнце, лёжа на боку.' },
    { id: 'manta', cls: 'shark', zones: [0, 1], hunter: false, flee: true, name: 'Манта',
      fact: 'Скат с размахом «крыльев» до 7 метров. У манты один из самых крупных мозгов среди рыб, и, похоже, она узнаёт себя в зеркале.' },
    { id: 'frilled', cls: 'shark', zones: [1, 2], name: 'Плащеносная акула',
      fact: 'Живое ископаемое: почти не изменилась за 80 миллионов лет. Жабры с оборками, сотни зубов-трезубцев, а беременность длится больше трёх лет.' },
    { id: 'colossal', cls: 'shark', zones: [2], name: 'Колоссальный кальмар',
      fact: 'Самое тяжёлое беспозвоночное, до 500 кг. На щупальцах у него, кроме присосок, вращающиеся крючья, а глаза — самые большие в животном мире.' },
    { id: 'humpback', cls: 'whale', zones: [0, 1], name: 'Горбатый кит',
      fact: 'Самцы поют песни длиной до получаса, и вся популяция со временем меняет мелодию вместе.' },
    { id: 'sperm', cls: 'whale', zones: [0, 1, 2], name: 'Кашалот',
      fact: 'Ныряет на 2 км за гигантскими кальмарами и задерживает дыхание на час.' },
    { id: 'siphonophore', cls: 'whale', zones: [1, 2], glow: true, hunter: false, name: 'Сифонофора',
      fact: 'Колония из тысяч крошечных существ, вытянутая на 40 метров. Одно из самых длинных животных в мире.' },
    { id: 'bluewhale', cls: 'whale', zones: [0, 1], name: 'Синий кит',
      fact: 'Самое большое животное за всю историю Земли: до 30 метров и 150 тонн. А ест почти один криль — тонны рачков в день.' },
    { id: 'serpent', cls: 'kraken', zones: [0, 1, 2], legend: true, name: 'Морской змей',
      fact: 'О нём рассказывали моряки всех морей. Часто за змея принимали сельдяного короля — настоящую рыбу длиной до 8 метров с красным гребнем.' },
    { id: 'kraken', cls: 'kraken', zones: [2, 3, 4], legend: true, glow: true, name: 'Кракен',
      fact: 'Чудовище из скандинавских легенд, которое утаскивает корабли на дно. Скорее всего, моряки видели гигантского кальмара.' },
    { id: 'aspidochelone', cls: 'leviathan', zones: [0, 1], legend: true, hunter: false, name: 'Аспидохелон',
      fact: 'Из средневековых бестиариев: черепаха такого размера, что моряки принимали её спину за остров, высаживались и разводили костёр.' },
    { id: 'leviathan', cls: 'leviathan', zones: [2, 3, 4], legend: true, glow: true, hunter: false, name: 'Левиафан',
      fact: 'Морское чудовище из Библии: «нет на земле подобного ему». В его честь назван ископаемый кашалот Livyatan, который охотился на китов 9 миллионов лет назад.' },
  ];
  const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
  // Species whose painted atlas card (web/deep/art/<id>.webp) is not drawn yet; the atlas shows their model.
  const ART_PENDING = new Set(['yeti', 'seapig', 'atolla', 'leatherback', 'manta', 'colossal']);
  const hasArt = (id) => !ART_PENDING.has(id);
  // The player's own body at each stage.
  const STAGES = [
    { kind: 'cell', species: 'ciliate', name: 'Клетка', from: 0 },
    { kind: 'krill', species: 'krill', name: 'Рачок', from: 6 },
    { kind: 'minnow', species: 'anchovy', name: 'Малёк', from: 14 },
    { kind: 'fish', species: 'mackerel', name: 'Рыба', from: 30 },
    { kind: 'squid', species: 'squid', name: 'Кальмар', from: 70 },
    { kind: 'shark', species: 'shark', name: 'Акула', from: 150 },
    { kind: 'whale', species: 'humpback', name: 'Кит', from: 330 },
    { kind: 'kraken', species: 'kraken', name: 'Кракен', from: 700 },
    { kind: 'leviathan', species: 'leviathan', name: 'Левиафан', from: 1500 },
  ];
  const START_R = 3;
  const MAX_R = 3000;       // about 400 m: growth stops at a leviathan out of legend
  const EAT_RATIO = 1.12;   // must be this much bigger to swallow
  const GAIN = 0.5;         // share of prey mass you keep
  const DASH_TIME = 0.6, DASH_COOLDOWN = 3, DASH_MULT = 2.3;
  const CHASE_LIMIT = 4.5, REST_TIME = 3;
  const LUNGE_TIME = 1.1, LUNGE_MULT = 1.9;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const zoneAt = (d) => clamp(Math.floor(d), 0, ZONES.length - 1);
  function metersAt(d) {
    const z = zoneAt(d), top = ZONES[z].top, bottom = z + 1 < ZONES.length ? ZONES[z + 1].top : FLOOR_M;
    return top + (bottom - top) * clamp(d - z, 0, 1);
  }
  // Darkness 0..1, smoothly blended across zone borders.
  function darkAt(d) {
    const z = zoneAt(d), k = clamp(d - z, 0, 1);
    const next = ZONES[Math.min(z + 1, ZONES.length - 1)].dark;
    return ZONES[z].dark + (next - ZONES[z].dark) * k * k;
  }

  const classOf = (r) => (KINDS.find((x) => r < x.max) || KINDS[KINDS.length - 1]).id;
  // A species of the right size for this depth. Classes missing from a zone borrow from the zone above.
  function speciesFor(r, d, R) {
    const cls = classOf(r);
    for (let z = zoneAt(d); z >= 0; z--) {
      const list = SPECIES.filter((s) => s.cls === cls && s.zones.includes(z));
      if (list.length) return list[Math.floor(R() * list.length)];
    }
    return SPECIES.find((s) => s.cls === cls);
  }
  // Class traits with species overrides. Jellies drift; ambushers barely move until they lunge.
  function traits(e) {
    const sp = SPECIES_BY_ID[e.sp], k = KIND[sp.cls];
    return {
      speed: sp.jelly ? 0.3 : sp.ambush ? 0.35 : k.speed,
      flee: sp.flee ?? (!sp.jelly && !!k.flee),
      hunter: sp.hunter ?? (!sp.jelly && !!k.hunter),
      school: !!k.school, glow: !!sp.glow, ambush: !!sp.ambush,
    };
  }
  const isHunter = (e) => traits(e).hunter;
  const stageOf = (r) => { let s = 0; STAGES.forEach((st, i) => { if (r >= st.from) s = i; }); return s; };
  const baseSpeed = (r) => 90 * (r / 4) ** 0.7;
  // World height that fits on screen for a player of radius r.
  const viewSize = (r) => 170 * (Math.max(r, START_R) / 4) ** 0.85;
  // World units per unit of depth progress, at the player's current size.
  const depthScale = (p) => ZONE_SWIM * baseSpeed(p.r);
  const depthOf = (w, y) => w.player.depth + (y - w.player.y) / depthScale(w.player);
  // How far the player sees in the dark, in world units.
  const lightRadius = (p) => p.r * 5 + viewSize(p.r) * 0.12;

  // Real-world length for the HUD, a power law between knots at the stage borders, so each stage
  // spans its body's real sizes: a 10 µm cell, krill up to 2 cm, an anchovy up to 8 cm, a mackerel
  // up to 40 cm, a squid up to 1.5 m, a shark up to 6 m, a whale up to 30 m (a blue whale),
  // then the legends: the kraken to 140 m, the leviathan to 400 m.
  const LEN_KNOTS = [[START_R, 1e-5], [6, 2e-4], [14, 0.02], [30, 0.08], [70, 0.4], [150, 1.5], [330, 6], [700, 30], [1500, 140], [MAX_R, 400]];
  function lengthMeters(r) {
    let i = 0;
    while (i < LEN_KNOTS.length - 2 && r > LEN_KNOTS[i + 1][0]) i++;
    const [r0, m0] = LEN_KNOTS[i], [r1, m1] = LEN_KNOTS[i + 1];
    return m0 * (r / r0) ** (Math.log(m1 / m0) / Math.log(r1 / r0));
  }
  function lengthText(r) {
    const m = lengthMeters(r);
    const f = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace('.', ',');
    if (m < 1e-3) return I18n.t('{n} мкм', { n: f(m * 1e6) });
    if (m < 1e-2) return I18n.t('{n} мм', { n: f(m * 1e3) });
    if (m < 1) return I18n.t('{n} см', { n: f(m * 1e2) });
    return I18n.t('{n} м', { n: f(m) });
  }

  function createWorld(seed, r0 = START_R, depth = 0.15) {
    const w = {
      R: rng(seed), time: 0, nextId: 1, ents: [], events: [], deaths: 0,
      player: { x: 0, y: 0, vx: 0, vy: 0, r: r0, peak: r0, angle: 0, dashT: 0, dashCD: 0, invuln: 2, stage: stageOf(r0),
        depth: clamp(depth, 0, MAX_DEPTH - 0.02), zone: zoneAt(depth), maxZone: zoneAt(depth) },
    };
    populate(w, true);
    return w;
  }

  function spawn(w, r, near) {
    const p = w.player, V = viewSize(p.r);
    const a = w.R() * Math.PI * 2;
    const dd = near ? V * (0.35 + w.R() * 1.5) : V * (1.15 + w.R() * 0.75);
    const x = p.x + Math.cos(a) * dd, y = p.y + Math.sin(a) * dd;
    // Nothing lives above the surface or below the floor, so the water there is just emptier.
    const top = p.y - p.depth * depthScale(p), floor = p.y + (MAX_DEPTH - p.depth) * depthScale(p);
    if (y < top + r || y > floor - r) return null;
    const sp = speciesFor(r, depthOf(w, y), w.R);
    const e = {
      id: w.nextId++, sp: sp.id, cls: sp.cls, r, x, y,
      vx: 0, vy: 0, angle: w.R() * Math.PI * 2, heading: w.R() * Math.PI * 2,
      mode: 'wander', target: null, think: w.R() * 0.3, chase: 0, rest: 0, lunge: 0, hue: w.R(), phase: w.R() * 6, met: false,
    };
    // Don't drop a hungry hunter right on top of the player.
    if (traits(e).hunter && r > p.r && Math.hypot(e.x - p.x, e.y - p.y) < V * 0.9) return null;
    w.ents.push(e);
    return e;
  }

  // Keep a steady population around the player, sized relative to the player and shaped by the zone.
  function populate(w, initial) {
    const p = w.player, V = viewSize(p.r), Z = ZONES[p.zone];
    w.ents = w.ents.filter((e) => Math.hypot(e.x - p.x, e.y - p.y) < V * 2.3);
    let food = 0, others = 0, bigHunters = 0;
    for (const e of w.ents) {
      if (e.r < p.r * 0.45) food++; else others++;
      if (isHunter(e) && e.r > p.r * EAT_RATIO) bigHunters++;
    }
    for (let guard = 0; food < Z.food && guard < 200; guard++) if (spawn(w, p.r * (0.25 + w.R() * 0.3), initial)) food++;
    for (let guard = 0; others < 34 && guard < 200; guard++) {
      const roll = w.R();
      let r;
      if (roll < 0.5) r = p.r * (0.45 + w.R() * 0.4);
      else if (roll < 0.7) r = p.r * (0.85 + w.R() * 0.4);
      else r = p.r * (1.3 + w.R() * 2.4);
      const e = spawn(w, r, initial);
      if (!e) continue;
      if (isHunter(e) && r > p.r * EAT_RATIO) {
        if (bigHunters >= Z.hunters) { w.ents.pop(); continue; }
        bigHunters++;
      }
      others++;
    }
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function think(w, e) {
    const p = w.player, t = traits(e);
    const sense = e.r * 7 + 80;
    if (e.lunge > 0) return;
    e.mode = 'wander'; e.target = null;
    if (t.flee) {
      let threat = null, td = Infinity;
      const check = (o) => {
        if (o === e || o.r <= e.r * EAT_RATIO) return;
        if (o !== p && !isHunter(o)) return;
        const d = dist(o, e);
        if (d < sense && d < td) { threat = o; td = d; }
      };
      check(p);
      for (const o of w.ents) check(o);
      if (threat) { e.mode = 'flee'; e.target = threat; return; }
    }
    if (t.hunter && e.rest <= 0) {
      // Ambushers only strike at what swims right up to them.
      const reach = t.ambush ? e.r * 4 : sense;
      let prey = null, pd = Infinity;
      const check = (o) => {
        if (o === e || e.r <= o.r * EAT_RATIO) return;
        const d = dist(o, e);
        if (d < reach && d < pd) { prey = o; pd = d; }
      };
      if (p.invuln <= 0) check(p);
      for (const o of w.ents) check(o);
      if (prey) {
        e.mode = 'hunt'; e.target = prey;
        if (t.ambush) e.lunge = LUNGE_TIME;
      }
    }
  }

  function moveEntity(w, e, dt) {
    const t = traits(e);
    e.think -= dt;
    if (e.think <= 0) { e.think = 0.25 + w.R() * 0.15; think(w, e); }
    if (e.target && e.target !== w.player && !w.ents.includes(e.target)) { e.target = null; e.mode = 'wander'; }
    let speed = baseSpeed(e.r) * t.speed;
    let dirX, dirY;
    if (e.lunge > 0) {
      e.lunge -= dt;
      if (e.lunge <= 0) { e.rest = REST_TIME; e.mode = 'wander'; e.target = null; }
      speed = baseSpeed(e.r) * LUNGE_MULT;
    }
    if (e.mode === 'flee' && e.target) {
      dirX = e.x - e.target.x; dirY = e.y - e.target.y;
    } else if (e.mode === 'hunt' && e.target) {
      e.chase += dt;
      if (e.chase > CHASE_LIMIT) { e.rest = REST_TIME; e.chase = 0; e.mode = 'wander'; e.target = null; }
      dirX = (e.target?.x ?? e.x) - e.x; dirY = (e.target?.y ?? e.y) - e.y;
      speed *= 0.95;
    } else {
      e.heading += (w.R() - 0.5) * dt * 2;
      dirX = Math.cos(e.heading); dirY = Math.sin(e.heading);
      const drift = e.cls === 'plankton' || e.cls === 'whale' || e.cls === 'leviathan' || SPECIES_BY_ID[e.sp].jelly;
      speed *= t.ambush ? 0.1 : drift ? 0.6 : 0.35;
    }
    if (e.rest > 0) { e.rest -= dt; speed *= 0.5; }
    // Turn back at the surface and the floor.
    const ed = depthOf(w, e.y);
    if (ed < 0.02 && dirY < 0) { dirY = Math.abs(dirY) + 0.3; e.heading = Math.abs(e.heading) % Math.PI; }
    if (ed > MAX_DEPTH - 0.02 && dirY > 0) { dirY = -Math.abs(dirY) - 0.3; e.heading = -Math.abs(e.heading) % Math.PI; }
    const len = Math.hypot(dirX, dirY) || 1;
    const k = 1 - Math.exp(-dt * 3);
    e.vx += ((dirX / len) * speed - e.vx) * k;
    e.vy += ((dirY / len) * speed - e.vy) * k;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (Math.hypot(e.vx, e.vy) > 1) e.angle = Math.atan2(e.vy, e.vx);
    e.phase += dt * (2 + Math.hypot(e.vx, e.vy) / (e.r + 4));
  }

  function grow(p, prey, gain) {
    p.r = Math.min(MAX_R, Math.sqrt(p.r * p.r + prey.r * prey.r * GAIN * gain));
    p.peak = Math.max(p.peak, p.r);
  }

  // Can the player make this creature out right now? Glowing ones are visible from afar in the dark.
  function visible(w, e) {
    const p = w.player, d = dist(p, e);
    if (d > viewSize(p.r) * 0.55) return false;
    return darkAt(p.depth) < 0.6 || traits(e).glow || d < lightRadius(p) + e.r;
  }

  // input: { tx, ty } point to swim toward (world), or null to drift; dash: boolean.
  function step(w, dt, input) {
    const p = w.player;
    w.time += dt;
    p.invuln = Math.max(0, p.invuln - dt);
    p.dashCD = Math.max(0, p.dashCD - dt);
    p.dashT = Math.max(0, p.dashT - dt);
    if (input?.dash && p.dashCD <= 0) { p.dashT = DASH_TIME; p.dashCD = DASH_COOLDOWN; w.events.push({ type: 'dash' }); }

    let ax = 0, ay = 0;
    if (input && input.tx !== undefined) {
      const dx = input.tx - p.x, dy = input.ty - p.y, d = Math.hypot(dx, dy);
      if (d > 0.5) { const f = Math.min(1, d / (p.r * 2.5)); ax = (dx / d) * f; ay = (dy / d) * f; }
    }
    const max = baseSpeed(p.r) * (p.dashT > 0 ? DASH_MULT : 1);
    const k = 1 - Math.exp(-dt * 4);
    p.vx += (ax * max - p.vx) * k; p.vy += (ay * max - p.vy) * k;
    // The surface and the trench floor stop you.
    const dy = p.vy * dt / depthScale(p);
    if (p.depth + dy < 0 || p.depth + dy > MAX_DEPTH - 0.02) p.vy = 0;
    p.depth = clamp(p.depth + p.vy * dt / depthScale(p), 0, MAX_DEPTH - 0.02);
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (Math.hypot(p.vx, p.vy) > 2) p.angle = Math.atan2(p.vy, p.vx);
    const zone = zoneAt(p.depth);
    if (zone !== p.zone) {
      w.events.push({ type: 'zone', zone, first: zone > p.maxZone, down: zone > p.zone });
      p.zone = zone; p.maxZone = Math.max(p.maxZone, zone);
    }

    for (const e of w.ents) moveEntity(w, e, dt);

    // Who eats whom.
    const eaten = new Set();
    const gain = ZONES[p.zone].gain;
    for (const e of w.ents) {
      if (!e.met && visible(w, e)) { e.met = true; w.events.push({ type: 'meet', sp: e.sp }); }
      const d = dist(p, e);
      if (p.r > e.r * EAT_RATIO && d < p.r) {
        eaten.add(e); grow(p, e, gain);
        w.events.push({ type: 'eat', r: e.r, sp: e.sp, x: e.x, y: e.y, pct: p.r >= MAX_R ? 0 : e.r * e.r * GAIN * gain / stageArea(p.stage) * 100 });
      } else if (isHunter(e) && e.r > p.r * EAT_RATIO && d < e.r && p.invuln <= 0) {
        die(w, e);
        break;
      }
    }
    for (const h of w.ents) {
      if (!isHunter(h) || eaten.has(h) || h.mode !== 'hunt') continue;
      for (const o of w.ents) {
        if (o === h || eaten.has(o) || h.r <= o.r * EAT_RATIO) continue;
        if (dist(h, o) < h.r) { eaten.add(o); h.mode = 'wander'; h.target = null; break; }
      }
    }
    if (eaten.size) w.ents = w.ents.filter((e) => !eaten.has(e));

    const st = stageOf(p.r);
    if (st > p.stage) { p.stage = st; w.events.push({ type: 'stage', stage: st }); }
    if (st < p.stage) p.stage = st;
    populate(w, false);
  }

  // Growth inside a stage, by mass (r²), so every bite of the same size moves the bar the same amount.
  // The last stage grows towards MAX_R.
  const stageEnd = (i) => (i + 1 < STAGES.length ? STAGES[i + 1].from : MAX_R);
  const stageStart = (i) => (i === 0 ? START_R : STAGES[i].from);
  const stageArea = (i) => stageEnd(i) ** 2 - stageStart(i) ** 2;
  function progress(r) {
    const i = stageOf(r);
    return { stage: i, next: i + 1 < STAGES.length ? i + 1 : null, k: clamp((r * r - stageStart(i) ** 2) / stageArea(i), 0, 1) };
  }

  // Being eaten costs half your mass, never the run.
  function die(w, killer) {
    const p = w.player;
    w.deaths++;
    w.events.push({ type: 'death', x: p.x, y: p.y, by: killer.sp });
    p.r = Math.max(START_R, p.r / Math.SQRT2);
    p.invuln = 3; p.vx = p.vy = 0;
    p.stage = stageOf(p.r);
    const V = viewSize(p.r);
    w.ents = w.ents.filter((e) => !(isHunter(e) && e.r > p.r && dist(e, p) < V * 1.5));
  }

  const api = {
    KINDS, STAGES, ZONES, SPECIES, SPECIES_BY_ID, START_R, MAX_R, EAT_RATIO, DASH_COOLDOWN, MAX_DEPTH, FLOOR_M,
    rng, createWorld, step, stageOf, progress, viewSize, baseSpeed, lengthMeters, lengthText, traits, isHunter,
    zoneAt, metersAt, darkAt, depthScale, lightRadius, speciesFor, hasArt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeepCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
