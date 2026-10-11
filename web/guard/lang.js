'use strict';
// Romanian translations for Дозор. Keys are the Russian source strings (see web/i18n.js).
I18n.add({
  ro: {
    // Page
    'Дозор': 'Straja',
    'Пошаговая тактика: враги заранее показывают удар, а три хранителя толкают их так, чтобы деревня уцелела.':
      'Tactică pe ture: dușmanii își arată lovitura dinainte, iar trei străjeri îi împing astfel încât satul să scape.',
    'Правила': 'Reguli', 'Звук': 'Sunet', 'Поле боя': 'Câmpul de luptă',
    'Отменить шаг': 'Anulează pasul', 'Заново ход': 'Reia tura', 'Конец хода': 'Gata tura',

    // Heroes, enemies, islands
    'Рыцарь': 'Cavalerul', 'Лучница': 'Arcașa', 'Маг': 'Magul',
    'Удар щитом': 'Lovitură de scut', 'Стрела': 'Săgeată', 'Вихрь': 'Vârtej',
    'Бьёт соседнюю клетку на {dmg} и отталкивает цель на шаг.': 'Lovește căsuța vecină cu {dmg} și împinge ținta cu un pas.',
    'Стреляет по прямой: первая цель получает {dmg} и отлетает по ходу стрелы.': 'Trage în linie dreaptă: prima țintă primește {dmg} și e aruncată în direcția săgeții.',
    'Бьёт клетку через одну и дальше по прямой на {dmg} (дома не задевает) и расталкивает всех вокруг неё.':
      'Lovește o căsuță aflată la cel puțin două pătrate în linie dreaptă cu {dmg} (casele rămân neatinse) și îi împinge pe toți din jurul ei.',
    'Расталкиваемые получают 1 урона.': 'Cei împinși primesc 1 rană.',
    'Волк': 'Lup', 'Кусает соседнюю клетку.': 'Mușcă o căsuță vecină.',
    'Пращник': 'Praștiaș', 'Метает камень по прямой: попадает в первое препятствие.': 'Aruncă o piatră în linie dreaptă: lovește primul obstacol.',
    'Нетопырь': 'Liliac', 'Летает над водой и скалами. Кусает соседнюю клетку.': 'Zboară peste apă și stânci. Mușcă o căsuță vecină.',
    'Тролль': 'Trol', 'Бьёт соседнюю клетку и отбрасывает цель.': 'Lovește o căsuță vecină și aruncă ținta înapoi.',
    'Мшистый берег': 'Malul cu mușchi', 'Совиная гать': 'Podețul bufnițelor', 'Старая мельница': 'Moara veche',
    'Каменный брод': 'Vadul de piatră', 'Сердце леса': 'Inima pădurii',

    // Rewards
    'Крепкий рыцарь': 'Cavaler rezistent', 'Рыцарь: +1 к здоровью.': 'Cavalerul: +1 viață.',
    'Выносливая лучница': 'Arcașă călită', 'Лучница: +1 к здоровью.': 'Arcașa: +1 viață.',
    'Стойкий маг': 'Mag neclintit', 'Маг: +1 к здоровью.': 'Magul: +1 viață.',
    'Тяжёлый щит': 'Scut greu', 'Удар щитом наносит 3 урона.': 'Lovitura de scut dă 3 răni.',
    'Стальные наконечники': 'Vârfuri de oțel', 'Стрела наносит 2 урона.': 'Săgeata dă 2 răni.',
    'Колючий ветер': 'Vânt înțepător', 'Вихрь ранит на 1 всех, кого расталкивает.': 'Vârtejul îi rănește cu 1 pe toți cei pe care îi împinge.',
    'Быстрые сапоги': 'Cizme iuți', 'Рыцарь: +1 шаг.': 'Cavalerul: +1 pas.',
    'Лёгкий плащ': 'Mantie ușoară', 'Лучница: +1 шаг.': 'Arcașa: +1 pas.',
    'Посох-скороход': 'Toiag de drum lung', 'Маг: +1 шаг.': 'Magul: +1 pas.',
    'Новые фонари': 'Felinare noi', '+2 фонаря деревни (не больше 7).': '+2 felinare pentru sat (cel mult 7).',

    // Tiles
    'Трава': 'Iarbă', 'Роща': 'Crâng', 'Вода': 'Apă', 'Скала': 'Stâncă', 'Дом': 'Casă', 'Руины': 'Ruine',
    'Обычная земля.': 'Pământ obișnuit.',
    'Деревья не мешают ни ходить, ни стрелять.': 'Copacii nu încurcă nici mersul, nici tragerea.',
    'Враг, которого столкнули в воду, тонет. Нетопыри летают над ней, хранители в неё не заходят.':
      'Dușmanul împins în apă se îneacă. Liliecii zboară peste ea, străjerii nu intră în ea.',
    'Преграда. Кто ударится о скалу, получит 1 урона, а скала треснет. После двух ударов рассыпается.':
      'Obstacol. Cine se izbește de stâncă primește 1 rană, iar stânca crapă. După două lovituri se sfărâmă.',
    'Дом с фонарём. Если его разрушат, деревня теряет фонарь. Удар о дом тоже разрушает его.':
      'Casă cu felinar. Dacă e dărâmată, satul pierde un felinar. Și o izbitură de casă o dărâmă.',
    'Здесь был дом. Теперь по руинам можно ходить.': 'Aici a fost o casă. Acum se poate merge peste ruine.',

    // Panel
    '−фонарь': '−felinar',
    'без сил до конца битвы': 'fără puteri până la sfârșitul luptei', 'ход сделан': 'a făcut tura',
    'может действовать': 'poate acționa', 'готов': 'gata', 'шаг {n}': 'pas {n}',
    'Остров {n} из {m} · {name}': 'Insula {n} din {m} · {name}',
    'Фонари деревни: {n} из {m}': 'Felinarele satului: {n} din {m}',
    'Ход {n} из {m}': 'Tura {n} din {m}',
    'Задача: победи {n} врагов ({k}/{n})': 'Sarcină: învinge {n} dușmani ({k}/{n})',
    'Задача: не потеряй ни одного дома': 'Sarcină: nu pierde nicio casă',
    'Награда: +1 фонарь': 'Răsplată: +1 felinar',
    'Заново ход ({n})': 'Reia tura ({n})',
    'Здоровье {hp} из {max}, урон {dmg}': 'Viață {hp} din {max}, lovitură {dmg}',
    '★ Вожак: +1 к здоровью и урону.': '★ Căpetenie: +1 viață și +1 la lovitură.',
    'по хранителю': 'un străjer', 'по своему же': 'pe unul de-al lui', 'по дому!': 'o casă!', 'по скале': 'o stâncă', 'в пустоту': 'în gol',
    'Ударит {what}': 'Va lovi {what}',
    'Здоровье {hp} из {max}, шаг {move}': 'Viață {hp} din {max}, pas {move}',
    'Здесь выползет враг': 'Aici iese un dușman',
    'В конце хода тут появится: {name}. Встань на клетку, чтобы не пустить его (получишь 1 урона).':
      'La sfârșitul turei aici apare: {name}. Stai pe căsuță ca să nu-l lași să iasă (primești 1 rană).',
    'Синие клетки — куда можно шагнуть. Потом выбери цель.': 'Căsuțele albastre arată unde poți păși. Apoi alege ținta.',
    'Оранжевые рамки — цели. Наведи, чтобы увидеть, что случится.': 'Ramele portocalii sunt ținte. Ține cursorul pe una ca să vezi ce se întâmplă.',
    'Выбери хранителя. Красные клетки — куда враги ударят в конце хода. Толкай врагов, чтобы они промахнулись.':
      'Alege un străjer. Căsuțele roșii arată unde vor lovi dușmanii la sfârșitul turei. Împinge-i ca să rateze.',
    'Ход врагов': 'Tura dușmanilor',

    // Rules
    'Враги ходят первыми и показывают, куда ударят: красная клетка и номер очереди.':
      'Dușmanii mută primii și arată unde vor lovi: căsuța roșie și numărul de ordine.',
    'Удар бьёт по направлению от врага. Сдвинешь врага — сдвинется и удар: пусть он попадёт по пустоте или по другому чудищу.':
      'Lovitura merge într-o direcție de la dușman. Dacă îl muți, se mută și lovitura: fă-o să cadă în gol sau peste altă dihanie.',
    'Каждый хранитель за ход может шагнуть и один раз применить умение. Порядок любой.':
      'Fiecare străjer poate păși și își poate folosi o dată puterea în fiecare tură. Ordinea e la alegere.',
    'Столкнутый в воду враг тонет. Удар о скалу, дом или другого — 1 урона.':
      'Dușmanul împins în apă se îneacă. O izbitură de stâncă, de casă sau de altcineva dă 1 rană.',
    'Фиолетовый вихрь — здесь выползет враг. Встань на него, чтобы не пустить.':
      'Vârtejul violet arată unde iese un dușman. Stai pe el ca să nu-l lași.',
    'Разрушенный дом гасит фонарь. Погаснут все — деревня падёт. Продержись нужное число ходов на каждом из пяти островов.':
      'O casă dărâmată stinge un felinar. Dacă se sting toate, satul cade. Rezistă numărul cerut de ture pe fiecare dintre cele cinci insule.',

    // Overlays
    'Лучшие хранители': 'Cei mai buni străjeri', 'Аноним': 'Anonim',
    'Ночью из леса выходят чудища. Три хранителя — рыцарь, лучница и маг — берегут фонари деревни.':
      'Noaptea, din pădure ies dihănii. Trei străjeri — cavalerul, arcașa și magul — păzesc felinarele satului.',
    'Лучший счёт: {n}': 'Cel mai bun scor: {n}',
    'Продолжить поход': 'Continuă drumul', 'Новый поход': 'Drum nou',
    'Задача выполнена: +1 фонарь и +50 очков.': 'Sarcină îndeplinită: +1 felinar și +50 de puncte.',
    'Задача не выполнена.': 'Sarcina nu a fost îndeplinită.',
    'Остров спасён': 'Insula e salvată',
    'Деревня пережила ночь на острове «{name}».': 'Satul a trecut cu bine prin noapte pe insula „{name}”.',
    'Фонарей: {n} из {m}. Счёт: {s}.': 'Felinare: {n} din {m}. Scor: {s}.',
    'Выбери награду': 'Alege răsplata',
    'Рассвет!': 'Zorii!', 'Деревня погрузилась во тьму': 'Satul s-a cufundat în întuneric',
    'Все пять островов спасены. Фонари горят до утра.': 'Toate cele cinci insule sunt salvate. Felinarele ard până dimineață.',
    'Погас последний фонарь на острове «{name}».': 'Ultimul felinar s-a stins pe insula „{name}”.',
    'Побеждено врагов: {k}. Задач выполнено: {o}. Лучший счёт: {b}.': 'Dușmani învinși: {k}. Sarcini îndeplinite: {o}. Cel mai bun scor: {b}.',
    'Твоё имя': 'Numele tău', 'В таблицу': 'În clasament',
    'Таблица рекордов доступна, когда игра запущена на сервере.': 'Clasamentul e disponibil când jocul rulează pe server.',
    'Как играть': 'Cum se joacă',
    'Клавиши: 1–3 — выбрать хранителя, Пробел — шаг или умение, Z — отменить шаг, Enter — конец хода, Esc — снять выбор.':
      'Taste: 1–3 — alege străjerul, Space — pas sau putere, Z — anulează pasul, Enter — gata tura, Esc — renunță la selecție.',
    'Понятно': 'Am înțeles',
  },
});
