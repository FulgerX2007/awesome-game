'use strict';
// Romanian dictionary for «Ржавый рассвет» (Zori ruginite). Keys are the Russian source strings.
I18n.add({ ro: {
  // ── Page & header ──
  'Ржавый рассвет': 'Zori ruginite',
  'Спокойная инкрементальная игра: чини роботов на свалке и автоматизируй всё до запуска ковчега.':
    'Un joc incremental liniștit: repari roboți într-un depozit de fier vechi și automatizezi totul până la lansarea arcei.',
  'День первый': 'Ziua întâi',
  'Рассвет №{n}': 'Zorii nr. {n}',
  'Хлам': 'Fier vechi',
  'Детали': 'Piese',
  'Ядра': 'Nuclee',
  'Роботы': 'Roboți',
  'Чертежи': 'Schițe',
  'Свалка на закате': 'Depozitul de fier vechi la apus',

  // ── Actions ──
  'Копать': 'Sapă',
  'Разобрать': 'Sortează',
  'Чинить робота': 'Repară robotul',
  'Чинить следующего': 'Repară următorul',
  '+1 хлам': '+1 fier vechi',
  '+{n} хлам': '+{n} fier vechi',
  '5 хлама → 1 деталь': '5 fier vechi → 1 piesă',
  '{a} хлама → {b} дет.': '{a} fier vechi → {b} {pl}',
  '10 деталей': '10 piese',
  'нужно {n} деталей': 'necesar: {n} {pl}',
  '+{w} к ремонту · {p}/{n}': '+{w} la reparație · {p}/{n}',
  'мало хлама': 'prea puțin fier vechi',
  '+{n} дет.': '+{n} {pl}',
  '+ядро': '+nucleu',
  'нужно {n} дет.': 'necesar: {n} {pl}',
  'робот готов!': 'robot gata!',
  '{s}{v}/с': '{s}{v}/s',
  '+{v}/мин': '+{v}/min',

  // ── Crew ──
  'Бригада': 'Echipa',
  'Копатели': 'Săpători',
  'Сортировщики': 'Sortatori',
  'Механики': 'Mecanici',
  'хлама/с': 'fier vechi/s',
  'деталей/с': 'piese/s',
  'ремонта/с': 'reparație/s',
  '{v} {unit} каждый': '{v} {unit} fiecare',
  ' · {r} хлама → 1': ' · {r} fier vechi → 1',
  'свободны: {n}': 'liberi: {n}',
  'все при деле': 'toți la treabă',
  'Снять одного': 'Retrage unul',
  'Назначить одного': 'Repartizează unul',
  'Назначить всех свободных': 'Repartizează toți roboții liberi',
  'все': 'toți',
  'Механики сами берутся за следующего робота': 'Mecanicii trec singuri la următorul robot',

  // ── Workshop ──
  'Мастерская': 'Atelierul',
  'Новые чертежи откроются, когда свалка оживёт.': 'Schițe noi vor apărea când depozitul prinde viață.',
  'есть': 'deținut',
  'готово': 'complet',
  'Лопата': 'Lopată',
  '+1 хлам за удар': '+1 fier vechi pe lovitură',
  'Рабочие перчатки': 'Mănuși de lucru',
  'Разбираешь на одну горсть больше за раз': 'Sortezi câte un pumn în plus deodată',
  'Гаечный ключ': 'Cheie franceză',
  '+2 к ремонту за удар': '+2 la reparație pe lovitură',
  'Электромагнит': 'Electromagnet',
  'Копатели работают на 50% быстрее': 'Săpătorii lucrează cu 50% mai repede',
  'Лента транспортёра': 'Bandă transportoare',
  'Сортировщики работают на 50% быстрее': 'Sortatorii lucrează cu 50% mai repede',
  'Машинное масло': 'Ulei de motor',
  'Механики работают на 50% быстрее': 'Mecanicii lucrează cu 50% mai repede',
  'Диспетчер': 'Dispecer',
  'Новые роботы сами встают туда, где они нужнее': 'Roboții noi merg singuri acolo unde e mai mare nevoie de ei',
  'Плавильня': 'Topitorie',
  'Деталь получается из меньшего количества хлама': 'O piesă cere mai puțin fier vechi',
  'Сканер': 'Scaner',
  'Шанс найти ядро среди деталей +0,5%': 'Șansa de a găsi un nucleu printre piese +0,5%',
  'Сборочный цех': 'Hală de asamblare',
  'Ремонтирует роботов сам: +1 к ремонту в секунду': 'Repară singură roboți: +1 la reparație pe secundă',
  'Нейроядро': 'Neuronucleu',
  'Все роботы работают вдвое быстрее': 'Toți roboții lucrează de două ori mai repede',

  // ── Ark ──
  'Ковчег': 'Arca',
  'Каркас': 'Carcasă',
  'Двигатели': 'Motoare',
  'Реактор': 'Reactor',
  'Навигация': 'Navigație',
  'Запуск': 'Lansare',
  'Построить': 'Construiește',
  'улетел': 'a decolat',
  'Ковчег ушёл в небо. Свалка затихла, но в тетради остались чертежи.':
    'Arca s-a înălțat la cer. Depozitul s-a liniștit, dar în caiet au rămas schițele.',
  'Новый рассвет': 'Zori noi',
  'Новый рассвет: +{n} {bp}': 'Zori noi: +{n} {bp}',
  'Ковчег взлетел': 'Arca a decolat',
  'Свалка провожает его щелчками сотен роботов. Ты остаёшься на земле, но небо уже светлеет.':
    'Depozitul o petrece cu țăcănitul a sute de roboți. Tu rămâi pe pământ, dar cerul începe deja să se lumineze.',
  'За {time} ты собрал {parts} деталей и починил {n} {robots}.':
    'În {time} ai adunat {parts} {pl} și ai reparat {n} {robots}.',
  '«Новый рассвет» начнёт всё сначала, но даст <b>{n} {bp}</b>: каждый навсегда ускоряет всю работу на 10%.':
    '„Zori noi” o ia de la capăt, dar îți dă <b>{n} {bp}</b>: fiecare grăbește pentru totdeauna toată munca cu 10%.',
  'Посмотреть ещё': 'Mai privesc',
  'Новый рассвет. В тетради {n} {bp}, руки помнят больше.':
    'Zori noi. În caiet sunt {n} {bp}, iar mâinile își amintesc mai multe.',

  // ── Plurals (1 / 0, 2–19 / 20+) ──
  'чертёж|чертежа|чертежей': 'schiță|schițe|de schițe',
  'робота|роботов|роботов': 'robot|roboți|de roboți',
  'робот|робота|роботов': 'robot|roboți|de roboți',
  'ядро|ядра|ядер': 'nucleu|nuclee|de nuclee',
  'деталь|детали|деталей': 'piesă|piese|de piese',

  // ── Durations ──
  '{h} ч {m} мин': '{h} h {m} min',
  '{m} мин': '{m} min',
  '{s} с': '{s} s',

  // ── Saving ──
  'Сохранение': 'Salvare',
  'сохраняется само': 'se salvează singur',
  'сохранено': 'salvat',
  'браузер не даёт сохранять': 'browserul nu permite salvarea',
  'Код облачного сохранения переносит прогресс на другое устройство.':
    'Codul de salvare în cloud îți mută progresul pe alt dispozitiv.',
  'Сохранить в облако': 'Salvează în cloud',
  'код сохранения': 'cod de salvare',
  'Загрузить': 'Încarcă',
  'Начать с нуля': 'Începe de la zero',
  'Точно? Нажми ещё раз': 'Sigur? Mai apasă o dată',
  'Сохранено. Введи этот код на другом устройстве.': 'Salvat. Introdu acest cod pe alt dispozitiv.',
  'Не удалось сохранить: {e}': 'Nu s-a putut salva: {e}',
  'Код состоит из 16 букв и цифр.': 'Codul are 16 litere și cifre.',
  'Сохранения с таким кодом нет.': 'Nu există nicio salvare cu acest cod.',
  'Загружено.': 'Încărcat.',
  'Не удалось загрузить: {e}': 'Nu s-a putut încărca: {e}',

  // ── Offline progress ──
  'Пока тебя не было': 'Cât ai lipsit',
  'Бригада работала {time}{note}:': 'Echipa a lucrat {time}{note}:',
  ' (больше восьми часов роботы без присмотра не работают)': ' (nesupravegheați, roboții nu lucrează mai mult de opt ore)',
  '+{n} хлама': '+{n} fier vechi',
  '+{n} деталей': '+{n} {pl}',
  '+{n} {robots} в строю': '+{n} {robots} la treabă',
  'Отлично': 'Excelent',

  // ── Chronicle ──
  'Ты просыпаешься среди ржавых гор. Ни души, только хлам до горизонта и закатное небо.':
    'Te trezești printre munți de rugină. Nici țipenie, doar fier vechi până la orizont și cerul în asfințit.',
  'Руки помнят: из хлама можно выбирать детали. Пять горстей на одну.':
    'Mâinile își amintesc: din fier vechi poți alege piese. Cinci pumni pentru una.',
  'Под грудой лома лежит робот. Корпус цел. Если собрать десяток деталей, его можно починить.':
    'Sub o grămadă de fiare zace un robot. Carcasa e întreagă. Dacă aduni vreo zece piese, îl poți repara.',
  'Робот открывает глаз, смотрит на тебя и тянется к лопате. Дай ему работу в «Бригаде».':
    'Robotul deschide un ochi, se uită la tine și întinde mâna după lopată. Dă-i de lucru în „Echipa”.',
  'Роботы перещёлкиваются между собой. Похоже, им нравится работать вместе.':
    'Roboții țăcăne între ei. Se pare că le place să lucreze împreună.',
  'Среди деталей что-то светится. Ядро — сердце старых машин.':
    'Printre piese strălucește ceva. Un nucleu — inima mașinilor de odinioară.',
  'В дымке на краю свалки виден остов огромного корабля. Ковчег. Его можно достроить.':
    'În ceața de la marginea depozitului se vede scheletul unei nave uriașe. Arca. Poate fi terminată.',
  'Свалка гудит. Ты сидишь на ящике и просто смотришь, как они работают.':
    'Depozitul vuiește. Stai pe o ladă și doar te uiți cum lucrează.',
  'Каркас ковчега стоит. Роботы носят балки и, кажется, гордятся.':
    'Carcasa arcei stă în picioare. Roboții cară grinzi și par mândri.',
  'Двигатели на месте. По ночам слышно, как они тихо остывают.':
    'Motoarele sunt la locul lor. Noaptea se aude cum se răcesc încet.',
  'Реактор теплится. Небо на востоке стало чуть светлее.':
    'Reactorul mocnește. Cerul dinspre răsărit s-a luminat puțin.',
  'Навигация ожила и сама нашла звезду, к которой стоит лететь.':
    'Navigația a prins viață și a găsit singură steaua spre care merită să zbori.',
} });
