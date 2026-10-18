# «Родник» 2.0: объёмная графика, день и сезоны, огород, ярмарка и хутор

## Overview
- Второй большой этап «Родника» (`/village/`). Две цели:
  1. **Качество картинки — 2.5D.** Вид сверху становится объёмным, как в «Долгой зиме»: здания, деревья и камни
     «растут» вверх от своих клеток, у них освещённые и теневые грани, мягкие контактные и падающие тени,
     единый свет сверху слева из общего набора `web/fx.js`.
  2. **Новый контент.** Смена дня и ночи и четыре сезона, огород с пасекой и садом, заказы жителей и сезонная ярмарка,
     новая часть карты (хутор за холмом) со вторым финалом — Праздником урожая.
- Игра остаётся спокойной: нет врагов, голода, проигрыша и штрафов за ночь или зиму. Ночь и зима меняют картинку
  и то, что растёт, но не наказывают.
- Сохранения версии 1 не переносятся: формат меняется на версию 2, старое сохранение даёт новую игру
  (решение пользователя: проще перестроить карту и баланс). Нечитаемая копия, как и сейчас, откладывается в
  `village.save.broken`.
- Работа разбита на пять фаз. Каждая фаза — рабочая игра с зелёными тестами, её можно выпускать отдельно.

## Context (from discovery)
- Файлы игры: `web/village/` — `index.html`, `style.css`, `lang.js`, `core.js` (правила без DOM, 968 строк),
  `view.js` (чистые помощники: камера, выбор клетки, DPR), `art.js` (вся отрисовка, 1374 строки, плоская),
  `game.js` (экраны, ввод, панели, сохранения, облако), `audio.js` (синтез звука и музыки).
- Тесты: `tests/village/*.test.js` на `node:test` (core, gather, build, view, lang, audio, balance), бот
  `tests/village/bot.js`, e2e `tests/village/smoke.cjs` на Playwright. Пути статики — в `main_test.go`.
- 2.5D уже сделано в шести играх через `web/fx.js` (`window.Fx`): `LIGHT`, `shade`/`mix`, `bake`, `shadow`, `glow`,
  `vignette`, `sphere`, `block`, `prism`, `cylinder`, `bean`, `text`, `Particles`, `Floaters`, `damp`, `ease`.
  Ближайший образец — `web/winter/` (вид три четверти на той же сетке, `tests/winter/build.test.js` проверяет
  порядок скриптов `../i18n.js, ../nav.js, ../fx.js, lang.js, core.js, view.js, audio.js, game.js`).
- Сейчас в «Роднике»: карта 48×36 строками в `MAP`, 12 зданий в `BUILDINGS` (финал — часовня, `effect: 'festival'`),
  4 вида узлов (дерево, камень, глина, куст), 6 ресурсов, 3 жителя, лесопилка и печь, склад 50/150/400,
  украшения после праздника, офлайн до 8 часов, шаг мира 1/20 с, `VERSION = 1`.
- Баланс сейчас: праздник на 135–144-й минуте на 20 сидах, без пауз дольше 14 минут без нового здания или улучшения.

## Development Approach
- **testing approach**: Regular (сначала код, затем тесты в той же задаче)
- complete each task fully before moving to the next
- make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
  - tests are not optional - they are a required part of the checklist
  - write unit tests for new functions/methods
  - write unit tests for modified functions/methods
  - add new test cases for new code paths
  - update existing test cases if behavior changes
  - tests cover both success and error scenarios
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- run tests after each change: `node --test 'tests/**/*.test.js'` и `go test ./...`
- обратная совместимость: другие игры, `fx.js` (только добавления) и API сервера не меняются; сейвы v1 сознательно
  не переносятся

## Testing Strategy
- **unit tests (JS)**: `tests/village/*.test.js`, загружают `core.js` и `view.js` через `require`.
  Новые файлы тестов: `light.test.js` (2.5D-помощники и выбор по силуэту), `clock.test.js` (день и сезоны),
  `farm.test.js` (огород, пасека, сад), `orders.test.js` (заказы и ярмарка), `hamlet.test.js` (хутор, второй финал),
  `save.test.js` (версия 2, сброс v1, офлайн через смену сезонов).
- **balance bot**: `tests/village/bot.js` учится сажать, поливать, выполнять заказы, ходить на ярмарку и строить хутор.
  `balance.test.js` проверяет оба финала и паузы на 20 сидах.
- **unit tests (Go)**: новые пути (`/village/houses.js`) в списке статики `main_test.go`.
- **e2e**: `tests/village/smoke.cjs` — нет ошибок в консоли, кадр не пустой и не плоский (разброс цвета пикселей),
  ночь темнее дня, работают панели заказов и ярмарки, грядка проходит путь «посадить → полить → собрать», RO работает.
  Запускается отдельно: `node tests/village/smoke.cjs` (нужен браузер и сервер).
- **fx.js**: если в набор добавляется функция (например, `cast` для падающей тени), её тест — в `tests/fx/fx.test.js`.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview

### Фазы
| Фаза | Что | Правила меняются? |
|---|---|---|
| 1. 2.5D | объёмная графика на `fx.js` | нет |
| 2. День и сезоны | часы мира, свет, сезонные палитры и что растёт | да, `VERSION = 2` |
| 3. Огород и ферма | огород, ведро из колодца, пасека, сад | да |
| 4. Заказы и ярмарка | доска заказов, монеты, сезонная ярмарка | да |
| 5. Хутор | карта шире, дорога через холм, виноградник, давильня, 2 дома, Праздник урожая | да |

### Ключевые решения
- **2.5D — объёмный вид сверху, не изометрия** (выбор пользователя). Клетки и камера остаются прежними, поэтому
  `screenToTile`, путь и правила не меняются. Высокие объекты перекрывают клетки за собой, поэтому добавляется
  выбор по силуэту: клик по кроне дерева или крыше выбирает этот объект (`view.pickTall`).
- **Свет**: направление общее (`Fx.LIGHT`, сверху слева). Падающие тени — скошенные силуэты вниз вправо; их длина
  и прозрачность зависят от времени суток. Ночью тени почти исчезают, окна, фонари и кузница светятся (`Fx.glow`).
- **Запекание**: здания, деревья и камни запекаются в спрайты по ключу `(вид, стадия, сезон, облик)` через `Fx.bake`.
  Свет дня и ночи — не в спрайтах, а слоем поверх кадра (тон через `multiply` + светящиеся точки через `lighter`),
  иначе спрайтов стало бы в разы больше. Земля — те же кэшированные куски, отдельно для каждого сезона.
- **Отрисовка зданий выносится в `web/village/houses.js`**: зданий станет 18, и `art.js` иначе перевалит за 2500 строк.
  `art.js` остаётся миром (земля, вода, узлы, люди, эффекты, свет), `houses.js` экспортирует `window.VillageHouses`.
- **Время в правилах**: часы мира считаются от `s.t`, поэтому офлайн-прогресс сам проходит дни и сезоны.
  Сутки — 8 минут (6 светлых, 2 вечер и ночь), сезон — 3 суток (24 минуты), год — 96 минут.
- **Ночь и зима не наказывают**: доход жителей и мастерских не меняется. Зимой грядки отдыхают, кусты не плодоносят,
  пасека спит; поэтому до первой зимы игрок успевает запастись, а цены подобраны ботом с учётом зимы.
- **Монеты** — новый ресурс без лимита амбара; их дают только заказы жителей, тратятся они только на ярмарке.
- **Один источник данных**: новые здания, ресурсы и узлы добавляются в существующие таблицы `BUILDINGS`, `RESOURCES`,
  `NODE_KINDS`, `ZONE_NODES`, чтобы панели, подсказка «Следующее дело» и бот работали через уже готовые пути.

## Technical Details

### Часы и сезоны (`core.js`)
```js
const DAY = 480;               // секунд в сутках
const LIGHT_PART = 0.75;       // 0..0.75 — день, 0.75..0.85 — вечер, 0.85..1 — ночь (утро — плавный рассвет)
const SEASON_DAYS = 3;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
clock(s) -> { day, phase /*0..1*/, part: 'day'|'dusk'|'night'|'dawn', season, seasonDay, year }
```
- Игра начинается весной, утром первого дня. События `{ type: 'dawn' }`, `{ type: 'season', season }`.
- Сезонные множители роста: грядки весна 1, лето 1.25, осень 0.8, зима 0; кусты и мёд зимой 0; яблоки только
  лето и осень, виноград только осень.

### Новые ресурсы
`vegetables` (Овощи), `honey` (Мёд), `apples` (Яблоки), `grapes` (Виноград), `juice` (Сок), `coins` (Монеты).
Амбар ограничивает все, кроме монет; ручной сбор, как и раньше, идёт сверх лимита.

### Новые здания (в общую таблицу `BUILDINGS`)
| id | Название | Нужно | Эффект |
|---|---|---|---|
| `garden` | Огород | `well` | 6 грядок рядом, ведро у колодца |
| `apiary` | Пасека | `garden`, `house1` | мёд сам, кроме зимы |
| `market` | Ярмарочные ряды | `house2` | доска заказов, ярмарка в первый день сезона |
| `road` | Дорога через холм | праздник (`chapel`) | открывает хутор на востоке |
| `vineyard` | Виноградник | `road` + черенки с ярмарки | грядки винограда (осенний сбор) |
| `press` | Давильня | `vineyard` | мастерская: 3 винограда → 1 сок |
| `house4` | Дом пасечника | `road` | житель: мёд ×2, весной ещё и воск в заказы |
| `house5` | Дом садовника | `road` | житель: яблоки летом и осенью |
| `harvest` | Дом урожая | все здания хутора | второй финал — Праздник урожая |

Цены подбирает бот (Задача 19). Цель: Праздник села к 150-й минуте (±10), Праздник урожая ещё через 80–100 минут,
нигде нет паузы дольше 14 минут без нового здания, улучшения, заказа или покупки.

### Огород и ведро
- Грядка: `{ x, y, crop, stage: 'empty'|'planted'|'growing'|'ripe', water, grow }`. Посадить — 1 ягода (семена),
  полить — 1 заряд ведра, рост 1 сутки при поливе (с сезонным множителем), сбор — 4 овоща (корзина 2 и 3: 5 и 6).
- Ведро: `s.bucket` 0..6, наполняется действием у колодца. Политая грядка держит воду до следующего рассвета.
- Офлайн: политые грядки дозревают, неполитые ждут.

### Заказы и ярмарка
- Доска заказов на площади (после `market`): до 3 заказов от жителей, например «20 досок и 8 овощей».
  Заказ: `{ id, who, need: {...}, reward: { coins, decor? } }`, новый появляется на рассвете, генератор по сиду
  (`s.rng`) и от открытых ресурсов, поэтому заказ всегда выполним.
- Ярмарка: первый день каждого сезона, днём. Товары: черенки винограда (нужны для `vineyard`), новые украшения
  (качели, колодезный журавль, пугало, арка с цветами), улучшение ведра (6 → 10), рецепт мёда в часовню.
  Пропущенная ярмарка не мешает: черенки продаются на каждой.
- Подсказка «Следующее дело» знает про заказы и ближайшую ярмарку.

### Хутор (`MAP`)
- Карта шире: 48×36 → 64×36. Новые колонки 48–63 — холм с тропой (закрыт до `road`), сад с яблонями
  (узел `apple`, корзина), поле винограда, площадка хутора.
- Новый узел `apple` в `NODE_KINDS`, зона `hamlet` в `ZONE_NODES`.

### 2.5D: чистые помощники (`view.js`)
- `sunAt(phase, season) -> { tint, shadowLen, shadowAlpha, glow }` — свет кадра по времени суток и сезону.
- `palette(season, t)` — цвета травы, листвы, воды, плавный переход между сезонами в течение первых суток.
- `pickTall(sx, sy, cam, boxes)` — объект под точкой по силуэту (крона, крыша), ближний к зрителю побеждает,
  иначе `null` (тогда работает `screenToTile`).
- `spriteKey(kind, stage, season, look)` — стабильные ключи запекания.

### Рисование (`art.js`, `houses.js`)
- Порядок кадра не меняется: земля (кусками) → вода → мост → всё стоящее, отсортированное по линии основания →
  частицы → свет дня и ночи → тени облаков → виньетка.
- Новые шаги: падающие тени до стоящих объектов; слой света (`multiply` тоном `sunAt().tint`) и затем светящиеся
  окна, фонари, искры кузницы, светлячки (`lighter`).
- Бюджет: не больше 300 частиц, спрайты запекаются лениво и сбрасываются при смене сезона, DPR ≤ 2.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): всё делается в этом репозитории — код, тесты, документация.
- **Post-Completion** (без чекбоксов): ручная проверка на телефонах, ощущение баланса, выпуск образа.

## Implementation Steps

### Фаза 1 — объёмная графика (правила не меняются)

### Task 1: Подключить fx.js и чистые 2.5D-помощники

**Files:**
- Modify: `web/village/index.html`
- Modify: `web/village/view.js`
- Create: `tests/village/light.test.js`
- Modify: `tests/village/build.test.js`

- [ ] подключить `../fx.js` в `index.html` после `../nav.js`, порядок как в `winter`
- [ ] добавить в `view.js` `pickTall` и `spriteKey` (без DOM)
- [ ] write tests: `pickTall` — крона над чужой клеткой, ближний объект побеждает, пустое место даёт `null`
- [ ] write tests: `build.test.js` проверяет порядок скриптов и что выше папки грузятся только общие файлы
- [ ] run tests - must pass before next task

### Task 2: Земля и вода в 2.5D

**Files:**
- Modify: `web/village/art.js`

- [ ] куски земли: мягкая тень (AO) у кромок воды, дорожек, площади и фундаментов, перепады тона травы
- [ ] вода: градиент глубины, береговая кромка с пеной, блики по направлению света, кувшинки с тенью
- [ ] мост: объёмные доски и опоры с тенью на воде
- [ ] write tests: в `light.test.js` — запечённые куски не зависят от порядка обхода (детерминированный хеш облика из `view.js`)
- [ ] проверить кадр вручную через `smoke.cjs` (скриншот в scratchpad)
- [ ] run tests - must pass before next task

### Task 3: Деревья, камни, кусты и глина в 2.5D

**Files:**
- Modify: `web/village/art.js`
- Modify: `web/village/game.js`

- [ ] деревья: ствол `Fx.cylinder`, крона из нескольких `Fx.sphere` с бликом сверху слева, падающая тень, покачивание
- [ ] камни, глина, кусты, пни, ростки: объём, контактная тень, запекание через `Fx.bake` по `spriteKey`
- [ ] клик и тап: в `game.js` сначала `pickTall`, потом `screenToTile`
- [ ] write tests: `pickTall` на реальных размерах силуэтов (дерево перед камнем, дерево у края карты)
- [ ] run tests - must pass before next task

### Task 4: Здания в 2.5D, вынос в houses.js

**Files:**
- Create: `web/village/houses.js`
- Modify: `web/village/art.js`
- Modify: `web/village/index.html`
- Modify: `main_test.go`
- Modify: `tests/village/build.test.js`

- [ ] перенести `house`, `roof`, `door`, `windowBox`, `drawRuin`, `drawScaffold` и `ART[id]` в `houses.js` (`window.VillageHouses`)
- [ ] стены — `Fx.block`/`Fx.prism` с освещённой и теневой гранью, скаты крыш с разным тоном, трубы, падающие тени
- [ ] три стадии (руина, леса, готово) со своими спрайтами, анимация достройки (`easeBack`) сохраняется
- [ ] добавить `/village/houses.js` в `main_test.go` и в проверку порядка скриптов
- [ ] write tests: `go test ./...` и `build.test.js` (новый файл, относительные пути, без сети)
- [ ] run tests - must pass before next task

### Task 5: Люди, куры, эффекты праздника; бюджет кадра

**Files:**
- Modify: `web/village/art.js`
- Modify: `tests/village/smoke.cjs`

- [ ] люди и куры: тела `Fx.bean`, тени, затенённая сторона, инструменты с бликом
- [ ] частицы, щепки, салют, гирлянды, бабочки — на `Fx.Particles` и `Fx.glow`, не больше 300 частиц
- [ ] `smoke.cjs`: кадр не плоский (разброс цвета), нет ошибок консоли, время кадра в норме на 2× DPR
- [ ] write tests: `smoke.cjs` проходит; unit-тесты не меняются
- [ ] run tests - must pass before next task

### Фаза 2 — день, ночь и сезоны

### Task 6: Часы мира и версия сохранения 2

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/clock.test.js`
- Create: `tests/village/save.test.js`
- Modify: `tests/village/core.test.js`

- [ ] `DAY`, `SEASON_DAYS`, `SEASONS`, `clock(s)`, события `dawn` и `season` в `step`
- [ ] `VERSION = 2`; сейв v1 даёт новую игру с `recovered: true`
- [ ] write tests: границы суток и сезонов, переход через год, события ровно один раз при больших `dt`
- [ ] write tests: v1 → новая игра, v2 туда-обратно без потерь, мусор в полях отбрасывается
- [ ] run tests - must pass before next task

### Task 7: Свет дня и ночи

**Files:**
- Modify: `web/village/view.js`
- Modify: `web/village/art.js`
- Modify: `web/village/houses.js`
- Modify: `web/village/game.js`
- Modify: `tests/village/light.test.js`

- [ ] `sunAt(phase, season)` во `view.js`: тон, длина и прозрачность теней, сила свечения
- [ ] слой света в кадре, светящиеся окна готовых домов, фонари-украшения, кузница, светлячки летом ночью
- [ ] часы и сезон в HUD (значок солнца/луны и название сезона)
- [ ] write tests: `sunAt` — полдень светлее полуночи, рассвет и закат плавные (без скачков между соседними фазами)
- [ ] run tests - must pass before next task

### Task 8: Сезонные палитры и сезонные правила

**Files:**
- Modify: `web/village/core.js`
- Modify: `web/village/view.js`
- Modify: `web/village/art.js`
- Modify: `tests/village/gather.test.js`
- Modify: `tests/village/light.test.js`

- [ ] правила: зимой кусты не плодоносят и не отрастают, остальные узлы отрастают как раньше
- [ ] `palette(season, t)`: весенняя зелень и цветы, летняя густая трава, осенняя листва и листопад, зимний снег и лёд на реке
- [ ] куски земли и спрайты кэшируются по сезону, переход в течение первых суток сезона
- [ ] write tests: кусты зимой и весной, `palette` даёт разные цвета и плавный переход
- [ ] обновить `bot.js`, чтобы `balance.test.js` проходил с зимой
- [ ] run tests - must pass before next task

### Фаза 3 — огород и ферма

### Task 9: Огород, грядки и ведро

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/farm.test.js`

- [ ] ресурс `vegetables`, здание `garden` (нужен `well`) с 6 грядками на карте
- [ ] ведро `s.bucket`: наполнить у колодца, полить грядку; посадить, вырастить, собрать
- [ ] сезонный рост, вода до рассвета, офлайн дозревание политых грядок
- [ ] write tests: полный цикл грядки, без воды не растёт, зимой не сажается, пустое ведро, корзина 2 и 3
- [ ] run tests - must pass before next task

### Task 10: Пасека и сад

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/farm.test.js`

- [ ] ресурсы `honey`, `apples`; здание `apiary` (мёд сам, кроме зимы, в лимите амбара)
- [ ] узел `apple` (корзина, плоды летом и осенью); пара яблонь у огорода, основной сад — на хуторе (Task 16)
- [ ] мёд и овощи входят в цены поздних зданий (`house3`, `chapel`) вместо части ягод
- [ ] write tests: мёд по сезонам и лимит амбара, яблоки только летом и осенью, офлайн через зиму
- [ ] обновить `bot.js`: сажает, поливает, собирает; `balance.test.js` зелёный
- [ ] run tests - must pass before next task

### Task 11: Рисование и управление фермой

**Files:**
- Modify: `web/village/houses.js`
- Modify: `web/village/art.js`
- Modify: `web/village/game.js`
- Modify: `web/village/lang.js`
- Modify: `tests/village/lang.test.js`

- [ ] огород, грядки по стадиям, пасека с ульями и пчёлами, яблони с плодами
- [ ] действие у грядки: посадить / полить / собрать по ситуации; ведро в HUD; брызги воды
- [ ] «Следующее дело» учитывает огород
- [ ] переводы RO для всех новых строк
- [ ] write tests: `lang.test.js` — каждая новая строка RU имеет RO
- [ ] run tests - must pass before next task

### Фаза 4 — заказы жителей и ярмарка

### Task 12: Заказы жителей

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/orders.test.js`

- [ ] ресурс `coins` (без лимита амбара), здание `market` (нужен `house2`)
- [ ] доска до 3 заказов, новый на рассвете, генератор по `s.rng` только из открытых ресурсов
- [ ] `fulfill(s, orderId)`: проверка, списание, награда, событие
- [ ] write tests: заказ всегда выполним из открытых ресурсов, не больше 3, нехватка → `'cost'`, награда приходит
- [ ] run tests - must pass before next task

### Task 13: Сезонная ярмарка

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/orders.test.js`

- [ ] ярмарка в первый день сезона днём, товары: черенки, новые украшения, ведро побольше
- [ ] `buy(s, itemId)`: `'ok' | 'closed' | 'coins' | 'owned'`
- [ ] новые украшения в `DECOR` (качели, журавль, пугало, арка), доступны после покупки
- [ ] write tests: открыта только в свой день, покупки и ошибки, черенки на каждой ярмарке
- [ ] обновить `bot.js`: выполняет заказы и покупает; `balance.test.js` зелёный
- [ ] run tests - must pass before next task

### Task 14: Панели заказов и ярмарки

**Files:**
- Modify: `web/village/game.js`
- Modify: `web/village/index.html`
- Modify: `web/village/style.css`
- Modify: `web/village/houses.js`
- Modify: `web/village/lang.js`

- [ ] доска заказов на площади (клик или `O`), панель ярмарки (клик по рядам), монеты в HUD
- [ ] ярмарочные ряды с навесами, флажки, торговцы в дни ярмарки
- [ ] переводы RO; управление с телефона (кнопки в панели, без клавиатуры)
- [ ] write tests: `lang.test.js` зелёный, `smoke.cjs` открывает обе панели
- [ ] run tests - must pass before next task

### Фаза 5 — хутор за холмом

### Task 15: Шире карта и дорога через холм

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/hamlet.test.js`
- Modify: `tests/village/core.test.js`

- [ ] `MAP` 64×36: холм с тропой, сад, поле, площадка хутора; зона `hamlet` в `ZONE_NODES`
- [ ] здание `road` (после праздника) открывает тропу
- [ ] write tests: до дороги на хутор не пройти, после — путь есть; все строки карты одной длины; узлы не на тропе
- [ ] run tests - must pass before next task

### Task 16: Здания хутора и Праздник урожая

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/hamlet.test.js`

- [ ] ресурсы `grapes`, `juice`; здания `vineyard` (нужны черенки), `press` (мастерская 3 → 1), `house4`, `house5`, `harvest`
- [ ] новые жители: пасечник (мёд ×2), садовник (яблоки летом и осенью)
- [ ] `harvest` даёт событие и флаг `s.harvestFestival`, свободная игра продолжается
- [ ] write tests: цепочка зависимостей, давильня с запасом, жители по сезонам, второй финал ровно один раз
- [ ] run tests - must pass before next task

### Task 17: Рисование хутора

**Files:**
- Modify: `web/village/houses.js`
- Modify: `web/village/art.js`
- Modify: `web/village/lang.js`

- [ ] холм с тропой и тенью склона, сад, ряды винограда, давильня, два дома, Дом урожая
- [ ] Праздник урожая: снопы, корзины, гирлянды из листьев, свои фейерверки
- [ ] переводы RO
- [ ] write tests: `lang.test.js` зелёный, `smoke.cjs` — хутор рисуется без ошибок (сейв из бота после праздника)
- [ ] run tests - must pass before next task

### Фаза 6 — доводка

### Task 18: Звуки

**Files:**
- Modify: `web/village/audio.js`
- Modify: `tests/village/audio.test.js`

- [ ] ночью сверчки вместо птиц, зимой тихий ветер, пчёлы у пасеки, плеск полива, ярмарочный наигрыш, колокол урожая
- [ ] write tests: новые звуки существуют и не падают без `AudioContext`
- [ ] run tests - must pass before next task

### Task 19: Баланс полной игры

**Files:**
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`
- Modify: `web/village/core.js`

- [ ] бот играет всю игру: огород, заказы, ярмарка, дорога, хутор
- [ ] подобрать цены: Праздник села ~150 мин (±10), Праздник урожая ещё через 80–100 мин
- [ ] write tests: на 20 сидах оба финала в рамках, нет паузы дольше 14 мин, игра не застревает зимой
- [ ] run tests - must pass before next task

### Task 20: Verify acceptance criteria
- [ ] все цели Overview сделаны: 2.5D, день и сезоны, огород и ферма, заказы и ярмарка, хутор и второй финал
- [ ] края: v1-сейв, облачный код v1, офлайн 8 часов через зиму, ярмарка при открытой вкладке на смене суток
- [ ] run full test suite: `node --test 'tests/**/*.test.js'` и `go test ./...`
- [ ] run e2e: `node tests/village/smoke.cjs`
- [ ] каждая новая функция `core.js` и `view.js` покрыта тестом

### Task 21: [Final] Update documentation
- [ ] раздел «Родник» в `README.md`: 2.5D, сутки и сезоны, огород, ярмарка, хутор, новые клавиши, новые сроки бота
- [ ] `docs/roadmap.md`, если там есть «Родник»
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- поиграть на телефоне: читаемость ночью, видно ли грядки и узлы зимой, попадание тапом по кронам и крышам
- плавность кадра на слабом телефоне (DPR 2, много света ночью на празднике)
- ощущение темпа: не скучно ли зимой, не слишком ли редко ярмарка

**External system updates**:
- игроки с сейвом v1 начнут заново — стоит предупредить в заметках к выпуску
- выпуск образа Docker после слияния (как обычно, через `release-image.yml`)
