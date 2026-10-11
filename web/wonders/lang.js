'use strict';
// Romanian translations for Поле чудес (Câmpul minunilor). Russian source text is the key.
// The words themselves are not translated: each language has its own word list in core.js.
I18n.add({ ro: {
  'Поле чудес': 'Câmpul minunilor',
  'Игра для троих: крутите барабан, называйте буквы и угадайте слово раньше соперников.':
    'Un joc pentru trei: învârtiți roata, spuneți litere și ghiciți cuvântul înaintea rivalilor.',
  // Setup
  'Три игрока у барабана': 'Trei jucători la roată',
  'Крутите барабан, называйте буквы и угадайте слово раньше соперников. Очки раунда забирает тот, кто откроет слово. Лучший игрок выходит в суперигру.':
    'Învârtiți roata, spuneți litere și ghiciți cuvântul înaintea rivalilor. Punctele rundei le ia cel care descoperă cuvântul. Cel mai bun jucător intră în superjoc.',
  'Раундов:': 'Runde:',
  'Продолжить игру': 'Continuă jocul',
  'Начать игру': 'Începe jocul',
  'Игрок {n}': 'Jucătorul {n}',
  'Бот {n}': 'Robotul {n}',
  'Человек': 'Om',
  'Компьютер': 'Calculator',
  'Правила': 'Reguli',
  'Игроки ходят по очереди. В свой ход крутите барабан и называйте букву. Если буква есть в слове, очки сектора умножаются на число открытых букв, а ход остаётся за вами.':
    'Jucătorii joacă pe rând. La rândul vostru învârtiți roata și spuneți o literă. Dacă litera e în cuvânt, punctele sectorului se înmulțesc cu numărul de litere descoperite, iar rândul rămâne al vostru.',
  'Нет такой буквы или её уже называли — ход переходит к следующему.':
    'Dacă litera nu există sau a mai fost spusă, rândul trece la următorul.',
  '«Б» — банкрот: очки раунда сгорают. «0» — ход переходит. «×2» — угадали букву, и очки раунда удваиваются. «+» — откройте любую букву, нажав на клетку табло.':
    '„F” — faliment: punctele rundei se pierd. „0” — rândul trece mai departe. „×2” — ghiciți litera și punctele rundei se dublează. „+” — descoperiți orice literă apăsând pe o căsuță de pe panou.',
  'Три верные буквы подряд — шкатулки: в одной из двух лежит 1000 очков.':
    'Trei litere corecte la rând — cutiile: într-una din cele două sunt 1000 de puncte.',
  'Вместо вращения можно назвать слово целиком. Угадали — раунд ваш. Ошиблись — выбываете из раунда, а очки раунда сгорают.':
    'În loc să învârtiți roata, puteți spune tot cuvântul. Ați ghicit — runda e a voastră. Ați greșit — ieșiți din rundă, iar punctele rundei se pierd.',
  'Очки раунда идут в банк только тому, кто открыл слово.':
    'Punctele rundei intră în bancă doar pentru cel care a descoperit cuvântul.',
  'После последнего раунда игрок с самым большим банком играет суперигру: называет три буквы, и у него 60 секунд на слово. Победа удваивает банк, минимум +2000.':
    'După ultima rundă, jucătorul cu cea mai mare bancă joacă superjocul: spune trei litere și are 60 de secunde pentru cuvânt. Victoria dublează banca, cel puțin +2000.',
  // Game screen
  'Раунд 1 из 3': 'Runda 1 din 3',
  'Раунд {r} из {n}': 'Runda {r} din {n}',
  'Суперигра': 'Superjoc',
  'В меню': 'Meniu',
  'Задание': 'Sarcina',
  'Табло': 'Panou',
  'Барабан': 'Roata',
  'Буквы': 'Litere',
  'Пробел': 'Spațiu',
  'Крутить барабан': 'Învârte roata',
  'Назвать слово': 'Spune cuvântul',
  'Закрытая буква {n}': 'Litera ascunsă {n}',
  'вне раунда': 'în afara rundei',
  'бот': 'robot',
  'раунд': 'runda',
  'банк': 'banca',
  'Звук: вкл': 'Sunet: pornit',
  'Звук: выкл': 'Sunet: oprit',
  'Б': 'F',
  'букву|буквы|букв': 'literă|litere|de litere',
  'слово|слова|слов': 'cuvânt|cuvinte|de cuvinte',
  // Host
  'Раунд {r}. Первым крутит барабан {name}': 'Runda {r}. Primul învârte roata {name}',
  'Продолжаем! Ход: {name}': 'Continuăm! E rândul: {name}',
  '{name} крутит барабан…': '{name} învârte roata…',
  '{v} очков на барабане! {name}, ваша буква?': '{v} de puncte pe roată! {name}, ce literă spuneți?',
  'Удвоение! {name}, назовите букву — и очки раунда удвоятся':
    'Dublare! {name}, spuneți o literă — și punctele rundei se dublează',
  'Сектор «Плюс»! {name}, откройте любую букву: нажмите на клетку табло':
    'Sectorul „Plus”! {name}, descoperiți orice literă: apăsați pe o căsuță de pe panou',
  'Открываем «{l}»: {n} {letters}': 'Descoperim „{l}”: {n} {letters}',
  'Банкрот! {name} теряет очки раунда. Ход переходит: {next}':
    'Faliment! {name} pierde punctele rundei. Rândul trece la: {next}',
  'Ноль. Ход переходит: {next}': 'Zero. Rândul trece la: {next}',
  'Есть такая буква «{l}»! Очки раунда удваиваются: +{gain}': 'Există litera „{l}”! Punctele rundei se dublează: +{gain}',
  'Есть такая буква «{l}»! Откройте {n} {letters}: +{gain}': 'Există litera „{l}”! Descoperiți {n} {letters}: +{gain}',
  'Нет буквы «{l}». Ход переходит: {next}': 'Nu există litera „{l}”. Rândul trece la: {next}',
  'Букву «{l}» уже называли. Ход переходит: {next}': 'Litera „{l}” a mai fost spusă. Rândul trece la: {next}',
  'Абсолютно верно! {name} выигрывает раунд': 'Absolut corect! {name} câștigă runda',
  'Неверно! Все игроки выбыли, раунд остаётся без победителя': 'Greșit! Toți jucătorii au ieșit, runda rămâne fără câștigător',
  'Неверно! {name} выбывает из раунда. Ход переходит: {next}': 'Greșit! {name} iese din rundă. Rândul trece la: {next}',
  'Слово открыто! {name} выигрывает раунд': 'Cuvântul e descoperit! {name} câștigă runda',
  'Три буквы подряд — шкатулки в студию!': 'Trei litere la rând — aduceți cutiile în studio!',
  '{name}: «Я знаю слово! Это {w}»': '{name}: „Știu cuvântul! Este {w}”',
  'Суперигра! {name}, назовите {n} буквы — и у вас будет {sec} секунд на слово':
    'Superjoc! {name}, spuneți {n} litere — și veți avea {sec} de secunde pentru cuvânt',
  'Буква «{l}»: открываем {n} {letters}': 'Litera „{l}”: descoperim {n} {letters}',
  'Буквы «{l}» нет': 'Litera „{l}” nu există',
  'У вас {sec} секунд, чтобы назвать слово!': 'Aveți {sec} de secunde să spuneți cuvântul!',
  'Время вышло!': 'Timpul a expirat!',
  'Это победа! {name} выигрывает суперигру: +{gain}': 'Victorie! {name} câștigă superjocul: +{gain}',
  'Увы, суперигра проиграна. Было загадано: {w}': 'Păcat, superjocul e pierdut. Cuvântul era: {w}',
  // Word dialog
  'Назовите слово': 'Spuneți cuvântul',
  'Суперигра: ваше слово': 'Superjoc: cuvântul vostru',
  'Слово': 'Cuvânt',
  'Отмена': 'Anulează',
  'Ответить': 'Răspunde',
  'Время идёт!': 'Timpul curge!',
  'Ошибка — и вы выбываете из раунда.': 'O greșeală — și ieșiți din rundă.',
  'Осталось {t}': 'Au mai rămas {t}',
  // Boxes
  'Шкатулки!': 'Cutiile!',
  'Три буквы подряд. В одной из шкатулок 1000 очков.': 'Trei litere la rând. Într-una din cutii sunt 1000 de puncte.',
  'Левая шкатулка': 'Cutia din stânga',
  'Правая шкатулка': 'Cutia din dreapta',
  '{name}, три буквы подряд! В одной из шкатулок {n} очков.': '{name}, trei litere la rând! Într-una din cutii sunt {n} de puncte.',
  'пусто': 'gol',
  '{name} находит {n} очков! Крутите дальше': '{name} găsește {n} de puncte! Învârtiți mai departe',
  'Пусто! Деньги были в другой шкатулке. Крутите дальше': 'Gol! Banii erau în cealaltă cutie. Învârtiți mai departe',
  // Round end and final
  'Победитель раунда: {name}': 'Câștigătorul rundei: {name}',
  'Раунд без победителя': 'Rundă fără câștigător',
  'В банк: +{n}': 'În bancă: +{n}',
  'Очки раунда сгорели у всех.': 'Toți au pierdut punctele rundei.',
  'К суперигре': 'La superjoc',
  'Следующий раунд': 'Runda următoare',
  'Игра окончена': 'Jocul s-a terminat',
  '{name}: суперигра выиграна, банк удвоен: +{n}': '{name}: superjocul e câștigat, banca s-a dublat: +{n}',
  '{name}: слово суперигры не угадано, банк остаётся прежним.': '{name}: cuvântul superjocului nu a fost ghicit, banca rămâne aceeași.',
  'Сыграть ещё': 'Încă o dată',
  'Место в таблице рекордов: {n}': 'Locul în clasament: {n}',
  'В таблицу рекордов не хватило очков.': 'Punctele nu au ajuns pentru clasament.',
} });
