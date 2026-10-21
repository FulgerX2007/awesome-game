# «Родник» 3: озеро и пристань

## Overview
- Третья глава «Родника» (`/village/`). Сейчас игра кончается Праздником урожая на хуторе. После него остаются только
  заказы, ярмарка и украшения, а монеты тратить почти некуда.
- Новая глава открывается **после Праздника урожая**. Карта растёт на юг: за полосой старого леса лежит озеро.
  Порядок прохождения:
  1. Просека через лес.
  2. Мостки (пристань). Они дают удочку и открывают места клёва.
  3. Рыбалка — мини-игра: заброс, поклёвка, «Подсечь!».
  4. Коптильня (рыба → копчёная рыба), Дом рыбака (новый житель) и Лодочный сарай. Для сарая нужна лодка с ярмарки
     за монеты.
  5. Финал — **Праздник фонариков** у Беседки на воде.
- Глава рассчитана примерно на 60–90 минут игры после Праздника урожая. Пауза без нового — не больше 16 минут,
  это проверяет бот баланса.
- Сохранения **не теряются**. Сейвы версий 2 и 3 грузятся как есть, и пройденное село сразу продолжается новой главой.
  Деревья, камни и кусты старых частей карты остаются на своих местах вместе с их состоянием.
- Монеты нужны по-настоящему: глава тратит больше монет, чем бот накопил к Празднику урожая (сейчас 122 на сиде 1).
- Игра остаётся спокойной: нет врагов, проигрыша и штрафов. Сорвавшаяся рыба уплывает, заброс повторяется сам.
  После трёх срывов подряд ловля сама прекращается («рыба ушла»), чтобы не шуметь, пока игрок отошёл.

## Context (from discovery)
- Файлы игры: `web/village/`.
  - `core.js` (1342 строки) — правила без DOM: карта ASCII 64×36, зоны, узлы, здания, мастерские, жители, заказы,
    ярмарка, офлайн, сейвы.
  - `view.js` — чистые помощники: `tapAction`, `tapAt`, `pickFront`, `soundFor`, плоские здания `bridge`/`road`.
  - `art.js` — отрисовка 2.5D, `BOX`/`ART` по зданиям, `LOOKS` жителей; образец — тропа через холм (`art.js:825`).
  - `game.js` — HUD (`renderHUD` берёт `#r-<res>` для каждого `RES_IDS`), `act()`, клавиши, модалки праздников,
    `RES_UNLOCK`, описания зданий, жители-«куклы» (`ROLE_NODE`).
  - `audio.js`, `lang.js` (RO), `index.html`, `style.css` (иконки ресурсов — инлайн SVG).
- Образец главы — хутор:
  - здания с `after: 'festival'`;
  - закрытый проход `'t'` шириной 3, который открывает `road`;
  - зона `hamlet`;
  - покупка на ярмарке, без которой не построить (`bought: 'cuttings'`);
  - флаг финала `s.harvestFestival`;
  - тесты `tests/village/hamlet.test.js`.
- Сейвы:
  - `load()` поднимает `v: 2` до текущей версии (core.js:1205);
  - `restore()` берёт hp только у узлов с тем же id, видом и клеткой (core.js:1228);
  - финалы и покупки восстанавливаются из построенных зданий (core.js:1298, :1320).
- `newGame()` сохраняет `s.rng` **после** раскладки узлов (core.js:389, :396). Новые розыгрыши в раскладке сдвинули бы
  все случайности игры: восстановление, заказы.
- Баланс сейчас (сид 1, замер рецензента):

  | что | сейчас | допуск |
  |---|---|---|
  | праздник | 143,5 мин | 140–170 |
  | урожай после праздника | +79,9 мин | 75–110 |
  | самая длинная пауза | 15,3 мин | 16 |
  | монеты к урожаю | 122 | — |

  Запас маленький, поэтому старые части игры трогать нельзя.
- Существующие тесты, которые задевает глава:

  | файл | что проверяет |
  |---|---|
  | `core.test.js:11-14` | высота 36, регэксп символов карты |
  | `core.test.js:26-38` | число узлов по зонам = `ZONE_NODES` |
  | `core.test.js:83-105` | вся проходимая земля связна |
  | `core.test.js:117` | точный список инструментов |
  | `core.test.js:181` | сумма `ZONE_NODES` |
  | `gather.test.js:267-290` | набор зон; всё достижимо с мостом и дорогой |
  | `hamlet.test.js:28-32` | холм по всей высоте |
  | `hamlet.test.js:107`, `build.test.js:301` | после урожая цель — `decor` |
  | `build.test.js:299` | `finish()` покупает только `cuttings` |
  | `balance.test.js:37`, `:51` | урожай считается от `r.t`; все здания построены |
  | `lang.test.js:24-36` | RO для всех таблиц |
  | `lang.test.js:140-144` | `LOOKS` для каждого жителя |
  | `save.test.js:19` | название «v2 loads into v3» |
  | `smoke.cjs:353-371` | весь хутор, 5 жителей |

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
- **CRITICAL: all tests must pass before starting next task** - no exceptions, включая `balance.test.js` и `smoke.cjs`.
  Имя, ресурс или житель приходит вместе с переводом RO, слотом HUD и заглушкой рисунка, чтобы страница не падала.
- **CRITICAL: update this plan file when scope changes during implementation**
- run tests after each change: `node --test 'tests/**/*.test.js'`, `go test ./...`, `node tests/village/smoke.cjs`
- обратная совместимость: сейвы v2/v3 грузятся, старые узлы и сроки двух праздников не меняются, другие игры,
  `fx.js` и API сервера не меняются

## Testing Strategy
- **unit tests**: в каждой задаче (`node --test`). Новые файлы:
  - `tests/village/lake.test.js` — карта, здания, глава;
  - `tests/village/fishing.test.js` — мини-игра.
- **snapshot старой раскладки**: до правок снять узлы `newGame(seed)` для сидов 1…50 (вид, клетка, порядок) и `s.rng`
  в `tests/village/fixtures/nodes-v3.json`. После правок старые узлы и `s.rng` совпадают с ним.
- **balance**: бот проходит главу до Праздника фонариков, сроки проверяет `balance.test.js`.
- **e2e**: `node tests/village/smoke.cjs` (Playwright, Chromium в `/opt/pw-browsers/chromium`):
  - озеро рисуется без ошибок;
  - рыбалка с телефона: тап по месту, поклёвка, «Подсечь!», рыбы стало больше;
  - сейв v3 продолжается главой;
  - Праздник фонариков.

## Progress Tracking
- mark completed items with `[x]` immediately when done
- add newly discovered tasks with ➕ prefix
- document issues/blockers with ⚠️ prefix
- update plan if implementation deviates from original scope
- keep plan in sync with actual work done

## Solution Overview
- **Глава = третий этап `after`.** Здания озера получают `after: 'harvest'`. `nextGoal()` выбирает этап так:
  `s.harvestFestival ? 'harvest' : s.festival ? 'festival' : undefined`. Вклады, зависимости, подсказка и панели
  работают без изменений.
- **Карта растёт вниз, старое не двигается.** Существующие 36 строк не меняются, снизу добавляются 14 новых
  (y = 36…49):
  - полоса старого леса `&` (никогда не проходима, для заливки как край карты) с просекой `ooo` шириной 3, как `ttt`;
  - река проходит через лес водой `~` без берегов, чтобы не было обхода просеки;
  - берег `:`, озеро `~`;
  - место мостков `jjj…` (вода, пока мостки не построены, как мост `b`);
  - места клёва `f`;
  - руины четырёх зданий.
- **Зона `lake`** (`y ≥ LAKE_Y = 36`) проверяется раньше остальных. Её узлы:
  - стоят последними в `ZONE_NODES`;
  - раскладываются **отдельным генератором** `rng(seed ^ LAKE_SALT)`, поэтому `s.rng` и старые узлы не меняются;
  - буферы `NODE_SITES` у `o`/`j` и у новых руин действуют только в строках `y ≥ LAKE_Y`.
- **Рыбалка в правилах (вариант A).**
  - Места клёва — узлы вида `shoal` («Косяк рыбы») на фиксированных клетках `f`. У каждого свой запас (hp)
    и восстановление, как у деревьев.
  - Тап по месту ведёт игрока к берегу или мосткам и начинает ловлю: `cast → wait → bite → (strike | escape) → cast …`.
  - Время поклёвки берётся из `s.rng`, поэтому всё детерминировано.
  - Удочка `rod` — пятый инструмент. Уровень 0 до мостков (как лопата до моста); уровни 2–3 шире открывают окно
    подсечки и дают больше рыбы за поклёвку.
- **Монеты в деле.** Лодка (`FAIR.boat`, продаётся только после Праздника урожая) нужна для Лодочного сарая. В цене
  Беседки есть монеты. Рыба и копчёная рыба попадают в заказы. Глава тратит монет больше, чем есть к её началу.
- **Сейвы.** `VERSION = 4`. v2 и v3 поднимаются до v4 как есть. `s.lanternFestival` восстанавливается из построенной
  беседки. Ловля `player.fish` временная и в сейв не идёт.

## Technical Details
- **Ресурсы:** `fish: { name: 'Рыба' }`, `smoked: { name: 'Копчёная рыба' }`. `RES_IDS` удлиняется до 14.
- **Узел:** `shoal: { name: 'Косяк рыбы', res: 'fish', hp: 3, tool: 'rod', regrow: [150, 300] }`.
  - Клетки `f` идут списком `SPOTS`, как `PLOTS`.
  - Узлы `shoal` добавляются после случайных и продолжают их id.
  - У каждого `f` есть соседняя по 4 сторонам клетка берега или мостков.
- **Инструмент:**
  - `rod: { name: 'Удочка', node: 'shoal', start: 0, costs: { 2: { planks: 60, wood: 40 }, 3: { bricks: 40, planks: 80 } } }`;
  - `applyEffect('pier')` даёт `rod = 1`.
- **Рыбалка:**
  ```js
  const FISHING = { wait: [2, 6], window: [0, 0.9, 1.2, 1.5], early: 1.5, giveUp: 3 }; // секунды; окно по уровню
  // player.fish = { id, phase: 'wait' | 'bite', at, misses } — временное, в TRANSIENT_PLAYER
  // interact(): shoal → 'tool' без удочки, иначе путь к соседней клетке, цель { type: 'fish', id } → 'fish'
  // tick(): ветка target.type === 'fish' (как gatherTick: проверка NEAR_NODE, иначе repath)
  //   нет p.fish → заброс (событие 'cast'); 'wait' и s.t ≥ at → 'bite'; 'bite' и s.t ≥ at → 'escape', misses+1,
  //   новый заброс; misses = giveUp → конец ловли (событие 'gone')
  // strike(s) → 'catch' | 'early' | 'none'
  //   catch: +TOOL_YIELD[rod] рыбы, hp−1, misses = 0, событие 'catch'; hp = 0 → 'deplete' и конец ловли
  //   early: ожидание + FISHING.early, событие 'early'
  // stopFishing(s): конец ловли (кнопка «Смотать»)
  ```
  Отмена ловли:
  - `setOrder` (любой новый тап) и `clearOrder` (клавиши) чистят `p.fish`;
  - `repath` знает цель `'fish'`;
  - `offline()` в начале прекращает ловлю, чтобы после возвращения не было поклёвки с устаревшим `at`.
- **Здания** (стартовые цены, их подбирает бот):

  | id | имя | цена | нужно | эффект |
  |---|---|---|---|---|
  | `glade` | Просека к озеру | wood 300, stone 200 | harvest | открывает `o` |
  | `pier` | Мостки | planks 200, wood 150 | glade | открывает `j`, удочка 1 |
  | `smokehouse` | Коптильня | bricks 160, stone 150, planks 80 | pier | мастерская |
  | `house6` | Дом рыбака | planks 260, bricks 180, fish 40 | pier | житель |
  | `boathouse` | Лодочный сарай | planks 240, wood 120 | pier | — (`bought: 'boat'`) |
  | `pavilion` | Беседка на воде | planks 300, bricks 200, smoked 40, juice 30, honey 40, coins 120 | smokehouse, house6, boathouse | `lanterns` |

  - Мастерская коптильни: `smokehouse: { from: 'fish', to: 'smoked', ratio: 2, rate: 0.15 }`.
  - Житель: `fisher: { name: 'Рыбак', res: 'fish', rate: 0.1 }`, работает круглый год (зимой — подлёдный лов).
  - Лодка: `boat: { name: 'Лодка', price: 90, after: 'harvest' }`. `buy()` возвращает `'locked'` до урожая, панель
    ярмарки её не показывает.
  - Все цены в пределах амбара (400).
- **Заказы:** `ORDER_GOODS.fish = { n: 10, worth: 3 }`, `ORDER_GOODS.smoked = { n: 6, worth: 6 }`. `openGoods()`
  добавляет рыбу после мостков и копчёную рыбу после коптильни. До мостков розыгрыши заказов не меняются.
- **События для клиента:** `cast`, `bite`, `escape`, `catch` (с `gain`), `early`, `gone` и `lantern-festival`.
- **Клиент:**
  - Пока идёт ловля, тап по холсту = подсечка. Внизу полоска «Ждём поклёвку… / Подсекай!» с кнопками «Подсечь»
    и «Смотать».
  - Клавиши: пробел — подсечь (раньше `actFront()`), стрелки или WASD — уйти.
  - Игрок стоит лицом к воде с удочкой. Поплавок и леска, нырок на поклёвке, всплеск и «+N Рыба».
  - Зимой — лунка во льду.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): код, тесты, документация в этом репозитории
- **Post-Completion** (no checkboxes): ручная проверка на телефоне после деплоя, проверка своего сейва

## Implementation Steps

### Task 1: Save version 4 and a snapshot of today's node layout

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/save.test.js`
- Create: `tests/village/fixtures/nodes-v3.json`
- Create: `tests/village/layout.test.js`

- [ ] снять снимок до любых правок карты: для сидов 1…50 — `nodes` (id, вид, x, y) и `s.rng` из `newGame(seed)`;
      записать скрипт-генератор в комментарии теста
- [ ] поднять `VERSION` до 4; в `load()` сейвы `v: 2` и `v: 3` поднимать как есть, v1 по-прежнему `'old'`
- [ ] добавить `lanternFestival: false` в `newGame()`; добавить `fish` в `TRANSIENT_PLAYER`
- [ ] тест `layout.test.js`: узлы и `s.rng` совпадают со снимком (будет охранять задачи 2–6)
- [ ] тест: сейв v3 с пройденным хутором грузится без `recovered`, все узлы сохраняют hp; v2 грузится
      (переименовать тест в save.test.js:19); v1 даёт `'old'`; v5 и мусор дают `recovered: true`
- [ ] run tests - must pass before task 2

### Task 2: The lake on the map with its building data

**Files:**
- Modify: `web/village/core.js`
- Modify: `web/village/lang.js`, `web/village/art.js` (заглушки)
- Create: `tests/village/lake.test.js`
- Modify: `tests/village/core.test.js`, `tests/village/gather.test.js`, `tests/village/hamlet.test.js`,
  `tests/village/balance.test.js`

- [ ] дописать 14 строк к `MAP`:
  - лес `&` с просекой `ooo`;
  - река водой через лес;
  - берег, озеро, мостки `j`, места клёва `f`;
  - руины четырёх зданий;
  - обновить легенду карты
- [ ] данные шести зданий (`ch`, `cost`, `needs`, `after: 'harvest'`, `bought`) без эффектов
- [ ] `groundWalkable`/`isWalkable`: `o` открыта после `glade`, `j` — после `pier`
- [ ] `ZONES`: пропуск `& o j f`, зона `lake` первой; `ZONE_NODES.lake` последней (вместится на свободные `.`)
- [ ] `NODE_SITES`: буферы `o`/`j` и новых руин только при `y ≥ LAKE_Y`; раскладка `lake` своим генератором
      `rng(seed ^ LAKE_SALT)`
- [ ] узел `shoal` и `SPOTS`; узлы `shoal` после случайных
- [ ] RO для новых имён зданий и узла в `lang.js`; заглушки `BOX` для новых зданий в `art.js` (простая руина),
      чтобы страница рисовалась
- [ ] обновить старые тесты:
  - `core.test.js`: высота, регэксп, счёт узлов без `shoal`, связность с открытыми `glade`/`pier`;
  - `gather.test.js`: набор зон с `lake`, достижимость с `glade`/`pier`;
  - `hamlet.test.js:28`: только `y < LAKE_Y`;
  - `balance.test.js:51`: пока только здания без `after: 'harvest'` (до задачи 6)
- [ ] тест `lake.test.js`: лес закрывает озеро везде, кроме просеки, и река не даёт обхода; узлы `lake` за лесом
      и достижимы; каждое `f` — `shoal` на воде с соседней клеткой (DIRS4) на берегу или мостках
- [ ] тест: `layout.test.js` зелёный — старые узлы и `s.rng` не изменились
- [ ] run tests (с e2e) - must pass before task 3

### Task 3: Chapter gating — effects, goals, the finale

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/lake.test.js`, `tests/village/build.test.js`, `tests/village/hamlet.test.js`

- [ ] `applyEffect`:
  - `glade` и `pier` открывают проходы;
  - `pier` даёт удочку 1;
  - `lanterns` ставит `s.lanternFestival`;
  - `contribute` шлёт `lantern-festival`;
  - `restore` поднимает финал из беседки
- [ ] `nextGoal`: третий этап по `s.harvestFestival`
- [ ] `FAIR.boat` с `after: 'harvest'`; в `buy()` проверка этапа → `'locked'`
- [ ] обновить старые тесты: после урожая цель — `glade` (`hamlet.test.js:107`, `build.test.js:301`);
      `build.test.js:299` `finish()` покупает и `boat`
- [ ] тест: цепочка просека → мостки → коптильня / дом рыбака / сарай → беседка
- [ ] тест: до урожая ни одно здание озера и лодка недоступны; Праздники в селе и урожая не требуют озера
- [ ] тест: без лодки сарай `'locked'`, подсказка ведёт на ярмарку; сейв с беседкой восстанавливает `lanternFestival`
      и лодку в `bought`
- [ ] run tests - must pass before task 4

### Task 4: Lake economy — fish, smoked fish, rod, fisher, orders

**Files:**
- Modify: `web/village/core.js`
- Modify: `web/village/index.html`, `web/village/style.css`, `web/village/lang.js`, `web/village/art.js`
  (слоты HUD, иконки, RO, `LOOKS.fisher`)
- Modify: `tests/village/lake.test.js`, `tests/village/orders.test.js`, `tests/village/core.test.js`,
  `tests/village/lang.test.js`

- [ ] ресурсы `fish`, `smoked`; инструмент `rod` (start 0, уровни 2–3); житель `fisher`; мастерская `smokehouse`
- [ ] `ORDER_GOODS.fish/smoked`; `openGoods()` открывает их после мостков и коптильни
- [ ] слоты `#r-fish`, `#r-smoked` в HUD с иконками SVG «рыба» и «копчёная рыба»; `RES_UNLOCK`; RO для ресурсов,
      инструмента, жителя, лодки; `LOOKS.fisher` в `art.js`
- [ ] обновить старые тесты: `core.test.js:117` список инструментов; `lang.test.js` — иконок не меньше 14
- [ ] тест: удочка 0 до мостков (`upgradeTool` → `'locked'`), после — уровни 2–3 по обычным правилам
- [ ] тест: коптильня делает копчёную рыбу сверх запаса; рыбак ловит круглый год; до мостков в заказах нет рыбы,
      после — бывает; копчёная — только с коптильней
- [ ] run tests (с e2e) - must pass before task 5

### Task 5: Fishing mini-game in the rules

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/fishing.test.js`

- [ ] `FISHING`, состояние `player.fish`; `interact()` на `shoal` → `'fish'` (`'tool'` без удочки)
- [ ] ветка `'fish'` в `tick()` и `repath()`: заброс, ожидание, поклёвка, срыв, повторный заброс, `gone` после
      `giveUp` срывов
- [ ] `strike(s)` → `'catch'` / `'early'` / `'none'`; улов `TOOL_YIELD[rod]`; опустевший косяк → `deplete`
      и восстановление
- [ ] `setOrder` и `clearOrder` чистят ловлю; `stopFishing(s)`; `offline()` прекращает ловлю; экспорт `strike`,
      `stopFishing`, `FISHING`, `SPOTS`
- [ ] тест: подсечка в окне ловит; после окна рыба срывается и заброс повторяется; ранняя подсечка даёт `'early'`
      и более долгое ожидание; три срыва подряд → `gone`
- [ ] тест: окно и улов растут с уровнем удочки; один сид даёт ту же последовательность событий; подсечка ровно
      на краю окна
- [ ] тест: новый тап, клавиши, `stopFishing` и `offline` отменяют ловлю; `save()` её не пишет; `strike`
      без ловли → `'none'`
- [ ] run tests - must pass before task 6

### Task 6: Balance bot plays the lake chapter

**Files:**
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`
- Modify: `web/village/core.js` (подбор цен)

- [ ] бот:
  - `reachable` для зоны `lake`;
  - `fish` в `RAW`, монеты — отдельно: не хватает → выполнять заказы, а не ждать;
  - удочка в `TOOL_ORDER`;
  - свой цикл ловли шагами 0,05 с: подсечка через 0,3 с после `bite`, выход по `deplete`/`gone`, вместо
    `finishOrder`;
  - лодка в `WISH` только после урожая, на первой ярмарке;
  - режим `until: 'lanterns'`;
  - `harvestAt` в результате `play()`
- [ ] `balance.test.js`:
  - урожай считать от `harvestAt`;
  - вернуть проверку «все здания построены»;
  - снять монеты в момент урожая
- [ ] подобрать цены и скорости: на сиде 1 глава занимает 60–90 мин после урожая, паузы ≤ 16 мин, глава тратит
      монет больше, чем было к урожаю
- [ ] тест: сид 1 — сроки обоих старых праздников **не изменились** (те же минуты, что до главы)
- [ ] тест: фонарики через 60–90 мин после урожая; монет потрачено в главе больше, чем было к урожаю; после урожая
      выполнено не меньше 3 заказов
- [ ] тест: все сиды доходят до фонариков без тупика, все здания построены, пауза ≤ 16 мин, всё укладывается
      в `LIMIT` 6 ч. Бюджет времени прогона поднимать, только если без этого никак (записать здесь ⚠️)
- [ ] run tests - must pass before task 7

### Task 7: Tap logic and event sounds in view.js

**Files:**
- Modify: `web/village/view.js`
- Modify: `tests/village/view.test.js`

- [ ] `tapAction`: пока идёт ловля, тап → `{ type: 'strike' }`; тап по месту клёва → `fish`
- [ ] `pickFront` принимает `'fish'`; `tapAt` и плоские здания: `glade`/`pier` как `bridge`/`road`
- [ ] `soundFor`: `cast`, `bite`, `catch`, `escape`, `lantern-festival`
- [ ] тест: тап во время ловли — подсечка, без ловли — как раньше; построенные мостки плоские и проходимы для тапа
- [ ] тест: `soundFor` для новых событий
- [ ] run tests - must pass before task 8

### Task 8: Drawing the lake — terrain, pier, spots, fishing

**Files:**
- Modify: `web/village/art.js`
- Modify: `tests/village/smoke.cjs`

- [ ] лес `&` (плотные кроны 2.5D), просека с завалом до `glade` (по образцу тропы через холм), берег и озеро, река
      через лес, мостки по стадиям (как мост); `art.js:1510` — `glade`/`pier` лежат плоско
- [ ] места клёва: круги и тени рыб, пока косяк полон; зимой — лунки во льду; `chips('shoal')` для рыбака-куклы
- [ ] ловля: игрок лицом к воде с удочкой, поплавок, леска, нырок на поклёвке, всплеск при улове
- [ ] e2e: сейв с открытым озером рисуется без ошибок в консоли, на холсте есть пиксели воды у озера
- [ ] run tests - must pass before task 9

### Task 9: Drawing the lake buildings and the lantern festival

**Files:**
- Modify: `web/village/art.js`
- Modify: `tests/village/smoke.cjs`

- [ ] четыре здания (коптильня с дымом, дом рыбака, лодочный сарай с лодкой, беседка на воде) — руины, леса, готово;
      заменить заглушки `BOX`
- [ ] Праздник фонариков: фонарики плывут по озеру и поднимаются в небо, ночью ярче; беседка светится вечерами
- [ ] e2e: обновить проверку хутора (`smoke.cjs:353-371`: 6 жителей, все здания); сейв со всем озером без ошибок
- [ ] run tests - must pass before task 10

### Task 10: HUD and panels — fishing bar, texts, Romanian

**Files:**
- Modify: `web/village/game.js`
- Modify: `web/village/index.html`, `web/village/style.css`, `web/village/lang.js`
- Modify: `tests/village/lang.test.js`, `tests/village/smoke.cjs`

- [ ] полоска ловли («Ждём поклёвку…» / «Подсекай!») с кнопками «Подсечь» (`strike`) и «Смотать» (`stopFishing`)
- [ ] `act()` понимает `'fish'` и `'strike'`; пробел во время ловли — подсечка (до `actFront()`)
- [ ] игрок с удочкой: поза и инструмент для цели `'fish'` (game.js:37-46)
- [ ] подписи `catch`/`escape`/`early`/`gone`, описания новых зданий, модалка Праздника фонариков;
      текст модалки урожая ведёт к озеру вместо «свободной игры»
- [ ] RO для всех новых строк
- [ ] тест: `lang.test.js` — переводы новых строк есть
- [ ] e2e: полоска ловли появляется на тапе по месту и прячется по «Смотать»
- [ ] run tests - must pass before task 11

### Task 11: Sounds for fishing and the lantern festival

**Files:**
- Modify: `web/village/audio.js`
- Modify: `tests/village/audio.test.js`

- [ ] звуки:
  - заброс — свист лески;
  - поклёвка — бульк;
  - улов — всплеск и звон;
  - срыв — тихий всплеск;
  - мотив Праздника фонариков
- [ ] тест: новые звуки строятся без ошибок на фейковом AudioContext, как остальные
- [ ] run tests - must pass before task 12

### Task 12: E2E — the lake chapter on a phone

**Files:**
- Modify: `tests/village/smoke.cjs`

- [ ] сейв v3 с Праздником урожая грузится, подсказка ведёт на просеку
- [ ] на телефонном экране: тап по месту клёва → полоска ловли → дождаться поклёвки → «Подсечь» → рыбы стало больше
- [ ] сейв с беседкой: фонари, модалка финала не повторяется при загрузке, нет ошибок в консоли
- [ ] run tests - must pass before task 13

### Task 13: Verify acceptance criteria
- [ ] всё из Overview сделано:
  - глава после урожая;
  - рыбалка-мини-игра;
  - монеты нужны;
  - сейвы v3 продолжаются, старые узлы на месте
- [ ] проверить края:
  - ловля во время перехода ночи и зимы;
  - офлайн во время ловли;
  - полный амбар рыбы;
  - ловля без удочки;
  - отход от игры во время ловли (`gone`)
- [ ] run full test suite: `node --test 'tests/**/*.test.js'` и `go test ./...`
- [ ] run e2e: `node tests/village/smoke.cjs`
- [ ] `BALANCE=1 node --test tests/village/balance.test.js` — 20 сидов

### Task 14: [Final] Update documentation
- [ ] `README.md` и описание «Родника» в `web/index.html` (RO тоже): третья глава, рыбалка
- [ ] CLAUDE.md — если появились новые правила
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification:**
- на телефоне после деплоя: открыть своё пройденное село. Оно должно загрузиться без «новой версии», подсказка —
  вести на просеку, деревья — стоять на прежних местах.
- рыбалка на сенсорном экране: успевается ли подсечь за 0,9 с на первой удочке, не мешает ли полоска ловли
  полоске ресурсов.
- облачный сейв: загрузить v3 из облака на другом устройстве.
