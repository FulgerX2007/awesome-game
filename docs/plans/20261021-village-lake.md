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
- Игра остаётся спокойной: нет врагов, проигрыша и штрафов. Сорвавшаяся рыба просто уплывает, и заброс повторяется сам.

## Context (from discovery)
- Файлы игры: `web/village/`.
  - `core.js` (1342 строки) — правила без DOM: карта ASCII 64×36, зоны, узлы, здания, мастерские, жители, заказы,
    ярмарка, офлайн, сейвы.
  - `view.js` — чистые помощники: `tapAction`, плоские здания `bridge`/`road`.
  - `art.js` — отрисовка 2.5D, `BOX`/`ART` по зданиям; образец — тропа через холм (`art.js:825`).
  - `game.js` — HUD, панели, модалки праздников (`game.js:493`, `:506`), `RES_UNLOCK` (`:220`), описания зданий (`:335`).
  - `audio.js`, `lang.js` (RO), `index.html`, `style.css` (иконки ресурсов — инлайн SVG).
- Образец главы — хутор:
  - здания с `after: 'festival'`;
  - закрытый проход `'t'`, который открывает `road`;
  - зона `hamlet` (`x ≥ HAMLET_X`);
  - покупка на ярмарке, без которой не построить (`bought: 'cuttings'`);
  - флаг финала `s.harvestFestival` и событие `harvest-festival`;
  - тесты `tests/village/hamlet.test.js`.
- Сейвы: `load()` поднимает `v: 2` до текущей версии. Узлы раскладываются заново от сида, `restore()` берёт hp
  только у совпавших узлов. Финалы восстанавливаются из построенных зданий (`applyEffect`).
- `nextGoal()` выбирает этап по `s.festival`: до праздника — здания без `after`, после — с `after: 'festival'`.
- Бот баланса: `tests/village/bot.js`, `play(seed, { until: 'harvest' })`. Его проверяет
  `tests/village/balance.test.js`:
  - сид 1: праздник через 140–170 мин, урожай ещё через 75–110 мин;
  - на всех сидах: пауза ≤ 16 мин, все здания построены, прогон по умолчанию < 20 с.
- Другие тесты: `lang.test.js` (переводы RO и порядок скриптов, ≥ 12 иконок), `save.test.js`, `orders.test.js`,
  `view.test.js`, `audio.test.js`, e2e `smoke.cjs` (Playwright; там же проверка «хутор нарисован без ошибок»).

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
- **CRITICAL: all tests must pass before starting next task** - no exceptions, включая `balance.test.js`.
  Если задача меняет правила или карту, она сразу учит бота новому.
- **CRITICAL: update this plan file when scope changes during implementation**
- run tests after each change: `node --test 'tests/**/*.test.js'` и `go test ./...`
- обратная совместимость: сейвы v2/v3 грузятся, другие игры и `fx.js` не меняются, API сервера не меняется

## Testing Strategy
- **unit tests**: в каждой задаче (`node --test`). Новые файлы — `tests/village/lake.test.js` (карта, здания, глава)
  и `tests/village/fishing.test.js` (мини-игра).
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
  `s.harvestFestival ? 'harvest' : s.festival ? 'festival' : undefined`. Всё остальное (вклады, зависимости,
  подсказка, панели) работает без изменений.
- **Карта растёт вниз.** Существующие 36 строк не меняются, снизу добавляются 14 новых (y = 36…49):
  - полоса старого леса `&` (никогда не проходима) с просекой `o` (закрыта до здания «Просека»);
  - берег `:`, озеро `~`, куда впадает река;
  - место мостков `j` (вода, пока мостки не построены, как мост `b`);
  - места клёва `f` (вода у берега и у конца мостков);
  - руины четырёх новых зданий.

  Зона `lake` (`y ≥ LAKE_Y = 36`) проверяется раньше остальных. Свои узлы зоны: деревья, камни, кусты.
- **Рыбалка в правилах (вариант A).**
  - Места клёва — узлы нового вида `shoal` («Косяк рыбы»). Они стоят на фиксированных клетках `f`, а не
    раскладываются случайно; у каждого свой запас (hp) и восстановление, как у деревьев.
  - Тап по месту ведёт игрока к берегу и начинает ловлю: `cast → wait → bite → (strike | escape) → cast …`.
  - Время поклёвки берётся из `s.rng`, поэтому всё детерминировано и не зависит от шага.
  - Удочка `rod` — четвёртый инструмент. Уровень 0 до мостков (как лопата до моста); уровни 2–3 шире открывают окно
    подсечки и дают больше рыбы за поклёвку.
- **Монеты в деле.**
  - Лодка (`FAIR.boat`) покупается на ярмарке, без неё не построить Лодочный сарай.
  - В цене Беседки на воде есть монеты.
  - Рыба и копчёная рыба попадают в заказы жителей.
- **Сейвы.** `VERSION = 4`. v2 и v3 поднимаются до v4 как есть (как сейчас делается с v2). Новый флаг
  `s.lanternFestival` восстанавливается из построенной беседки. Состояние ловли `player.fish` временное и в сейв
  не идёт.
  - ⚠️ Узлы старых зон могут разложиться по-новому: так уже было при переходе v2 → v3, потому что лес у южного края
    меняет проверку проходимости. Здания, ресурсы, инструменты, жители и праздники сохраняются.

## Technical Details
- **Ресурсы:** `fish: { name: 'Рыба' }`, `smoked: { name: 'Копчёная рыба' }`. `RES_IDS` удлиняется до 14.
- **Узел:** `shoal: { name: 'Косяк рыбы', res: 'fish', hp: 3, tool: 'rod', regrow: [150, 300] }`. Клетки `f`
  перечисляются как `PLOTS` (список `SPOTS`). Узлы `shoal` добавляются в `newGame()` после разложенных случайно,
  с продолжением их id.
- **Инструмент:**
  - `rod: { name: 'Удочка', node: 'shoal', start: 0, costs: { 2: { planks: 60, wood: 40 }, 3: { bricks: 40, planks: 80 } } }`;
  - `applyEffect('pier')` даёт `rod = 1`.
- **Рыбалка:**
  ```js
  const FISHING = { wait: [2, 6], window: [0, 0.9, 1.2, 1.5], early: 1.5 }; // секунды; окно по уровню удочки
  // player.fish = { id, phase: 'wait' | 'bite', at } — временное, в TRANSIENT_PLAYER
  // interact(): shoal → 'tool' без удочки, иначе путь к берегу и цель { type: 'fish', id } → 'fish'
  // tick(): у места без p.fish — заброс (событие 'cast'); 'wait' и s.t ≥ at → 'bite' (событие 'bite');
  //         'bite' и s.t ≥ at → 'escape' и новый заброс
  // strike(s) → 'catch' | 'early' | 'none'
  //   catch: +TOOL_YIELD[rod] рыбы, hp−1, событие 'catch'; при hp = 0 — 'deplete' и конец ловли
  //   early: подсечка до поклёвки, рыба пугается, ожидание + FISHING.early
  ```
  Любой новый приказ или движение клавишами отменяет ловлю (`clearOrder` чистит `p.fish`). `offline()` ловлю не
  продолжает.
- **Здания** (стартовые цены, их подбирает бот):

  | id | имя | цена | нужно | эффект |
  |---|---|---|---|---|
  | `glade` | Просека к озеру | wood 300, stone 200 | harvest | открывает `o` |
  | `pier` | Мостки | planks 200, wood 150 | glade | открывает `j`, удочка 1 |
  | `smokehouse` | Коптильня | bricks 160, stone 150, planks 80 | pier | мастерская |
  | `house6` | Дом рыбака | planks 260, bricks 180, fish 40 | pier | житель |
  | `boathouse` | Лодочный сарай | planks 240, wood 120 | pier | — (`bought: 'boat'`) |
  | `pavilion` | Беседка на воде | planks 300, bricks 200, smoked 40, juice 30, honey 40, coins 60 | smokehouse, house6, boathouse | `lanterns` |

  - Мастерская коптильни: `smokehouse: { from: 'fish', to: 'smoked', ratio: 2, rate: 0.15 }`.
  - Житель: `fisher: { name: 'Рыбак', res: 'fish', rate: 0.1 }`, работает круглый год (зимой — подлёдный лов).
  - Лодка на ярмарке: `boat: { name: 'Лодка', price: 40 }`.
  - Цены в пределах амбара (400).
- **Заказы:** `ORDER_GOODS.fish = { n: 10, worth: 3 }`, `ORDER_GOODS.smoked = { n: 6, worth: 6 }`. `openGoods()`
  добавляет рыбу после мостков и копчёную рыбу после коптильни.
- **События для клиента:** `cast`, `bite`, `escape`, `catch` (с `gain`), `early` и `lantern-festival`.
- **Клиент:**
  - Пока идёт ловля, тап по холсту = подсечка. Внизу полоска «🎣 Ждём поклёвку… / Подсекай!» с кнопками «Подсечь»
    и «Смотать».
  - Клавиши: пробел — подсечь, стрелки или WASD — уйти.
  - Поплавок, леска от игрока, нырок на поклёвке, всплеск и «+N Рыба».

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): код, тесты, документация в этом репозитории
- **Post-Completion** (no checkboxes): ручная проверка на телефоне после деплоя, проверка своего сейва

## Implementation Steps

### Task 1: Save version 4 — v2 and v3 load as they are

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/save.test.js`

- [ ] поднять `VERSION` до 4; в `load()` сейвы `v: 2` и `v: 3` поднимать до v4 как есть, v1 по-прежнему `recovered: 'old'`
- [ ] добавить `lanternFestival: false` в `newGame()`
- [ ] добавить `fish` в `TRANSIENT_PLAYER`
- [ ] тест: сейв v3 с пройденным хутором грузится без `recovered`; здания, ресурсы, жители и `harvestFestival` на месте
- [ ] тест: v2 по-прежнему грузится; v1 даёт `'old'`; v5 и мусор дают `recovered: true`
- [ ] run tests - must pass before task 2

### Task 2: The lake on the map — forest, trail, shore, pier site, fishing spots, zone

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/lake.test.js`
- Modify: `tests/village/balance.test.js` (BFS-проверка достижимости учитывает озеро)

- [ ] дописать 14 строк к `MAP`: лес `&`, просека `o`, берег, озеро (река впадает в него), мостки `j`, места клёва `f`,
      руины новых зданий; обновить легенду карты в комментарии
- [ ] расширить `groundWalkable` (`o` открыта после `glade`, `j` — после `pier`), `isWalkable`, `scatterNodes`
      (проверка заливкой — со всем открытым) и буфер `NODE_SITES` у `o` и `j`
- [ ] добавить зону `lake` (`LAKE_Y`) раньше остальных зон, `ZONE_NODES.lake`, узел `shoal`, список `SPOTS` и
      фиксированные узлы `shoal` в `newGame()`
- [ ] тест: лес закрывает озеро везде, кроме просеки; до просеки озеро недостижимо, после — достижимо
- [ ] тест: узлы зоны `lake` лежат за лесом и достижимы с просекой и мостками; каждое `f` — узел `shoal` на воде,
      и рядом есть клетка, откуда можно ловить (берег или мостки)
- [ ] тест: старые проверки зон (`west`/`north`/`east`/`hamlet`) не сломаны
- [ ] run tests - must pass before task 3

### Task 3: Lake buildings, resources, rod, fisher and smokehouse

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/lake.test.js`
- Modify: `tests/village/build.test.js` (список всех зданий)

- [ ] ресурсы `fish` и `smoked`; инструмент `rod` (start 0, уровни 2–3); житель `fisher`; мастерская `smokehouse`
- [ ] здания `glade`, `pier`, `smokehouse`, `house6`, `boathouse` (`bought: 'boat'`), `pavilion` с `after: 'harvest'`,
      в порядке зависимостей в `BUILDINGS`
- [ ] `applyEffect`: `pier` даёт удочку 1, `lanterns` ставит `s.lanternFestival`; `contribute` шлёт `lantern-festival`;
      `restore` поднимает финал из беседки
- [ ] `nextGoal`: третий этап по `s.harvestFestival`; лодка как ожидание ярмарки (как черенки)
- [ ] тест: цепочка просека → мостки → коптильня / дом рыбака / сарай → беседка; ни одно здание озера
      не доступно до Праздника урожая
- [ ] тест: Праздник в селе и Праздник урожая не требуют озера; удочка 0 до мостков (`upgradeTool` → `'locked'`)
- [ ] тест: коптильня делает копчёную рыбу сверх запаса; рыбак ловит круглый год; сейв с беседкой восстанавливает
      `lanternFestival`
- [ ] run tests - must pass before task 4

### Task 4: Fishing mini-game in the rules

**Files:**
- Modify: `web/village/core.js`
- Create: `tests/village/fishing.test.js`

- [ ] `FISHING` и состояние `player.fish`; `interact()` на `shoal` → `'fish'` (`'tool'` без удочки)
- [ ] `fishTick` в `tick()`: заброс, ожидание, поклёвка, срыв и повторный заброс, с событиями `cast`/`bite`/`escape`
- [ ] `strike(s)` → `'catch'` / `'early'` / `'none'`; улов `TOOL_YIELD[rod]`; опустевший косяк → `deplete`
      и восстановление
- [ ] `clearOrder` чистит ловлю; `save()` её не пишет; экспорт `strike`, `FISHING`, `SPOTS`
- [ ] тест: подсечка в окне ловит, после окна рыба срывается и заброс повторяется, ранняя подсечка даёт `'early'`
      и более долгое ожидание
- [ ] тест: окно и улов растут с уровнем удочки; результат одинаков при шаге 0,05 с и 0,5 с
      (поклёвки по `s.rng`)
- [ ] тест: движение клавишами и новый тап отменяют ловлю; без удочки `'tool'`; `strike` без ловли → `'none'`
- [ ] run tests - must pass before task 5

### Task 5: Orders and the fair — fish, smoked fish, the boat

**Files:**
- Modify: `web/village/core.js`
- Modify: `tests/village/orders.test.js`

- [ ] `ORDER_GOODS.fish`, `ORDER_GOODS.smoked`; `openGoods()` открывает их после мостков и коптильни
- [ ] `FAIR.boat`; `restore` добавляет лодку в `bought`, если сарай построен
- [ ] тест: до мостков в заказах нет рыбы, после — бывает; копчёная — только с коптильней
- [ ] тест: лодка покупается только на ярмарке и за монеты; без неё сарай `'locked'`, подсказка ведёт на ярмарку
- [ ] run tests - must pass before task 6

### Task 6: Balance bot plays the lake chapter

**Files:**
- Modify: `tests/village/bot.js`
- Modify: `tests/village/balance.test.js`
- Modify: `web/village/core.js` (подбор цен)

- [ ] бот: `reachable` для зоны `lake`; рыбалка с реакцией 0,3 с после `bite`; удочка в `TOOL_ORDER`; лодка в списке
      покупок; режим `until: 'lanterns'`
- [ ] подобрать цены и скорости так, чтобы на сиде 1 глава заняла 60–90 мин после Праздника урожая, а паузы
      были ≤ 16 мин
- [ ] тест: сид 1 — сроки обоих старых праздников не изменились; Праздник фонариков через 60–90 мин после урожая
- [ ] тест: все сиды доходят до фонариков без тупика, все здания из `BUILDINGS` построены, пауза ≤ 16 мин
- [ ] тест: прогон по умолчанию укладывается в бюджет времени (поднять с 20 с, только если без этого никак;
      записать здесь ⚠️)
- [ ] run tests - must pass before task 7

### Task 7: Tap logic for fishing and the flat pier

**Files:**
- Modify: `web/village/view.js`
- Modify: `tests/village/view.test.js`

- [ ] `tapAction`: пока идёт ловля, тап → `{ type: 'strike' }`; построенные `glade`/`pier` лежат плоско, как `bridge`/`road`
- [ ] тест: тап во время ловли — подсечка, без ловли — как раньше; тап по месту клёва — `fish`
- [ ] run tests - must pass before task 8

### Task 8: Drawing the lake — terrain, pier, spots, fishing, buildings, lanterns

**Files:**
- Modify: `web/village/art.js`
- Modify: `tests/village/smoke.cjs`

- [ ] лес `&` (плотные кроны 2.5D), просека с завалом до `glade` (по образцу тропы через холм), берег и озеро
      (река впадает), мостки по стадиям (как мост)
- [ ] места клёва: круги на воде и тени рыб, пока косяк полон; поплавок, леска, нырок на поклёвке, всплеск при улове
- [ ] четыре здания (коптильня с дымом, дом рыбака, лодочный сарай с лодкой, беседка на воде) — руины, леса, готово;
      записи в `BOX`
- [ ] Праздник фонариков: фонарики плывут по озеру и поднимаются в небо, ночью ярче; беседка светится по вечерам
- [ ] e2e: сейв со всем озером рисуется без ошибок в консоли, на холсте есть пиксели воды и фонарей
- [ ] run tests - must pass before task 9

### Task 9: HUD and panels — fishing bar, icons, texts, Romanian

**Files:**
- Modify: `web/village/game.js`
- Modify: `web/village/index.html`
- Modify: `web/village/style.css`
- Modify: `web/village/lang.js`
- Modify: `tests/village/lang.test.js`

- [ ] полоска ловли («Ждём поклёвку…» / «Подсекай!») с кнопками «Подсечь» и «Смотать»; пробел — подсечь; тап по холсту
      во время ловли — подсечь
- [ ] подписи `catch`/`escape`/`early`, описания новых зданий, `RES_UNLOCK` для `fish`/`smoked`, модалка
      Праздника фонариков, тексты финала
- [ ] иконки SVG «рыба» и «копчёная рыба» в полоске ресурсов (инлайн data URI, как у остальных)
- [ ] переводы RO для всех новых строк и таблиц
- [ ] тест: `lang.test.js` — переводы новых строк есть, иконок не меньше 14, офлайн-проверка стилей проходит
- [ ] run tests - must pass before task 10

### Task 10: Sounds for fishing and the lantern festival

**Files:**
- Modify: `web/village/audio.js`
- Modify: `web/village/game.js`
- Modify: `tests/village/audio.test.js`

- [ ] звуки: заброс (свист лески), поклёвка (бульк), улов (всплеск и звон), срыв (тихий всплеск); мотив Праздника
      фонариков
- [ ] привязка к событиям в `game.js`
- [ ] тест: новые звуки строятся без ошибок на фейковом AudioContext, как остальные
- [ ] run tests - must pass before task 11

### Task 11: E2E — the lake chapter on a phone

**Files:**
- Modify: `tests/village/smoke.cjs`

- [ ] сейв v3 с Праздником урожая грузится, подсказка ведёт на просеку
- [ ] на телефонном экране: тап по месту клёва → полоска ловли → дождаться поклёвки → «Подсечь» → рыбы стало больше
- [ ] сейв с беседкой: фонари, модалка финала не повторяется при загрузке, нет ошибок в консоли
- [ ] run tests - must pass before task 12

### Task 12: Verify acceptance criteria
- [ ] всё из Overview сделано: глава после урожая, рыбалка-мини-игра, монеты нужны, сейвы v3 продолжаются
- [ ] проверить края: ловля во время перехода ночи и зимы, офлайн во время ловли, полный амбар рыбы, ловля без удочки
- [ ] run full test suite: `node --test 'tests/**/*.test.js'` и `go test ./...`
- [ ] run e2e: `node tests/village/smoke.cjs`
- [ ] `BALANCE=1 node --test tests/village/balance.test.js` — 20 сидов

### Task 13: [Final] Update documentation
- [ ] `README.md` и описание «Родника» в `web/index.html` (RO тоже): третья глава, рыбалка
- [ ] CLAUDE.md — если появились новые правила
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification:**
- на телефоне после деплоя: открыть своё пройденное село. Оно должно загрузиться без «новой версии», и подсказка
  должна вести на просеку.
- рыбалка на сенсорном экране: успевается ли подсечь за 0,9 с на первой удочке, не мешает ли полоска ловли
  полоске ресурсов.
- облачный сейв: загрузить v3 из облака на другом устройстве.
