'use strict';
// Romanian dictionary for «Родник» (Izvorul). Keys are the Russian source strings.
I18n.add({ ro: {
  // ── Page & header ──
  'Родник': 'Izvorul',
  'Спокойная игра о заброшенном селе: руби лес, бей камень, копай глину и восстанавливай дома до праздника.':
    'Un joc liniștit despre un sat părăsit: tai lemne, spargi piatră, sapi lut și refaci casele până la sărbătoare.',
  'Восстановлено 0/12': 'Refăcute 0/12',
  'Восстановлено {n}/{total}': 'Refăcute {n}/{total}',
  'Здания': 'Clădiri',
  'Инструменты': 'Unelte',
  'Настройки': 'Setări',
  'Заброшенное село у реки': 'Satul părăsit de lângă râu',
  'Действие': 'Acțiune',
  'Закрыть': 'Închide',

  // ── Resources ──
  // 'Дерево' is both the resource (wood) and the tree node; the HUD shows the resource.
  'Дерево': 'Lemn',
  'Камень': 'Piatră',
  'Глина': 'Lut',
  'Ягоды': 'Pomușoare',
  'Доски': 'Scânduri',
  'Кирпич': 'Cărămidă',

  // ── Nodes ──
  'Глиняная яма': 'Groapă de lut',
  'Ягодный куст': 'Tufă de pomușoare',

  // ── Tools ──
  'Топор': 'Toporul',
  'Кирка': 'Târnăcopul',
  'Лопата': 'Lopata',
  'Корзина': 'Coșul',
  'Верстак появится в твоём доме.': 'Bancul de lucru va apărea în casa ta.',

  // ── Buildings ──
  'Здание': 'Clădire',
  'Колодец': 'Fântâna',
  'Твой дом': 'Casa ta',
  'Амбар': 'Hambarul',
  'Мост': 'Podul',
  'Лесопилка': 'Joagărul',
  'Печь для обжига': 'Cuptorul de ars',
  'Дом лесоруба': 'Casa tăietorului de lemne',
  'Дом каменщика': 'Casa pietrarului',
  'Кузница': 'Fierăria',
  'Мельница': 'Moara',
  'Дом гончара': 'Casa olarului',
  'Часовня с колоколом': 'Capela cu clopot',
  'Внести': 'Adaugă',
  'Пристройка к амбару: больше места для запасов.': 'Extinderea hambarului: mai mult loc pentru provizii.',
  'Расширить амбар': 'Extinde hambarul',

  // ── Villagers ──
  'Лесоруб': 'Tăietor de lemne',
  'Каменщик': 'Pietrar',
  'Гончар': 'Olar',

  // ── Decorations ──
  'Клумба': 'Strat de flori',
  'Фонарь': 'Felinar',
  'Скамейка': 'Bancă',
  'Забор': 'Gard',

  // ── Goal hint ──
  'Следующее дело': 'Următoarea treabă',
  'Осмотрись вокруг': 'Uită-te în jur',
  'Восстановить: {name}': 'Reface: {name}',
  'Нужен инструмент: {name}': 'Ai nevoie de unealtă: {name}',
  'Украшай село': 'Împodobește satul',

  // ── Settings & saving ──
  'Музыка': 'Muzică',
  'Звуки': 'Sunete',
  'Сохранение': 'Salvare',
  'сохраняется само': 'se salvează singur',
  'Код облачного сохранения переносит прогресс на другое устройство.':
    'Codul de salvare în cloud îți mută progresul pe alt dispozitiv.',
  'Сохранить в облако': 'Salvează în cloud',
  'код сохранения': 'cod de salvare',
  'Загрузить': 'Încarcă',
  'Начать заново': 'Începe din nou',

  // ── HUD ──
  '{v}/мин': '{v}/min',
  'Амбар полон: жители и мастерские ждут': 'Hambarul e plin: sătenii și atelierele așteaptă',
  'Ставь: {name}': 'Așază: {name}',

  // ── Building panel ──
  'Площадь оживёт, а рядом можно будет поднять амбар.': 'Piața va prinde viață, iar alături se va putea ridica hambarul.',
  'В доме появится верстак: можно улучшать инструменты.': 'În casă va apărea bancul de lucru: poți îmbunătăți uneltele.',
  'Амбар хранит запасы жителей и мастерских: до {n}, с пристройкой до {max}.':
    'Hambarul păstrează proviziile sătenilor și atelierelor: până la {n}, cu extindere până la {max}.',
  'Откроет восточный берег и северную рощу. На том берегу найдётся лопата.':
    'Deschide malul de est și crângul de nord. Pe malul celălalt vei găsi o lopată.',
  'Сама пилит доски: дерево {ratio} → доски 1. Запас дерева до {reserve} всегда остаётся тебе.':
    'Taie singur scânduri: lemn {ratio} → scânduri 1. Rezerva de lemn de până la {reserve} rămâne mereu a ta.',
  'Сама обжигает кирпич: глина {ratio} → кирпич 1. Запас глины до {reserve} всегда остаётся тебе.':
    'Arde singur cărămizi: lut {ratio} → cărămidă 1. Rezerva de lut de până la {reserve} rămâne mereu a ta.',
  'Поселится лесоруб и сам будет рубить лес.': 'Se mută un tăietor de lemne care va tăia singur pădurea.',
  'Поселится каменщик и сам будет добывать камень.': 'Se mută un pietrar care va scoate singur piatră.',
  'Поселится гончар и сам будет копать глину.': 'Se mută un olar care va săpa singur lut.',
  'Кузнец откует инструменты третьего уровня.': 'Fierarul va făuri unelte de nivelul trei.',
  'Все жители работают на {n}% быстрее.': 'Toți sătenii lucrează cu {n}% mai repede.',
  'Зазвонит колокол, и село устроит праздник.': 'Va bate clopotul și satul va face sărbătoare.',
  'есть {n}': 'ai {n}',
  'Восстановлено. Спасибо!': 'Refăcută. Mulțumim!',
  'Сначала: {list}': 'Mai întâi: {list}',
  'Нечего внести: собери ещё.': 'Nu ai ce adăuga: mai adună.',

  // ── Buildings list, decorations ──
  'восстановлено': 'refăcută',
  'пока закрыто': 'încă închisă',
  'Иду: {name}': 'Merg la: {name}',
  'Туда пока не пройти': 'Încă nu se poate ajunge acolo',
  'Пристройка': 'Extinderea',
  'Украшения': 'Podoabe',
  'Выбери украшение и нажми на свободное место на площади.': 'Alege o podoabă și apasă pe un loc liber din piață.',
  'Нажми на свободное место на площади': 'Apasă pe un loc liber din piață',
  'Здесь уже занято': 'Locul e deja ocupat',
  'Не хватает: {list}': 'Lipsește: {list}',
  'Амбар расширен: запасы до {n}': 'Hambarul s-a extins: provizii până la {n}',

  // ── Tools panel ──
  'найдётся за мостом': 'se găsește dincolo de pod',
  'лучший уровень': 'cel mai bun nivel',
  'нужно здание: {name}': 'trebuie clădirea: {name}',
  'Улучшить': 'Îmbunătățește',
  'ур. {n}': 'niv. {n}',
  '{name}: уровень {n}': '{name}: nivelul {n}',

  // ── Toasts and windows ──
  'Восстановлено: {name}': 'Refăcută: {name}',
  'Праздник в селе!': 'Sărbătoare în sat!',
  'Колокол звонит, жители танцуют на площади. Село снова живое — спасибо тебе.':
    'Clopotul bate, sătenii dansează în piață. Satul e din nou viu — îți mulțumim.',
  'Дальше можно просто гулять, собирать и украшать площадь: клумбы, фонари, скамейки и заборы — в списке зданий.':
    'De acum poți doar să te plimbi, să aduni și să împodobești piața: straturi de flori, felinare, bănci și garduri — în lista clădirilor.',
  'Ура!': 'Ura!',
  'Подойди к дереву, камню, кусту или руине': 'Apropie-te de un copac, o piatră, o tufă sau o ruină',
  'Звук включён': 'Sunet pornit',
  'Звук выключен': 'Sunet oprit',
  'Пока тебя не было…': 'Cât ai lipsit…',
  'Прошло {time}{note}. Вот что успели жители и мастерские:': 'Au trecut {time}{note}. Iată ce au reușit sătenii și atelierele:',
  ' (дольше {h} ч село без тебя не работает)': ' (mai mult de {h} h satul nu lucrează fără tine)',
  'Отросло деревьев, камней и кустов: {n}': 'Au crescut la loc copaci, pietre și tufe: {n}',
  '{h} ч {m} мин': '{h} h {m} min',
  '{m} мин': '{m} min',
  '{s} с': '{s} s',
  'Хорошо': 'Bine',
  'Начать заново?': 'Începi din nou?',
  'Всё восстановленное село пропадёт.': 'Tot satul refăcut se va pierde.',
  'Всё восстановленное село пропадёт. Облачная копия останется по коду {code} — запиши его, чтобы потом вернуться.':
    'Tot satul refăcut se va pierde. Copia din cloud rămâne la codul {code} — notează-l ca să te poți întoarce.',
  'Отмена': 'Anulează',
  'Новое село ждёт': 'Un sat nou te așteaptă',
  'Сохранение повреждено — начато новое село': 'Salvarea e deteriorată — a început un sat nou',
  'сохранено': 'salvat',
  'браузер не даёт сохранять': 'browserul nu permite salvarea',
  'Сохранено. Введи этот код на другом устройстве.': 'Salvat. Introdu acest cod pe alt dispozitiv.',
  'Не удалось сохранить: {e}': 'Nu s-a putut salva: {e}',
  'Код состоит из 16 букв и цифр.': 'Codul are 16 litere și cifre.',
  'Сохранения с таким кодом нет.': 'Nu există nicio salvare cu acest cod.',
  'Это сохранение не подходит к игре.': 'Această salvare nu se potrivește jocului.',
  'Загружено.': 'Încărcat.',
  'Подхвачено сохранение из другой вкладки': 'S-a preluat salvarea din altă filă',
  'Не удалось загрузить: {e}': 'Nu s-a putut încărca: {e}',

  // ── Keys hint (split by <kbd> into separate text nodes) ──
  'Клавиши:': 'Taste:',
  'или стрелки — идти,': 'sau săgețile — mergi,',
  'или': 'sau',
  'Пробел': 'Spațiu',
  '— делать,': '— acționezi,',
  'здания,': 'clădiri,',
  'инструменты,': 'unelte,',
  'звук,': 'sunet,',
  'закрыть.': 'închide.',
} });
