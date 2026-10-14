# Развёртывание в Portainer

Игры запускаются в Portainer как обычный стек (Docker Compose) из готового образа
`ghcr.io/fulgerx2007/awesome-game`. На сервере ничего не собирается. Образ публикуется
GitHub Actions при пуше тега `v*` (см. «Готовый образ» в README), под `linux/amd64` и `linux/arm64`.

Файл стека: [`deploy/portainer/docker-compose.yml`](../deploy/portainer/docker-compose.yml).

| Переменная | По умолчанию | Что задаёт |
|---|---|---|
| `TAG` | `latest` | Тег образа: `latest`, `1`, `1.2` или `1.2.3` |
| `PORT` | `8080` | Порт на хосте, на котором открываются игры |

Внутри контейнера сервер слушает `8080`, данные (рекорды и облачные сохранения) лежат в томе `/data`.

## 1. Доступ к образу

Новый пакет в GitHub Container Registry по умолчанию приватный. Есть два варианта.

- **Сделать пакет публичным.** На GitHub откройте Packages → `awesome-game` → Package settings → Change visibility → Public.
  После этого Portainer скачивает образ без логина.
- **Оставить приватным** и добавить реестр в Portainer:
  1. На GitHub создайте Personal access token (classic) с правом `read:packages`.
  2. В Portainer откройте Registries → Add registry → Custom registry.
  3. Заполните поля:
     - Name: `GHCR`;
     - Registry URL: `ghcr.io`;
     - Authentication: включить;
     - Username: ваш логин на GitHub;
     - Password: токен из шага 1.

## 2. Создать стек

Есть два способа. Первый удобнее для обновлений.

### Вариант А: из Git-репозитория

1. Stacks → Add stack, имя `awesome-game`.
2. Build method: **Repository**.
3. Заполните поля:
   - Repository URL: `https://github.com/FulgerX2007/awesome-game`;
   - Repository reference: `refs/heads/main`;
   - Compose path: `deploy/portainer/docker-compose.yml`.
   - Если репозиторий приватный, включите Authentication и укажите логин и токен с правом `repo` (чтение).
4. В Environment variables при необходимости задайте `TAG` (например, `1.0.0`) и `PORT`.
5. Чтобы стек сам подхватывал изменения файла в репозитории, включите **GitOps updates**:
   - Polling, например раз в 5 минут, или
   - Webhook: Portainer покажет URL, его можно вызывать из CI.
6. Deploy the stack.

### Вариант Б: веб-редактор

1. Stacks → Add stack, Build method: **Web editor**.
2. Вставьте содержимое `deploy/portainer/docker-compose.yml`.
3. Задайте переменные окружения и нажмите Deploy the stack.

## 3. Проверить

- В Containers у `awesome-game` статус должен смениться на **healthy** в течение 5–10 секунд.
  В образе встроена проверка: бинарник сам опрашивает `/healthz`, curl внутри не нужен.
- Откройте `http://<сервер>:<PORT>/`. Должна загрузиться стартовая страница со всеми играми.
- В логах контейнера при старте видна версия, например `игры v1.0.0: http://localhost:8080`.

## 4. Обновить версию

- **Фиксированный тег** (`TAG=1.0.0`). Поменяйте `TAG` в Environment variables стека и нажмите
  Update the stack.
- **Плавающий тег** (`latest`, `1` или `1.2`). Нажмите Update the stack с включённым **Re-pull image and redeploy**
  (в стеках из Git — Pull and redeploy).
- **Автоматически.** Включите для стека Webhook (Stacks → `awesome-game` → Webhooks). Вызов этого URL
  после публикации образа заставит Portainer скачать образ заново и перезапустить стек.

Данные лежат в томе и переживают обновление и пересоздание контейнера. Сервер корректно
останавливается по SIGTERM, поэтому начатые записи не обрываются.

## 5. Резервная копия данных

В образе нет shell (он собран на `scratch`), поэтому копия снимается через временный контейнер. Имя тома
в Portainer — `<имя стека>_games-data`, например `awesome-game_games-data`.

```sh
# Сохранить
docker run --rm -v awesome-game_games-data:/data:ro -v "$PWD":/backup alpine:3.20 \
  tar czf /backup/games-data.tgz -C /data .

# Восстановить (стек лучше остановить)
docker run --rm -v awesome-game_games-data:/data -v "$PWD":/backup alpine:3.20 \
  tar xzf /backup/games-data.tgz -C /data
```

Внутри лежат `scores-echo.json`, `scores-valley.json` и папка `saves/` с облачными сохранениями.

## 6. Безопасность и ресурсы

Стек уже настроен строго, менять ничего не нужно:
- процесс работает не от root (uid 65532);
- корневая файловая система только для чтения (`read_only: true`), писать можно только в том `/data`;
- все Linux capabilities сброшены, `no-new-privileges` включён;
- ограничение памяти 128 МБ. Сервер лёгкий: игры работают в браузере, а он только отдаёт файлы и хранит рекорды.

## 7. За обратным прокси

Сервер отдаёт обычный HTTP без TLS. Для доступа из интернета поставьте перед ним прокси с HTTPS,
например Traefik, Nginx Proxy Manager или Caddy, и направьте его на `awesome-game:8080`.
Если прокси работает в той же Docker-сети, публиковать порт (`ports:`) не обязательно.

Особых заголовков и WebSocket не нужно. Облачные сохранения и рекорды — обычные `GET`, `POST` и `PUT` на `/api/...`.

## 8. Docker Swarm

Если Portainer управляет Swarm-кластером, файл тоже подходит. Учтите три отличия:
- `container_name` и `restart` в Swarm игнорируются, перезапуском управляет `deploy.restart_policy`;
- запускайте **одну** реплику: данные хранятся в локальном томе узла;
- если узлов несколько, привяжите сервис к одному узлу через `deploy.placement.constraints`;
- `security_opt` в Swarm не поддерживается и будет пропущен. Остальные ограничения работают.

## Synology (Container Manager) и папки хоста

Если вместо именованного тома подключить папку хоста, например `/volume1/docker/awesome-games/data:/data`,
сохранения могут не записываться. В игре появится «Не удалось сохранить: internal error», а в логе:

```
ВНИМАНИЕ: каталог данных /data недоступен на запись: ... permission denied
store save: mkdir /data/saves: permission denied
```

Причина: образ работает не от root, а от uid 65532. Папка, созданная в DSM (File Station), принадлежит
вашему пользователю DSM, обычно `1026:100`, и uid 65532 не может в неё писать. Именованный том
этой проблемы не имеет, потому что Docker создаёт его с нужным владельцем.

**Решение 1, рекомендуемое для Synology:** запускать контейнер от вашего пользователя DSM. Тогда файлы
остаются вашими: их видно и можно бэкапить в File Station и Hyper Backup. Узнать uid и gid можно по SSH командой `id`.

```yaml
services:
  games:
    image: ghcr.io/fulgerx2007/awesome-game:latest
    user: "1026:100"          # вывод `id` вашего пользователя DSM
    ports:
      - "8052:8080"
    volumes:
      - /volume1/docker/awesome-games/data:/data
    restart: unless-stopped
```

**Решение 2:** отдать папку пользователю образа (по SSH):

```sh
sudo chown -R 65532:65532 /volume1/docker/awesome-games/data
```

После этого файлы в File Station будут принадлежать «неизвестному» пользователю 65532.

**Решение 3:** использовать именованный том вместо папки, как в `deploy/portainer/docker-compose.yml`.

Проверка: после перезапуска в логе нет строки «ВНИМАНИЕ», а в папке после первого рекорда
или облачного сохранения появляются `scores-*.json` и `saves/`.

## Частые проблемы

| Симптом | Причина и решение |
|---|---|
| `pull access denied` / `unauthorized` | Пакет приватный: сделайте его публичным или добавьте реестр GHCR с токеном (раздел 1). |
| `manifest unknown` | Такого тега нет. Проверьте, что workflow «Release image» для этого тега отработал (вкладка Actions на GitHub). |
| Порт занят | Задайте другой `PORT` в переменных стека. |
| Статус `unhealthy` или контейнер перезапускается | Посмотрите логи контейнера: сервер пишет причину при старте, например, если не смог прочитать файлы рекордов в `/data`. |
| «Не удалось сохранить: internal error», в логе `permission denied` | Папка хоста недоступна на запись uid 65532. Запустите контейнер от владельца папки (`user: "UID:GID"`) или выдайте права. Подробности в разделе «Synology и папки хоста». |
| Рекорды пропали после пересоздания | Стек переименовали, и Portainer создал новый том `<новое имя>_games-data`. Перенесите данные через резервную копию (раздел 5). |
