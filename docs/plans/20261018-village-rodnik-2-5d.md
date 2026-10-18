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
- Сохранения версии 1 не переносятся (решение пользователя): формат меняется на версию 2, старое сохранение даёт
  новую игру с понятным сообщением «новая версия — новое село», а не «сохранение сломано».
- Работа разбита на шесть фаз. Каждая фаза — рабочая игра с зелёными тестами, её можно выпускать отдельно.

## Context (from discovery)
- Файлы игры: `web/village/` — `index.html`, `style.css`, `lang.js`, `core.js` (правила без DOM, 968 строк),
  `view.js` (чистые помощники: камера, выбор клетки, DPR, `tapAction`, `pickFront`), `art.js` (вся отрисовка,
  1374 строки, плоская; `ART[id]` — замыкание внутри), `game.js` (экраны, ввод, панели, сохранения, облако),
  `audio.js` (синтез звука и музыки).
- Тесты `tests/village/`:
  - `core.test.js`, `gather.test.js` (в т.ч. «каждая зона достижима»), `build.test.js` (правила зданий, `ALL_BUT_CHAPEL`),
    `view.test.js`, `audio.test.js`;
  - `lang.test.js` — переводы RO (сканирует `game.js`, `index.html`, таблицы core) и **точный порядок скриптов**
    `['../i18n.js','../nav.js','lang.js','core.js','view.js','audio.js','art.js','game.js']`;
  - `balance.test.js` + `bot.js` — сейчас проверяет: сид 1 — праздник на 120–210 мин, колодец на 1–3 мин,
    пауза ≤ 15 мин; 3 сида по умолчанию (меньше 20 с), 20 сидов при `BALANCE=1`: все здания из `BUILDINGS`
    готовы к празднику, праздник ≤ 4 ч, пауза ≤ 15 мин. Паузы (`maxGap`) считаются по зданиям, инструментам и амбару;
  - `smoke.cjs` — e2e на Playwright.
- Пути статики — в `main_test.go`.
- Правила, которые новый контент задевает:
  - `ZONES`: «запад — достижимо без моста, иначе север (`y < 8`) или восток»;
  - `groundWalkable` закрывает только клетку `'b'` (мост);
  - `scatterNodes` раскладывает узлы заливкой с открытым мостом и отбрасывает места, которые режут проход;
  - `offline()` — свой цикл по 1 с (`s.t += 1; produce()`), `regrow()` один раз в конце, события отбрасываются;
  - `nextGoal` до праздника берёт самое дешёвое доступное здание, после него возвращает `{ type: 'decor' }`;
  - `restore()` рассчитывает, что зависимости идут раньше в `BUILDING_IDS`;
  - `game.js` `loadSaved()` кладёт любое `recovered` в `village.save.broken` и пишет «сохранение сломано»,
    облачная загрузка — «Это сохранение не подходит к игре».
- 2.5D уже сделано в шести играх через `web/fx.js` (`window.Fx`): `LIGHT`, `shade`/`mix`, `shadow`, `glow`, `vignette`,
  `sphere`, `block`, `prism`, `cylinder`, `bean`, `text`, `Particles`, `damp`, `ease`; `Fx.bake` — только квадратные
  градиентные спрайты с вечным кэшем. Образец — `web/winter/`: свой кэш спрайтов
  `sprite(key, wT, hT, axT, ayT, paint)` с ключом `key|ts|dpr` и LRU на 360 записей (`web/winter/game.js:646`).

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
- **CRITICAL: all tests must pass before starting next task** - no exceptions; в том числе `balance.test.js`:
  каждая задача, которая меняет правила или карту, сразу учит бота новому
- **CRITICAL: update this plan file when scope changes during implementation**
- run tests after each change: `node --test 'tests/**/*.test.js'` и `go test ./...`
- обратная совместимость: другие игры, `fx.js` и API сервера не меняются; сейвы v1 сознательно не переносятся

## Testing Strategy
- **unit tests (JS)**: `tests/village/*.test.js`, загружают `core.js` и `view.js` через `require`.
  - Новые файлы: `clock.test.js` (день, сезоны, общие хуки для `step` и `offline`), `farm.test.js` (огород, ведро,
    пасека, сад), `orders.test.js` (заказы и ярмарка), `hamlet.test.js` (тропа, зона, здания хутора, второй финал),
    `save.test.js` (версии 2 и 3, сброс v1, перенос v2 → v3).
  - 2.5D-помощники (`tallBox`, `edgeMask`, `sunAt`, `palette`) и новые цели касания — в `view.test.js`.
  - Порядок скриптов и переводы — в `lang.test.js`; скан RO расширяется на `art.js` и `houses.js`.
- **offline = step**: существующий тест на совпадение офлайна и шагов расширяется: прыжок через рассвет и через зиму
  с грядками, пасекой и заказами даёт то же, что `step`.
- **balance bot**: `bot.js` учится сажать, поливать, выполнять заказы, ходить на ярмарку и строить хутор в той же
  задаче, где появляется правило. Паузы считаются и по заказам и покупкам.
- **unit tests (Go)**: новый путь `/village/houses.js` в списке статики `main_test.go`.
- **e2e**: `tests/village/smoke.cjs` — нет ошибок в консоли, кадр не плоский (разброс цвета пикселей), ночь темнее дня,
  открываются панели заказов и ярмарки, грядка проходит «посадить → полить → собрать», RO работает. Запуск отдельно:
  `node tests/village/smoke.cjs`. Плавность кадра — ручная проверка, не тест (иначе мигает).

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview

### Фазы
| Фаза | Что | Правила | Сейв |
|---|---|---|---|
| 1. 2.5D | объёмная графика на `fx.js` | нет | v1 |
| 2. День и сезоны | часы мира, свет, сезонные палитры и что растёт | да | v2 (v1 → новая игра) |
| 3. Огород и ферма | огород, ведро из колодца, пасека, сад | да | v2 |
| 4. Заказы и ярмарка | доска заказов, монеты, сезонная ярмарка | да | v2 |
| 5. Хутор | карта шире, тропа через холм, виноградник, давильня, 2 дома, Праздник урожая | да | v3 (v2 переносится) |
| 6. Доводка | звуки, баланс всей игры | да | v3 |

Новые поля в фазах 3–4 `restore()` заполняет значениями по умолчанию, поэтому сейв v2 из фазы 2 читается и в фазе 4.

### Ключевые решения
- **2.5D — объёмный вид сверху, не изометрия** (выбор пользователя). Клетки и камера прежние, поэтому
  `screenToTile`, путь и правила не меняются. Высокие объекты перекрывают клетки за собой: силуэты задаёт чистая
  `view.tallBox(kind, x, y)`, касание проверяет их внутри существующего `tapAction` (ближний к зрителю побеждает),
  поэтому мышь, тап и `E`/`Пробел` (`pickFront`) работают одинаково.
- **Свет**: направление общее (`Fx.LIGHT`, сверху слева). Падающие тени — скошенные силуэты вниз вправо, их длина
  и прозрачность зависят от времени суток. Ночью тени почти исчезают, светятся окна, фонари и кузница.
- **Спрайты**: свой кэш в `art.js` по образцу `winter` (`key|сезон|dpr`, LRU), при смене сезона кэш очищается.
  `Fx.bake` — только для градиентов (тени, свечения). Свет дня и ночи — слоем поверх кадра (`multiply` тоном
  `sunAt().tint`, затем `lighter` для огней), а не в спрайтах. В `fx.js` ничего не добавляется.
- **`houses.js`**: зданий станет 21, поэтому их рисование выносится из `art.js`. Интерфейс:
  `VillageHouses.create({ T, Fx, sprite, palette, helpers })` → `{ draw(g, id, stage, box, look), lights(id, box) }`;
  `helpers` — общие `rect`, `poly`, `ellipse`, `shadow` из `art.js`. `lights` отдаёт точки окон для ночного слоя.
- **Время в правилах — общие хуки**: `step` и `offline` вызывают одни и те же `onDawn(s)` и `onSeason(s)` при
  переходе через рассвет и смену сезона (полив сбрасывается, грядки дозревают, приходят заказы, пасека засыпает).
  `offline` идёт по 1 с, как сейчас, и проверяет переходы на каждом шаге.
- **Ночь и зима не наказывают**: доход жителей и мастерских не меняется. Зимой грядки отдыхают, кусты не
  плодоносят и не отрастают, пасека спит.
- **Монеты** — новый ресурс без лимита амбара: их дают только заказы, тратятся только на ярмарке.
- **Здания до и после праздника**: `garden`, `apiary`, `market` входят в `needs` часовни (обязательны для праздника).
  Здания хутора помечаются `after: 'festival'`, стоят в `BUILDINGS` после `chapel` (порядок зависимостей) и не нужны
  для первого праздника. `nextGoal` после праздника ведёт по хутору, а украшения предлагает, когда хутор готов.
- **Хутор — закрытая тропа**: новая клетка `'t'` (тропа через холм) непроходима до `road`, как `'b'` до моста.
  Зона `hamlet` — все клетки с `x ≥ 48`. `scatterNodes` раскладывает узлы с открытыми мостом и тропой.

## Technical Details

### Часы и сезоны (`core.js`)
```js
const DAY = 480;               // секунд в сутках
// фаза 0..1: 0..0.05 рассвет, ..0.75 день, ..0.85 вечер, ..1 ночь
const SEASON_DAYS = 3;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
clock(s) -> { day, phase, part: 'dawn'|'day'|'dusk'|'night', season, seasonDay, year }
```
- Игра начинается весной, утром первого дня (`s.t` от 0). События `{ type: 'dawn' }`, `{ type: 'season', season }`
  в `step`; в `offline` они только считаются в сводке.
- Сезонные множители: грядки весна 1, лето 1.25, осень 0.8, зима 0; кусты и мёд зимой 0; яблоки — лето и осень;
  виноград — лето и осень (иначе второй финал упирается в одну осень в год, см. баланс).

### Новые ресурсы
`vegetables` (Овощи), `honey` (Мёд), `apples` (Яблоки), `grapes` (Виноград), `juice` (Сок), `coins` (Монеты).
Амбар ограничивает все, кроме монет; ручной сбор, как и раньше, идёт сверх лимита.

### Новые здания (в общую таблицу `BUILDINGS`, по порядку зависимостей)
| id | Знак на карте | Название | Нужно | Эффект |
|---|---|---|---|---|
| `garden` | `G` | Огород | `well` | 6 грядок `g` рядом |
| `apiary` | `P` | Пасека | `garden`, `house1` | мёд сам, кроме зимы |
| `market` | `R` | Ярмарочные ряды | `house2` | доска заказов, ярмарка в первый день сезона |
| `chapel` | `C` | (как было) | + `garden`, `apiary`, `market` | Праздник села |
| `road` | `t` (тропа) | Дорога через холм | `chapel` | открывает хутор |
| `vineyard` | `V` | Виноградник | `road` + черенки с ярмарки | 6 лоз (сбор летом и осенью) |
| `press` | `D` | Давильня | `vineyard` | мастерская: 3 винограда → 1 сок |
| `house4` | `4` | Дом пасечника | `road`, `apiary` | житель: мёд ×2 |
| `house5` | `5` | Дом садовника | `road` | житель: яблоки летом и осенью |
| `harvest` | `U` | Дом урожая | `press`, `house4`, `house5` | второй финал — Праздник урожая |

Цены подбирает бот.

### Огород и ведро
- Грядки — клетки `g` на карте у огорода (6 штук), непроходимые, как узлы; `NODE_SITES` и рассадка их обходят.
  Состояние: `s.plots[i] = { stage: 'empty'|'planted'|'ripe', water: bool, grow: 0..1 }`.
- Посадить — 1 ягода (семена), полить — 1 заряд ведра, рост — 1 сутки при поливе (с сезонным множителем),
  сбор — 4 овоща (корзина 2 и 3: 5 и 6). Политая грядка держит воду до рассвета (`onDawn`).
- Ведро: `s.bucket` 0..6 (10 после покупки на ярмарке). У готового колодца действие наполняет ведро; у руины
  колодца, как и раньше, открывается панель «Внести».
- Новые цели `interact()` и `tapAction`: `plot`, `well` (наполнить), `board` (заказы), `stall` (ярмарка).

### Заказы и ярмарка
- Доска на рядах (после `market`): до 3 заказов, новый на рассвете (`onDawn`), по `s.rng` и только из открытых
  ресурсов, поэтому заказ всегда выполним. Заказ: `{ id, who, need: {...}, reward: { coins } }`.
- `fulfill(s, orderId)`: `'ok' | 'none' | 'cost'`.
- Ярмарка: первый день каждого сезона, днём. Товары: черенки винограда, украшения (качели, колодезный журавль,
  пугало, арка с цветами), ведро на 10. Черенки продаются на каждой ярмарке.
- `buy(s, itemId)`: `'ok' | 'closed' | 'coins' | 'owned'`.
- «Следующее дело» знает про заказы и ближайшую ярмарку.

### Хутор (`MAP`)
- Карта 48×36 → 64×36. Колонки 48–63: холм с тропой `t` (закрыта до `road`), сад с яблонями (узел `apple`,
  корзина), поле с виноградником `V`, площадка хутора с домами `4`, `5`, давильней `D` и Домом урожая `U`.
- Новые колонки справа, поэтому координаты старой части карты не меняются.
- Узел `apple` в `NODE_KINDS`, зона `hamlet` в `ZONE_NODES`; несколько яблонь стоят и у огорода (фаза 3).

### Сохранения
- `VERSION = 2` в фазе 2. `load()` для сейва старой версии возвращает новую игру с `recovered: 'old'`
  (для мусора — по-прежнему `recovered: true`).
- `game.js`: при `'old'` старая копия откладывается в `village.save.v1`, игроку показывается «Новая версия — новое
  село», облачный код забывается (старая облачная копия не перезаписывается молча). Облачная загрузка сейва старой
  версии показывает то же сообщение.
- `VERSION = 3` в фазе 5: сейв v2 переносится — ресурсы, здания, инструменты, жители, грядки и заказы сохраняются,
  узлы раскладываются заново по сиду (карта изменилась).

### 2.5D: чистые помощники (`view.js`)
- `tallBox(kind, x, y)` — прямоугольник силуэта над клеткой для дерева, камня, куста, здания по стадии.
- `edgeMask(map, x, y)` — с каких сторон клетки нужна мягкая тень (вода, дорожки, фундаменты).
- `sunAt(phase, season)` → `{ tint, shadowLen, shadowAlpha, glow }`.
- `palette(season, t)` — цвета травы, листвы, воды; плавный переход в первые сутки сезона.
- `tapAction` проверяет силуэты (`tallBox`) до клетки; `pickFront` знает новые цели.

### Рисование (`art.js`, `houses.js`)
- Порядок кадра не меняется: земля кусками → вода → мост → всё стоящее по линии основания → частицы → свет дня и
  ночи → тени облаков → виньетка. Падающие тени рисуются до стоящих объектов.
- Бюджет: не больше 300 частиц, DPR ≤ 2, спрайты запекаются лениво.

### Баланс (что меняется в `balance.test.js`)
- Сид 1: Праздник села на 140–170-й минуте (было 120–210), колодец на 1–3-й, Праздник урожая через 80–110 минут после
  праздника села, пауза ≤ 15 минут.
- `BALANCE=1`, 20 сидов: все здания без `after: 'festival'` готовы к празднику, праздник ≤ 4 ч, Праздник урожая
  ≤ 6 ч от начала, пауза ≤ 15 минут.
- `maxGap` считает новые здания, инструменты, амбар, выполненные заказы и покупки на ярмарке.
- Прогон по умолчанию остаётся быстрым (меньше 20 с): если вся игра до второго финала не укладывается, по умолчанию
  проверяется только сид 1, а остальное — под `BALANCE=1`.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): всё делается в этом репозитории — код, тесты, документация.
- **Post-Completion** (без чекбоксов): ручная проверка на телефонах, ощущение баланса, выпуск образа.

## Implementation Steps

### Фаза 1 — объёмная графика (правила не меняются)

### Task 1: Подключить fx.js и силуэты для касания

**Files:**
- Modify: `web/village/index.html`
- Modify: `web/village/style.css`
- Modify: `web/village/view.js`
- Modify: `web/village/game.js`
- Modify: `tests/village/lang.test.js`
- Modify: `tests/village/view.test.js`

- [x] подключить `../fx.js` после `../nav.js`; обновить точный список скриптов в `lang.test.js`
- [x] добавить в `lang.test.js` проверки как в `winter`: только относительные пути, выше папки грузятся только общие скрипты, без сети
- [x] ➕ убрать Google Fonts из `index.html`: шрифты системные, как в остальных играх (иначе игра ходила в сеть)
- [x] `view.tallBox`, `view.houseBox` и `view.tapAt` (точка мира → ближний силуэт, иначе клетка → `tapAction`); `game.js` берёт касание через `tapAt` (в режиме украшений — по клетке)
- [x] write tests: `tallBox` по видам, касание кроны над чужой клеткой, ближний силуэт побеждает, крыша, мост плоский, пустое место — прежнее поведение
- [x] run tests - must pass before next task
- ⚠️ кэш спрайтов перенесён в Task 3: до неё ему нечего кэшировать

### Task 2: Земля и вода в 2.5D

**Files:**
- Modify: `web/village/view.js`
- Modify: `web/village/art.js`
- Modify: `tests/village/view.test.js`

- [x] `view.edgeMask(map, x, y)`; куски земли с мягкой тенью у кромок воды, дорожек, площади и фундаментов
- [x] вода: градиент глубины, береговая кромка с пеной, блики по направлению света, кувшинки с тенью
- [x] мост: объёмные доски и опоры с тенью на воде
- [x] write tests: `edgeMask` у воды, у края карты, в чистом поле
- [x] скриншот через `smoke.cjs` в scratchpad для ручной проверки
- [x] run tests - must pass before next task

### Task 3: Деревья, камни, кусты и глина в 2.5D

**Files:**
- Modify: `web/village/art.js`
- Modify: `web/village/view.js`
- Modify: `tests/village/view.test.js`

- [x] кэш спрайтов из `winter/game.js:646` в `art.js` (ключ с сезоном, LRU, `clear()`)
- [x] деревья: ствол `Fx.cylinder`, крона из нескольких `Fx.sphere` с бликом, падающая тень, покачивание
- [x] камни, глина, кусты, пни, ростки: объём, контактная тень, спрайты в кэше
- [x] уточнить размеры в `tallBox` по готовой отрисовке
- [x] write tests: силуэты не шире 1¼ клетки и не выше 1½, касание рядом с деревом — не дерево (размеры спрайтов берутся из `NODE_TALL`, поэтому отрисовка и касание совпадают)
- [x] run tests - must pass before next task

### Task 4: Здания в 2.5D, вынос в houses.js

**Files:**
- Create: `web/village/houses.js`
- Modify: `web/village/art.js`
- Modify: `web/village/index.html`
- Modify: `main_test.go`
- Modify: `tests/village/lang.test.js`

- [ ] `VillageHouses.create({ T, Fx, sprite, palette, helpers })` → `{ draw, lights }`; перенести туда `house`, `roof`, `door`, `windowBox`, `drawRuin`, `drawScaffold`, `ART[id]`
- [ ] стены — `Fx.block`/`Fx.prism` с освещённой и теневой гранью, скаты крыш разного тона, трубы, падающие тени
- [ ] три стадии (руина, леса, готово), анимация достройки (`easeBack`) сохраняется
- [ ] `houses.js` в `main_test.go`, в списке скриптов (перед `art.js`) и в скане RO `lang.test.js` (вместе с `art.js`)
- [ ] write tests: `go test ./...`, `lang.test.js`
- [ ] run tests - must pass before next task

### Task 5: Люди, куры и эффекты праздника

**Files:**
- Modify: `web/village/art.js`
- Modify: `tests/village/smoke.cjs`

- [ ] люди и куры: тела `Fx.bean`, тени, затенённая сторона, инструменты с бликом
- [ ] частицы, щепки, салют, гирлянды, бабочки — на `Fx.Particles` и `Fx.glow`, не больше 300 частиц
- [ ] `smoke.cjs`: кадр не плоский (разброс цвета), нет ошибок консоли
- [ ] write tests: `smoke.cjs` проходит; unit-тесты зелёные
- [ ] run tests - must pass before next task

### Фаза 2 — день, ночь и сезоны

### Task 6: Часы мира, общие хуки и версия сохранения 2

**Files:**
- Modify: `web/village/core.js`
- Modify: `web/village/game.js`
- Modify: `web/village/lang.js`
- Create: `tests/village/clock.test.js`
- Create: `tests/village/save.test.js`
- Modify: `tests/village/core.test.js`

- [ ] `DAY`, `SEASON_DAYS`, `SEASONS`, `clock(s)`; `onDawn`/`onSeason` вызываются из `step` и из цикла `offline`
- [ ] `VERSION = 2`; старая версия → новая игра с `recovered: 'old'`
- [ ] `game.js`: копия в `village.save.v1`, сообщение «Новая версия — новое село», облачный код забывается; то же при облачной загрузке
- [ ] write tests: границы суток и сезонов, переход через год, события ровно один раз при большом `dt`; офлайн через рассвет и сезон вызывает хуки столько же раз, сколько `step`
- [ ] write tests: v1 → `'old'`, мусор → `true`, v2 туда-обратно без потерь, мусор в полях отбрасывается; строки RO
- [ ] run tests - must pass before next task

### Task 7: Свет дня и ночи

**Files:**
- Modify: `web/village/view.js`
- Modify: `web/village/art.js`
- Modify: `web/village/houses.js`
- Modify: `web/village/game.js`
- Modify: `web/village/lang.js`
- Modify: `tests/village/view.test.js`

- [ ] `sunAt(phase, season)`: тон, длина и прозрачность теней, сила свечения
- [ ] ночной слой: окна готовых домов (`lights`), фонари-украшения, кузница, светлячки летом
- [ ] часы и сезон в HUD (солнце/луна, название сезона), переводы RO
- [ ] write tests: полдень светлее полуночи, соседние фазы без скачков, все поля в допустимых пределах
- [ ] run tests - must pass before next task

### Task 8: Сезонные палитры и сезонные правила

**Files:**
- Modify: `web/village/core.js`
- Modify: `web/village/view.js`
- Modify: `web/village/art.js`
- Modify: `tests/village/gather.test.js`
- Modify: `tests/village/view.test.js`
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`

- [ ] правила: зимой кусты не плодоносят и не отрастают (и онлайн, и офлайн)
- [ ] `palette(season, t)`: весенние цветы, густое лето, осенняя листва и листопад, зимний снег и лёд на реке
- [ ] куски земли и спрайты по сезону, кэш очищается на смене сезона
- [ ] бот запасает ягоды до зимы (их требуют `house3` и `chapel`); `balance.test.js` зелёный
- [ ] write tests: кусты зимой и весной, офлайн через зиму, `palette` даёт разные цвета и плавный переход
- [ ] run tests - must pass before next task

### Фаза 3 — огород и ферма

### Task 9: Огород, грядки и ведро

**Files:**
- Modify: `web/village/core.js`
- Modify: `web/village/view.js`
- Create: `tests/village/farm.test.js`
- Modify: `tests/village/build.test.js`
- Modify: `tests/village/view.test.js`
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`

- [ ] клетки `G` и `g` в `MAP`; ресурс `vegetables`; здание `garden` (нужен `well`), входит в `needs` часовни
- [ ] `s.plots`, `s.bucket`; цели `plot` и `well` в `interact()`, `tapAction`, `pickFront`
- [ ] рост с поливом и сезоном, вода до рассвета, офлайн дозревание через общие хуки
- [ ] `build.test.js`: `ALL_BUT_CHAPEL` и проверки часовни с огородом; бот сажает, поливает, собирает
- [ ] write tests: полный цикл грядки, без воды не растёт, зимой не сажается, пустое ведро, корзина 2 и 3, колодец-руина и готовый колодец, офлайн = step
- [ ] run tests - must pass before next task

### Task 10: Пасека и яблони

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/farm.test.js`
- Modify: `tests/village/build.test.js`
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`

- [ ] ресурсы `honey`, `apples`; здание `apiary` (мёд сам, кроме зимы, в лимите амбара), входит в `needs` часовни
- [ ] узел `apple` (корзина, плоды летом и осенью), пара яблонь у огорода
- [ ] мёд и овощи входят в цены поздних зданий (`house3`, `chapel`) вместо части ягод
- [ ] write tests: мёд по сезонам и лимит амбара, яблоки только летом и осенью, офлайн через зиму = step
- [ ] бот собирает мёд и яблоки; `balance.test.js` зелёный
- [ ] run tests - must pass before next task

### Task 11: Рисование и управление фермой

**Files:**
- Modify: `web/village/houses.js`
- Modify: `web/village/art.js`
- Modify: `web/village/game.js`
- Modify: `web/village/lang.js`
- Modify: `tests/village/view.test.js`

- [ ] огород, грядки по стадиям, пасека с ульями и пчёлами, яблони с плодами, брызги полива
- [ ] действие по цели: посадить / полить / собрать / наполнить ведро; ведро в HUD
- [ ] «Следующее дело» учитывает огород; переводы RO
- [ ] write tests: `tapAction`/`pickFront` дают нужное действие для каждой стадии грядки и для колодца; `lang.test.js` зелёный
- [ ] run tests - must pass before next task

### Фаза 4 — заказы жителей и ярмарка

### Task 12: Заказы жителей

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/orders.test.js`
- Modify: `tests/village/build.test.js`
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`

- [ ] ресурс `coins` (без лимита амбара); здание `market` (нужен `house2`), входит в `needs` часовни
- [ ] доска до 3 заказов, новый в `onDawn`, генератор по `s.rng` только из открытых ресурсов; `fulfill`
- [ ] `maxGap` в боте считает выполненные заказы
- [ ] write tests: заказ всегда выполним, не больше 3, `'none'`/`'cost'`, награда, офлайн через рассвет = step
- [ ] бот выполняет заказы; `balance.test.js` зелёный
- [ ] run tests - must pass before next task

### Task 13: Сезонная ярмарка

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/orders.test.js`
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`

- [ ] ярмарка в первый день сезона днём; товары: черенки, украшения (качели, журавль, пугало, арка), ведро на 10; `buy`
- [ ] новые украшения в `DECOR`, доступны после покупки
- [ ] write tests: открыта только в свой день, `'closed'`/`'coins'`/`'owned'`, черенки на каждой ярмарке
- [ ] бот покупает, покупки идут в `maxGap`; `balance.test.js` зелёный
- [ ] run tests - must pass before next task

### Task 14: Панели заказов и ярмарки

**Files:**
- Modify: `web/village/view.js`
- Modify: `web/village/game.js`
- Modify: `web/village/index.html`
- Modify: `web/village/style.css`
- Modify: `web/village/houses.js`
- Modify: `web/village/lang.js`
- Modify: `tests/village/view.test.js`
- Modify: `tests/village/smoke.cjs`

- [ ] цели `board` и `stall` в `tapAction`/`pickFront`; панель заказов (клик или `O`), панель ярмарки, монеты в HUD
- [ ] ряды с навесами, флажки и торговцы в дни ярмарки
- [ ] переводы RO; на телефоне всё через кнопки панели
- [ ] write tests: `view.test.js` — цели доски и рядов; `lang.test.js`; `smoke.cjs` открывает обе панели
- [ ] run tests - must pass before next task

### Фаза 5 — хутор за холмом

### Task 15: Шире карта, тропа и зона хутора

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/hamlet.test.js`
- Modify: `tests/village/core.test.js`
- Modify: `tests/village/gather.test.js`
- Modify: `tests/village/save.test.js`
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`

- [ ] `MAP` 64×36 с тропой `t`; `groundWalkable` закрывает `t` до `road`; зона `hamlet` (`x ≥ 48`) в `ZONES` и `ZONE_NODES`
- [ ] `scatterNodes` заливает с открытыми мостом и тропой; здание `road` (после `chapel`, `after: 'festival'`)
- [ ] `VERSION = 3`, перенос v2 → v3 (всё, кроме узлов)
- [ ] `nextGoal` после праздника ведёт к `road`; бот знает тропу в `reachable()`; `balance.test.js` зелёный
- [ ] write tests: до дороги на хутор не пройти, после — путь есть; все строки карты одной длины; каждая зона достижима; узлы хутора разложены; перенос v2 → v3
- [ ] run tests - must pass before next task

### Task 16: Здания хутора и Праздник урожая

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/hamlet.test.js`
- Modify: `tests/village/build.test.js`
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`

- [ ] ресурсы `grapes`, `juice`; здания `vineyard` (нужны черенки), `press` (3 → 1), `house4`, `house5`, `harvest` — все `after: 'festival'`, в порядке зависимостей
- [ ] жители: пасечник (мёд ×2), садовник (яблоки летом и осенью); `harvest` даёт событие и `s.harvestFestival`
- [ ] `nextGoal` ведёт по хутору, украшения — после Дома урожая; `balance.test.js`: «все здания» = без `after: 'festival'`
- [ ] write tests: цепочка зависимостей, давильня с запасом, жители по сезонам, второй финал ровно один раз, праздник села не требует хутора
- [ ] бот строит хутор; `balance.test.js` зелёный
- [ ] run tests - must pass before next task

### Task 17: Рисование хутора

**Files:**
- Modify: `web/village/houses.js`
- Modify: `web/village/art.js`
- Modify: `web/village/view.js`
- Modify: `web/village/lang.js`
- Modify: `tests/village/view.test.js`
- Modify: `tests/village/smoke.cjs`

- [ ] холм с тропой и тенью склона, сад, ряды винограда, давильня, два дома, Дом урожая; силуэты в `tallBox`
- [ ] Праздник урожая: снопы, корзины, гирлянды из листьев, свои фейерверки; переводы RO
- [ ] write tests: `tallBox` для новых зданий, `lang.test.js`, `smoke.cjs` рисует хутор из сейва бота
- [ ] run tests - must pass before next task

### Фаза 6 — доводка

### Task 18: Звуки

**Files:**
- Modify: `web/village/audio.js`
- Modify: `tests/village/audio.test.js`

- [ ] ночью сверчки вместо птиц, зимой тихий ветер, пчёлы у пасеки, плеск полива, ярмарочный наигрыш, колокол урожая
- [ ] write tests: новые звуки есть и не падают без `AudioContext`
- [ ] run tests - must pass before next task

### Task 19: Баланс всей игры

**Files:**
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`
- Modify: `web/village/core.js`

- [ ] подобрать цены под границы из «Баланс» в Technical Details
- [ ] замерить время прогона; если больше 20 с — второй финал только под `BALANCE=1`
- [ ] write tests: новые границы обоих финалов, паузы с заказами и покупками, игра не застревает зимой
- [ ] run tests - must pass before next task

### Task 20: Verify acceptance criteria
- [ ] все цели Overview сделаны: 2.5D, день и сезоны, огород и ферма, заказы и ярмарка, хутор и второй финал
- [ ] края: сейв v1 и облачный код v1, перенос v2 → v3, офлайн 8 часов через зиму, ярмарка при открытой вкладке на смене суток
- [ ] run full test suite: `node --test 'tests/**/*.test.js'` и `go test ./...`; `BALANCE=1` прогон
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
- плавность кадра на слабом телефоне (DPR 2, много огней ночью на празднике)
- темп: не скучно ли зимой, не слишком ли редко ярмарка

**External system updates**:
- игроки с сейвом v1 начнут заново — предупредить в заметках к выпуску
- выпуск образа Docker после слияния (как обычно, через `release-image.yml`)
