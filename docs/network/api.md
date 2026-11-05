# SharX Network: API-контракты

Все запросы/ответы — JSON. Аутентификация участников — mTLS (client cert от CA координатора,
CN = participant_id). Админ API — Bearer admin token.

В первой версии поддерживается только `vless-reality` поверх TCP. Значение `tls` и другие
протоколы отклоняются при публикации, а не попадают в каталог как неработающие конфигурации.

Каждый мутационный запрос участника обязан содержать:

- `Idempotency-Key: <uuid>` — уникальный ключ операции (дедупликация на стороне координатора);
- `X-Sharx-Timestamp: <unix>` — допустимое окно ±300 с;
- `X-Sharx-Nonce: <uuid>` — одноразовый, кэш 10 минут (защита от replay в пределах mTLS-сессии).

Отчёты об использовании дополнительно содержат поле `signature` — ed25519-подпись
канонического JSON записи ключом подписи панели (публичный ключ зарегистрирован при enroll).

Ответы ошибок: `{"error": "<code>", "message": "<human>", "details": {...}}`.
Коды: `unauthorized`, `forbidden`, `invalid_argument`, `idempotency_conflict`,
`not_found`, `insufficient_balance`, `quota_exceeded`, `rate_limited`,
`emergency_shutdown`, `participant_suspended`, `node_unavailable`.

## Участники и удостоверения

### POST /v1/enroll (без mTLS, по invite)

Запрос:
```json
{
  "invite_code": "uuid",
  "name": "My Panel",
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----...",
  "signing_public_key": "<base64 ed25519>",
  "panel_version": "2.13.0"
}
```
Ответ `200`:
```json
{
  "participant_id": "uuid",
  "certificate_pem": "-----BEGIN CERTIFICATE-----...",
  "certificate_expires_at": 1735689600,
  "ca_pem": "-----BEGIN CERTIFICATE-----...",
  "initial_balance_credits": "100.0"
}
```
Ошибки: `invite_invalid`, `invite_revoked`, `invite_exhausted`, `invite_expired`.
CSR: ECDSA P-256; CN игнорируется, координатор ставит CN=participant_id, срок 30 дней.

### POST /v1/cert/renew (mTLS)

Запрос: `{"csr_pem": "..."}`. Ответ: новый сертификат. Старый серийник заносится в
revoked-список (действует до конца суток для in-flight соединений).

### GET /v1/me (mTLS)

```json
{
  "participant_id": "uuid", "name": "...", "status": "active",
  "balance_credits": "87.5", "reserved_credits": "12.0",
  "earned_period_credits": "45.0", "spent_period_credits": "20.0",
  "flags": {"emergency_shutdown": false, "beta": true},
  "limits": {"max_sessions": 50, "max_pair_turnover_credits": "500"},
  "server_time": 1730600000
}
```

## Реестр нод (провайдер)

### POST /v1/nodes (mTLS, idempotent)

```json
{
  "node_ref": "local-node-id", "label": "DE-Frankfurt-1",
  "country": "DE", "region": "eu-central",
  "protocols": ["vless-reality"],
  "endpoint_host": "de1.example.com", "endpoint_port": 443,
  "access_template": {"security": "reality", "sni": "www.microsoft.com",
    "public_key": "...", "short_ids": ["01234567"], "fingerprint": "chrome",
    "transport": "tcp"},
  "capacity_mbps": 500, "speed_limit_mbps": 100, "reserve_mbps": 100,
  "max_sessions": 20, "traffic_limit_gb": 1024,
  "price_credits_per_gb": "1.0"
}
```
Координатор валидирует `access_template` по белому списку полей; приватные ключи
отклоняются. Ответ: `{"node": {...}, "status": "active"}`.
Создание с уже известным (`participant_id`, `node_ref`) при той же Idempotency-Key — возврат существующей.

### PUT /v1/nodes/:id

Обновление лимитов/цены/шаблона; `{"paused": true}` — временная приостановка
(новые сессии запрещены, действующие продолжаются).

### DELETE /v1/nodes/:id

Drain и исключение из каталога; действующие сессии получают close-команду.

### POST /v1/nodes/:id/heartbeat (mTLS)

```json
{"status": "online", "rtt_ms": 12.5, "active_sessions": 4,
 "bandwidth_used_mbps": 37.2, "xray_up": true, "ts": 1730600000}
```
`status`: online|degraded|offline. Heartbeat старше 90 с ⇒ нода считается offline
(каталог исключает, действующим сессиям ставится degraded).

## Каталог и сессии (потребитель)

### GET /v1/nodes/catalog (mTLS)

Query: `country=, protocol=, min_capacity=, need_mbps=, limit=`.
Ответ:
```json
{"candidates": [{"node_id": "uuid", "label": "DE-Frankfurt-1",
  "country": "DE", "protocols": ["vless-reality"],
  "endpoint_host": "de1.example.com", "endpoint_port": 443,
  "access_template": {...}, "price_credits_per_gb": "1.0",
  "score": 0.93, "score_parts": {"health": 1.0, "latency": 0.9, "headroom": 0.95, "capacity_fit": 0.8},
  "available_mbps": 63, "remaining_traffic_gb": 811}]}
```

### POST /v1/sessions (mTLS, idempotent)

```json
{"node_id": "uuid", "client_ref": "uuid (генерирует consumer)",
 "protocol": "vless-reality", "quota_gb": 50,
 "tariff_revision": 1, "max_reserve_micros": 50000000}
```

`client_ref` — технический идентификатор аренды, а не назначение конкретному клиенту панели. Клиентский доступ создаётся позже отдельным bundle assignment.
Ответ `202`: `{"session": {...,"status": "provisioning"}}`.
Повтор с тем же Idempotency-Key (или тем же client_ref у данного участника) — тот же session.
Ошибки: `insufficient_balance` (доступный баланс меньше нового резерва), `node_unavailable`,
`emergency_shutdown`, `quota_exceeded` (лимиты участника).

### GET /v1/sessions (mTLS)

Query: `role=provider|consumer&since_seq=N&status=`.
Ответ: сессии + `server_seq` (номер последнего изменения; панель хранит курсор).
Для провайдера сессии в `provisioning` содержат команду `provision_user`
(email `sn-<client_ref hex>`, uuid = client_ref). Для потребителя — `status`
(provisioning→active→degraded→closing→closed) и заполненный `link` при active.

### POST /v1/sessions/:id/close (mTLS)

`{"reason": "quota_spent|admin|expired|drain|dispute"}`. Идемпотентно.

### POST /v1/sessions/:id/dispute (mTLS)

`{"reason": "string", "claimed_bytes": 12345}`. Сессия останавливается; нераспределённое удержание замораживается до решения оператора.

## Учёт использования

### POST /v1/usage/reports (mTLS, провайдер)

```json
{"reports": [{"session_id": "uuid", "seq": 12,
  "up_bytes": 12345678, "down_bytes": 87654321,
  "cum_up_bytes": 100000000, "cum_down_bytes": 500000000,
  "ts": 1730600000, "signature": "<ed25519 sig>"}]}
```
Правила: seq строго возрастает по сессии; cum растёт на дельту; дубли `(session,seq)`
игнорируются (`{"duplicates": n}`). Нарушение монотонности ⇒ `usage_out_of_order`,
сессия в сверку.

### POST /v1/usage/liveness (mTLS, потребитель)

```json
{"items": [{"session_id": "uuid", "state": "active|idle", "ts": 1730600000}]}
```
Consumer-панель сообщает активность по `last_online` клиентов, которым явно назначен bundle с этой сессией. Для старых записей сохраняется fallback на `client_entity_id`. Это сигнал активности, а не независимое доказательство объёма трафика.

## Ledger и сверка

### GET /v1/ledger (mTLS)

Query: `cursor=0&limit=500`. Ответ: `{"entries": [...], "next_cursor": 123}`; cursor — монотонный числовой ID, не timestamp.
Запись:
```json
{"entry_uid": "uuid", "ts": 1730600000, "direction": "credit|debit|reserve|release|bonus|adjustment",
 "amount_credits": "1.25", "amount_bytes": 134217728,
 "counterparty_participant_id": "uuid|null", "session_id": "uuid|null",
 "status": "settled|hold", "reason": "usage|invite_bonus|correction|hold_release",
 "memo": "session 9f3… GB month"}
```

### GET /v1/usage/sessions/:id (mTLS)

Таймлайн отчётов обеих сторон + статус сверки (matched|mismatch|disputed|pending).

## Администрирование (Bearer `SHARX_COORD_ADMIN_TOKEN`)

- `POST /v1/admin/invites` → `{"initial_credit": 100, "max_uses": 1, "expires_in_hours": 72}`
- `DELETE /v1/admin/invites/:code`
- `GET /v1/admin/participants`, `POST /v1/admin/participants/:id/suspend|unsuspend|block`
- `POST /v1/admin/participants/:id/adjust` — ручная корректировка (`{amount, reason}` ⇒ отдельная append-only ledger adjustment)
- `GET /v1/admin/disputes`, `POST /v1/admin/disputes/:id/resolve`
- `POST /v1/admin/emergency` — `{"shutdown_new_assignments": true|false}`
- `GET /v1/admin/overview`, `GET /v1/admin/audit?cursor=`
- `GET /healthz` — без авторизации (liveness)

### Отдельный UI оператора

`GET /operator/` отдаёт интерфейс оператора. `POST /operator/api/login` принимает `{password}` из `SHARX_COORD_OPERATOR_PASSWORD` и создаёт серверную сессию. Дальше браузер вызывает `/operator/api/admin/*` с HttpOnly-cookie и `X-CSRF-Token`; координатор сам добавляет admin credential только в server-side request. Admin token, mTLS-ключи и пароль оператора в HTML/JS/API-ответы не включаются.

### Panel API для явного consumer flow

Все routes находятся под существующей panel authentication/RBAC (`network:read` или `network:manage`):

- `POST /panel/network/sessions/open` — `{nodeId, quotaGB}`; открывает аренду без клиента;
- `GET /panel/network/resources` — сессии с `inboundId`, `hostId`, `bundleIds`;
- `POST /panel/network/bundles` — `{name, sessionIds}`; создаёт bundle из активных аренд, не назначает клиентов;
- `POST /panel/network/bundles/assign` — `{bundleId, clientIds}`; единственная операция, которая явно выдаёт сетевой bundle клиентам;
- `POST /panel/network/sessions/close` — закрывает аренду и выключает её inbound/host после синхронизации.

## Метрики координатора

`GET /metrics` (admin token) — Prometheus text format, префикс `sn_`:
`sn_participants_total`, `sn_nodes_total`, `sn_sessions_active_total`,
`sn_usage_reports_total`, `sn_usage_report_bytes_total`, `sn_ledger_entries_total`,
`sn_disputes_open_total`, `sn_fraud_flags_total`, `sn_settle_entries_total`,
`sn_requests_total`, `sn_request_errors_total`, `sn_request_duration_seconds`,
`sn_idempotency_replays_total`, `sn_nonce_replays_total`, `sn_rate_limited_total`.

Панель дополнительно экспортирует через существующий `/panel/metrics`:
`xui_network_enabled`, `xui_network_last_sync_timestamp_seconds`,
`xui_network_published_nodes`, `xui_network_sessions{role,status}`,
`xui_network_usage_bytes{role,direction}`, `xui_network_provision_pending`.

В метриках не должно быть секретов, токенов, UUID клиентов конечных пользователей.


## Экономика (ADR-0002, новые контракты)

`GET /v1/economy`: `{revision:1,rate_micros:1000000,hold_seconds:604800,updated_at:0}`.
`GET /v1/admin/economy` и `PUT /v1/admin/economy` доступны оператору; PUT принимает текущую `revision`, `rate_micros` (100000..10000000), `hold_seconds` (86400..2592000). Устаревшая версия: 409 policy_changed.

Открытие сессии требует дополнительных целочисленных полей `tariff_revision` и `max_reserve_micros`. Максимальный резерв вычисляется по показанному тарифу: ceil(quota_bytes × rate_micros / 10^9). Изменившаяся политика: 409 price_changed; недостаточный бюджет: 409 budget_exceeded. В сессии возвращаются `tariff_revision`, `rate_micros`, `quota_bytes`, `reserve_micros`. Цена владельца при публикации/обновлении игнорируется. `/v1/me` возвращает `held_credits` отдельно от доступного баланса.

`POST /v1/admin/disputes/:id/resolve` требует `resolution` и `outcome`: `refund_held` либо `accept_charges`. Возврат допускается после закрытия нового контракта и только из его нераспределённого удержания. Повторное решение: 409 already_resolved. `/v1/admin/overview` содержит `economy`: issued_micros, available_micros, reserved_micros, escrow_micros, difference_micros (ожидается 0).

Ручной `POST /v1/admin/participants/:id/adjust` требует UUID `Idempotency-Key`. Ключ хранится в детерминированном UID проводки бессрочно: повтор не выпускает кредиты заново; другой amount/reason возвращает 409 idempotency_conflict.
