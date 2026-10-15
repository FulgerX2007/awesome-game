// Путь героя — game data only: items, enemies, bosses, perks, titles and permanent upgrades. Names are the Russian
// source strings (lang.js translates them). Numbers are tier-1 values; HeroCore scales items by tier.
(function (root) {
  'use strict';

  const TYPES = ['phys', 'fire', 'ice', 'holy'];

  // slot: weapon | armor | charm. Weapons: dmg per hit, interval (s), traits: keen (ignores dodge), cleave (half the
  // hit to the next enemy), lifesteal (heals 15% of the hit), chill (slows the target 25% for 2 s).
  // Armour: armor (physical), ward (magic), hp. Charms: spell, power, cd (s).
  // pool: the acts where the item can drop from chests and shops (start items have none).
  const ITEMS = {
    rusty_sword: { slot: 'weapon', name: 'Ржавый меч', type: 'phys', dmg: 5, interval: 1.0, traits: [], pool: [] },
    sword: { slot: 'weapon', name: 'Стальной меч', type: 'phys', dmg: 5.5, interval: 1.0, traits: [], pool: [1, 2] },
    axe: { slot: 'weapon', name: 'Тяжёлый топор', type: 'phys', dmg: 8, interval: 1.45, traits: ['cleave'], pool: [1, 2, 3] },
    dagger: { slot: 'weapon', name: 'Кинжал ловкача', type: 'phys', dmg: 3, interval: 0.55, traits: ['keen'], pool: [1, 2, 3] },
    spear: { slot: 'weapon', name: 'Копьё охотника', type: 'phys', dmg: 5, interval: 0.95, traits: ['keen'], pool: [1, 2, 3] },
    sickle: { slot: 'weapon', name: 'Кровавый серп', type: 'phys', dmg: 4.5, interval: 0.9, traits: ['lifesteal'], pool: [2, 3] },
    flame_blade: { slot: 'weapon', name: 'Огненный клинок', type: 'fire', dmg: 5, interval: 1.0, traits: [], pool: [1, 2, 3] },
    ember_axe: { slot: 'weapon', name: 'Пылающая секира', type: 'fire', dmg: 7.5, interval: 1.45, traits: ['cleave'], pool: [2, 3] },
    frost_staff: { slot: 'weapon', name: 'Морозный посох', type: 'ice', dmg: 5, interval: 1.1, traits: ['chill'], pool: [1, 2, 3] },
    ice_lance: { slot: 'weapon', name: 'Ледяное копьё', type: 'ice', dmg: 4.5, interval: 0.9, traits: ['keen'], pool: [2, 3] },
    sun_mace: { slot: 'weapon', name: 'Солнечная булава', type: 'holy', dmg: 5, interval: 1.0, traits: [], pool: [1, 2, 3] },
    holy_hammer: { slot: 'weapon', name: 'Молот света', type: 'holy', dmg: 8, interval: 1.45, traits: ['cleave'], pool: [2, 3] },

    leather: { slot: 'armor', name: 'Кожаная куртка', armor: 12, ward: 4, hp: 6, pool: [1, 2] },
    chain: { slot: 'armor', name: 'Кольчуга', armor: 24, ward: 6, hp: 8, pool: [1, 2, 3] },
    plate: { slot: 'armor', name: 'Латы', armor: 40, ward: 4, hp: 14, pool: [2, 3] },
    robe: { slot: 'armor', name: 'Мантия мага', armor: 6, ward: 34, hp: 6, pool: [1, 2, 3] },
    fur: { slot: 'armor', name: 'Меховой плащ', armor: 16, ward: 16, hp: 10, pool: [1, 2, 3] },
    scale: { slot: 'armor', name: 'Драконья чешуя', armor: 32, ward: 30, hp: 16, pool: [3] },

    fire_orb: { slot: 'charm', name: 'Огненная сфера', spell: 'fireball', type: 'fire', power: 10, cd: 6, pool: [1, 2, 3] },
    frost_amulet: { slot: 'charm', name: 'Амулет стужи', spell: 'nova', type: 'ice', power: 4, cd: 8, pool: [1, 2, 3] },
    heal_stone: { slot: 'charm', name: 'Камень жизни', spell: 'heal', power: 0.12, cd: 7, pool: [1, 2, 3] },
    sun_charm: { slot: 'charm', name: 'Знак солнца', spell: 'smite', type: 'holy', power: 13, cd: 7, pool: [2, 3] },
  };

  // The start weapon for each permanent «Оружейная» level, in unlock order.
  const ARMORY = ['flame_blade', 'frost_staff', 'sun_mace'];

  const res = (o) => Object.assign({ phys: 1, fire: 1, ice: 1, holy: 1 }, o);

  // Enemies. hp, dmg per hit, interval (s), dmgType, res multipliers, traits: dodge (chance), regen (HP/s),
  // thorns (share of melee damage reflected), shield (hits absorbed). xp and gold are the rewards.
  const ENEMIES = {
    wolf: { name: 'Волк', act: 1, hp: 18, dmg: 3, interval: 1.3, dmgType: 'phys', res: res(), xp: 6, gold: 4 },
    bandit: { name: 'Разбойник', act: 1, hp: 22, dmg: 3, interval: 1.3, dmgType: 'phys', res: res(), dodge: 0.3, xp: 7, gold: 7 },
    slime: { name: 'Слизень', act: 1, hp: 28, dmg: 2, interval: 1.4, dmgType: 'phys', res: res(), regen: 1.5, xp: 7, gold: 4 },
    skeleton: { name: 'Скелет-латник', act: 2, hp: 52, dmg: 8, interval: 1.2, dmgType: 'phys', res: res({ phys: 0.4, holy: 2 }), xp: 12, gold: 8 },
    ghost: { name: 'Призрак', act: 2, hp: 40, dmg: 7, interval: 1.1, dmgType: 'ice', res: res({ phys: 0.15, holy: 2 }), xp: 12, gold: 8 },
    troll: { name: 'Тролль', act: 2, hp: 84, dmg: 10, interval: 1.5, dmgType: 'phys', res: res(), regen: 4, xp: 14, gold: 10 },
    imp: { name: 'Бесёнок', act: 3, hp: 54, dmg: 9, interval: 0.8, dmgType: 'fire', res: res({ fire: 0, ice: 2 }), dodge: 0.25, xp: 18, gold: 11 },
    golem: { name: 'Лавовый голем', act: 3, hp: 125, dmg: 14, interval: 1.6, dmgType: 'fire', res: res({ phys: 0.5, fire: 0, ice: 2 }), thorns: 0.2, xp: 22, gold: 14 },
    knight: { name: 'Чёрный рыцарь', act: 3, hp: 115, dmg: 13, interval: 1.3, dmgType: 'phys', res: res({ phys: 0.6 }), shield: 3, xp: 22, gold: 14 },
  };

  // Elites: the act's enemy with more HP and damage and one extra trait (drawn from this list).
  const ELITE = { hp: 1.9, dmg: 1.3, xp: 2.5, gold: 2.5, traits: [{ thorns: 0.2 }, { shield: 2 }, { regen: 3 }, { dodge: 0.2 }] };

  // Bosses. phases: from `at` (share of max HP) and down, the boss takes these res and deals this dmgType.
  // summon: a kind called every `every` s while fewer than `max` of them are alive.
  const BOSSES = {
    wolf_king: {
      name: 'Король волков', act: 1, hp: 170, dmg: 8, interval: 1.1, xp: 40, gold: 40,
      phases: [{ at: 1, res: res(), dmgType: 'phys' }], summon: { kind: 'wolf', every: 11, max: 2 },
    },
    bone_lord: {
      name: 'Костяной лорд', act: 2, hp: 340, dmg: 13, interval: 1.3, xp: 70, gold: 70,
      phases: [{ at: 1, res: res({ phys: 0.3, holy: 2 }), dmgType: 'phys' }], summon: { kind: 'skeleton', every: 13, max: 1 },
    },
    ash_lord: {
      name: 'Повелитель пепла', act: 3, hp: 950, dmg: 15, interval: 1.3, xp: 0, gold: 0, final: true,
      phases: [
        { at: 1, name: 'Броня', res: res({ phys: 0.25, fire: 2, ice: 1, holy: 0.25 }), dmgType: 'phys' },
        { at: 0.66, name: 'Пламя', res: res({ phys: 1, fire: 0, ice: 2, holy: 0.5 }), dmgType: 'fire' },
        { at: 0.33, name: 'Тень', res: res({ phys: 0.25, fire: 1, ice: 0.25, holy: 2 }), dmgType: 'ice' },
      ],
    },
  };
  const BOSS_OF_ACT = { 1: 'wolf_king', 2: 'bone_lord', 3: 'ash_lord' };
  const ACT_NAMES = { 1: 'Тёмный лес', 2: 'Склеп', 3: 'Вулкан' };

  // Level-up perks; a shrine offers the same perks at double strength.
  const PERKS = {
    vigor: { name: 'Крепость', desc: '+{n} к здоровью', hp: 12 },
    might: { name: 'Сила', desc: '+{n} к атаке', atk: 1.5 },
    focus: { name: 'Меткость', desc: '+{n}% к шансу крита', crit: 0.05 },
    agility: { name: 'Ловкость', desc: '+{n}% к уклонению', dodge: 0.04 },
    hide: { name: 'Закалка', desc: '+{n} к броне', armor: 8 },
    spirit: { name: 'Стойкость духа', desc: '+{n} к защите от магии', ward: 8 },
    haste: { name: 'Быстрота', desc: 'Атаки быстрее на {n}%', haste: 0.06 },
    leech: { name: 'Жажда', desc: '+{n}% вампиризма', leech: 0.03 },
    arcana: { name: 'Чародейство', desc: 'Заклинания сильнее на {n}%', spell: 0.2 },
  };

  const TITLES = [
    { from: 1, name: 'Новичок' }, { from: 3, name: 'Оруженосец' }, { from: 6, name: 'Воин' },
    { from: 9, name: 'Рыцарь' }, { from: 12, name: 'Герой' }, { from: 15, name: 'Легенда' },
  ];

  // Permanent upgrades bought with «Слава»: price = base · growth^level.
  const META = {
    vigor: { name: 'Закалённое тело', desc: '+10 к здоровью', max: 5, base: 30, growth: 1.6 },
    might: { name: 'Крепкая рука', desc: '+1 к атаке', max: 5, base: 40, growth: 1.6 },
    purse: { name: 'Кошель', desc: '+25 золота в начале', max: 3, base: 35, growth: 1.7 },
    bag: { name: 'Большая сумка', desc: '+1 место в сумке', max: 2, base: 80, growth: 2 },
    potion: { name: 'Запас зелий', desc: '+1 зелье в начале', max: 2, base: 60, growth: 2 },
    armory: { name: 'Оружейная', desc: 'Ещё одно оружие в начале', max: 3, base: 70, growth: 1.8 },
  };

  const api = { TYPES, ITEMS, ARMORY, ENEMIES, ELITE, BOSSES, BOSS_OF_ACT, ACT_NAMES, PERKS, TITLES, META };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeroContent = api;
})(typeof window !== 'undefined' ? window : globalThis);
