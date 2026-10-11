'use strict';
// Звездочёт — Romanian translations. The Russian text is the key (see ../i18n.js).
I18n.add({ ro: {
  // Language names stay in their own language (the toggle's title/aria-label).
  'Русский': 'Русский',

  // Page and panel
  'Звездочёт': 'Cititorul de stele',
  'Ночное небо. Клик — наблюдать': 'Cerul nopții. Apasă ca să observi',
  'звёздного света': 'lumină stelară',
  '0 в секунду': '0 pe secundă',
  '{rate} в секунду · клик {click}': '{rate} pe secundă · clic {click}',
  'Кликай по небу, чтобы наблюдать': 'Apasă pe cer ca să observi',
  'Инструменты': 'Instrumente',
  'Сколько покупать': 'Câte cumperi',
  'макс': 'max',
  'Улучшения': 'Îmbunătățiri',
  'Атлас созвездий': 'Atlasul constelațiilor',
  'Сверхновая': 'Supernovă',
  'Взорви свою звезду: всё начнётся заново, но звёздная пыль останется навсегда. Каждая пылинка даёт +10% к свету и клику.':
    'Fă-ți steaua să explodeze: totul o ia de la capăt, dar praful stelar rămâne pentru totdeauna. Fiecare fir de praf dă +10% la lumină și la clic.',
  'Сохранение': 'Salvare',
  'сохраняется само': 'se salvează singur',
  'сохранено': 'salvat',
  'браузер не даёт сохранять': 'browserul nu permite salvarea',
  'Сохранить в облако': 'Salvează în cloud',
  'код сохранения': 'codul salvării',
  'Загрузить': 'Încarcă',
  'Начать с нуля': 'Începe de la zero',
  'Точно? Нажми ещё раз': 'Sigur? Mai apasă o dată',

  // Sky, meteors, HUD
  'Метеор! +{n} света': 'Meteor! +{n} lumină',
  'Звездопад! Весь свет ×7 на {s} с': 'Ploaie de stele! Toată lumina ×7 timp de {s} s',
  'Звездопад ×7 · {s} с': 'Ploaie de stele ×7 · {s} s',
  '{name} собрана: {bonus}': 'Constelația {name} e completă: {bonus}',
  'На небе проступило созвездие «{name}». Найди его звёзды и кликни по каждой.':
    'Pe cer s-a ivit constelația „{name}”. Găsește-i stelele și apasă pe fiecare.',
  'Пока тебя не было, инструменты собрали {n} света.': 'Cât ai lipsit, instrumentele au adunat lumină: {n}',

  // Instruments list
  'откроется ближе к {n} света': 'apare pe la {n} lumină',
  '{n}/с каждый': '{n}/s fiecare',
  'всего {n}/с': 'total {n}/s',

  // Atlas
  'Не открыто': 'Nedescoperită',
  'найди звёзды на небе': 'găsește stelele pe cer',
  'при {n} света': 'la {n} lumină',
  '{done} из {total}': '{done} din {total}',

  // Supernova
  'пыль: {n} (+{pct}%)': 'praf: {n} (+{pct}%)',
  'Взорвать: +{n} {dust}': 'Explodează: +{n} {dust}',
  'пылинка|пылинки|пылинок': 'fir de praf|fire de praf|de fire de praf',
  'Точно? Всё, кроме пыли, начнётся заново': 'Sigur? Totul, în afară de praf, o ia de la capăt',
  'Сверхновая! Звёздная пыль: {dust} (+{gain}). Небо снова тёмное.': 'Supernovă! Praf stelar: {dust} (+{gain}). Cerul e iar întunecat.',

  // Cloud saves
  'Сохранено. Введи этот код на другом устройстве.': 'Salvat. Introdu acest cod pe alt dispozitiv.',
  'Не удалось сохранить: {err}': 'Nu s-a putut salva: {err}',
  'Код состоит из 16 букв и цифр.': 'Codul are 16 litere și cifre.',
  'Сохранения с таким кодом нет.': 'Nu există nicio salvare cu acest cod.',
  'Загружено.': 'Încărcat.',
  'Не удалось загрузить: {err}': 'Nu s-a putut încărca: {err}',

  // Instruments
  'Подзорная труба': 'Lunetă',
  'Видно Луну и пару планет.': 'Se văd Luna și câteva planete.',
  'Рефрактор': 'Refractor',
  'Линза Галилея, кольца Сатурна как «уши».': 'Lentila lui Galilei, inelele lui Saturn ca niște „urechi”.',
  'Рефлектор Ньютона': 'Reflector Newton',
  'Зеркало вместо линзы, без радуги по краям.': 'O oglindă în loc de lentilă, fără curcubeu pe margini.',
  'Обсерватория': 'Observator',
  'Купол на холме и ночные смены.': 'O cupolă pe deal și ture de noapte.',
  'Радиотелескоп': 'Radiotelescop',
  'Слушает небо, а не смотрит.': 'Ascultă cerul, nu-l privește.',
  'Орбитальный телескоп': 'Telescop orbital',
  'Над атмосферой звёзды не мерцают.': 'Deasupra atmosferei stelele nu mai sclipesc.',
  'Интерферометр': 'Interferometru',
  'Несколько антенн работают как одна размером с планету.': 'Mai multe antene lucrează ca una singură, cât o planetă.',
  'Гравитационно-волновая обсерватория': 'Observator de unde gravitaționale',
  'Ловит рябь пространства от слияния чёрных дыр.': 'Prinde unduirile spațiului când se contopesc găurile negre.',
  // Lower-case forms used inside upgrade names
  'подзорная труба': 'lunetă',
  'рефрактор': 'refractor',
  'рефлектор ньютона': 'reflector Newton',
  'обсерватория': 'observator',
  'радиотелескоп': 'radiotelescop',
  'орбитальный телескоп': 'telescop orbital',
  'интерферометр': 'interferometru',
  'гравитационно-волновая обсерватория': 'observator de unde gravitaționale',

  // Upgrades
  'Чистая оптика': 'Optică curată',
  'Точная монтировка': 'Montură precisă',
  'Тёмное небо': 'Cer întunecat',
  'Адаптивная оптика': 'Optică adaptivă',
  'Нобелевская премия': 'Premiul Nobel',
  '{inst} даёт вдвое больше света': '{inst}: de două ori mai multă lumină',
  'Привыкшие к темноте глаза': 'Ochi deprinși cu bezna',
  'Клик даёт вдвое больше': 'Clicul aduce de două ori mai mult',
  'Карта звёздного неба': 'Harta cerului înstelat',
  'Клик даёт ещё 1% света в секунду': 'Clicul mai aduce 1% din lumina pe secundă',
  'Красный фонарик': 'Lanternă roșie',
  'Астролябия': 'Astrolab',
  'Каталог метеорных потоков': 'Catalogul ploilor de meteori',
  'Метеоры появляются вдвое чаще': 'Meteorii apar de două ori mai des',
  'Длинная выдержка': 'Expunere lungă',
  'Эффекты метеоров длятся вдвое дольше': 'Efectele meteorilor țin de două ori mai mult',

  // Constellations and their bonuses
  'Большая Медведица': 'Ursa Mare',
  'Кассиопея': 'Casiopeea',
  'Лира': 'Lira',
  'Лебедь': 'Lebăda',
  'Лев': 'Leul',
  'Орион': 'Orion',
  'Скорпион': 'Scorpionul',
  'Андромеда': 'Andromeda',
  'клик ×2': 'clic ×2',
  'весь свет +10%': 'toată lumina +10%',
  'весь свет +15%': 'toată lumina +15%',
  'весь свет +25%': 'toată lumina +25%',
  'весь свет +50%': 'toată lumina +50%',
  'метеоры чаще в 1,5 раза': 'meteori de 1,5 ori mai des',
  'клик +2% света в секунду': 'clic +2% din lumina pe secundă',
  'эффекты метеоров дольше в 1,5 раза': 'efectele meteorilor țin de 1,5 ori mai mult',

  // Stars
  'Дубхе': 'Dubhe', 'Мерак': 'Merak', 'Фекда': 'Phecda', 'Мегрец': 'Megrez', 'Алиот': 'Alioth', 'Мицар': 'Mizar', 'Бенетнаш': 'Benetnasch',
  'Каф': 'Caph', 'Шедар': 'Schedar', 'Нави': 'Navi', 'Рукбах': 'Ruchbah', 'Сегин': 'Segin',
  'Вега': 'Vega', 'Эпсилон': 'Epsilon', 'Шелиак': 'Sheliak', 'Сулафат': 'Sulafat', 'Дзета': 'Zeta',
  'Денеб': 'Deneb', 'Садр': 'Sadr', 'Альбирео': 'Albireo', 'Гиена': 'Gienah', 'Дельта': 'Delta',
  'Регул': 'Regulus', 'Альгиеба': 'Algieba', 'Адхафера': 'Adhafera', 'Расалас': 'Rasalas', 'Зосма': 'Zosma', 'Денебола': 'Denebola', 'Хорт': 'Chort',
  'Бетельгейзе': 'Betelgeuse', 'Беллатрикс': 'Bellatrix', 'Альнитак': 'Alnitak', 'Альнилам': 'Alnilam', 'Минтака': 'Mintaka', 'Саиф': 'Saiph', 'Ригель': 'Rigel',
  'Дшубба': 'Dschubba', 'Антарес': 'Antares', 'Тау': 'Tau', 'Мю': 'Miu', 'Сарган': 'Sargas', 'Шаула': 'Shaula',
  'Альферац': 'Alpheratz', 'Мирах': 'Mirach', 'Аламак': 'Almach', 'Туманность М31': 'Nebuloasa M31',
} });
