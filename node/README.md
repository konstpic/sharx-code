# SharX Node (worker)

Worker-узел для multi-mode панели SharX: на машине крутится Xray (и при необходимости Telemt sidecar’ы); конфиг **забирается с панели** (pull/apply). Доступ к API узла — **HTTPS + mTLS + JWT** из бандла `SECRET_KEY`, а не старый `NODE_API_KEY`.

---

## Установка узла (рекомендуемый порядок)

1. **Ставите панель** (Docker/скрипт из репозитория SharX) и доводите до рабочего входа в веб-UI.

2. **Включаете multi-node** в настройках панели (режим нескольких узлов).

3. **Добавляете ноду** в интерфейсе (страница узлов). Откроется модалка **добавления узлы**: там будет готовый фрагмент **`docker-compose.yml`** (или инструкция «скопировать compose») с уже подставленными **`PANEL_URL`** и **`SECRET_KEY`** (base64 JSON bundle из панели).

4. **На сервере узла** (отдельная машина):
   - создаёте файл, например `docker-compose.yml`;
   - вставляете содержимое из модалки;
   - при необходимости правите только то, что позволяет документация/модалка (образ vs `build`, тома, редко — порт, если не host-сеть).

5. **Запуск:**
   ```bash
   docker compose up -d --build
   ```

6. В панели проверяете, что узел **подключился** и **получил конфиг** (статус, синхронизация, логи при необходимости).

Типовой `docker-compose` в репозитории: `network_mode: host`, тома под `cert` / `data` / `logs`, переменные **`PANEL_URL`** и **`SECRET_KEY`**. Секрет **один раз копируется из панели** — не выдумывайте и не смешивайте с узлами другой панели.

---

## Настройка TLS / сеть

В режиме **pairing** сертификаты и проверка клиента задаются **бандлом `SECRET_KEY`** (панель выпускает материалы узла). Отдельная ручная настройка `NODE_TLS_*` в compose обычно **не нужна**, если вы используете выданный из панели сценарий.

Если панель доступна по HTTPS с корпоративным CA — следуйте подсказкам в UI/доках панели (доверие к CA на узле при pull).

---

## Переменные окружения (актуально)

| Переменная | Описание |
|------------|----------|
| **`SECRET_KEY`** | Обязательно. Base64 JSON bundle с панели (pairing). |
| **`PANEL_URL`** | URL панели для первого pull и фоновой синхронизации (как в модалке). |
| **`NODE_ADDRESS`** | Опционально. Публичный адрес узла, если авто не подходит (см. код/настройки). |
| **`SHARX_NODE_PORT`** или **`PORT`** | Опционально. Порт API узла (по умолчанию **8080**). Переопределяет флаг `-port` после `flag.Parse`. В `docker-compose` можно задать `SHARX_NODE_PORT=9090` вместо правки `command`. |

Устаревший **`NODE_API_KEY`** в текущем worker **не используется**.

---

## API (кратко)

- Панель обращается к узлу по HTTPS с **mTLS**; в заголовке **`Authorization: Bearer <JWT>`** — токен, который **выпускает панель**, а не строка «api-key» пользователя.
- `GET /health` — без авторизации (проверка «узел поднялся»).

Детальный список маршрутов см. в коде `node/api/server.go` и в `web/docs/API.md` панели.

---

## Разработка / сборка образа

```bash
DOCKER_BUILDKIT=1 docker build --build-arg TARGETARCH=arm64 -t sharx-node -f node/Dockerfile ..
```

Локальный запуск без Docker (для отладки): задайте **`SECRET_KEY`** и при необходимости **`PANEL_URL`** в окружении, затем:

```bash
go run ./node -port 8080
```

---

## Структура каталога

```
node/
├── main.go
├── api/           # HTTP API
├── xray/          # процесс Xray
├── telemt/        # Telemt sidecar (multi-node)
├── configpull/    # pull конфига с панели
├── Dockerfile
└── docker-compose.yml
```

---

## Installation (English, short)

1. Install the **panel** and enable **multi-node** mode.
2. **Add a node** in the UI — copy the **`docker-compose.yml`** snippet from the modal (`PANEL_URL` + `SECRET_KEY` bundle).
3. On the worker server: save as `docker-compose.yml`, then `docker compose up -d --build`.
4. Confirm the node is **online** in the panel.

Auth is **pairing-only** (`SECRET_KEY`); there is **no** `NODE_API_KEY` in the current worker.
