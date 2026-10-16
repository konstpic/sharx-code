# Поддержка Xray-core 26.9.30 и 26.10.10 в панели

Релизы XTLS/Xray-core v26.9.30 и v26.10.10 (prerelease) вышли без описания; список изменений собран по
`compare/v26.9.9...v26.10.10` (59 коммитов), а имена JSON-полей сверены с исходниками тега `v26.10.10`
(`infra/conf/masque.go`, `transport_method.go`, `transport_finalmask.go`, `router.go`, `dns.go`, `wireguard.go`).

## Версия ядра

- В образах панели и нод ядро по-прежнему **26.9.9**: `DockerInit.sh:66` (URL загрузки), комментарий в
  `node/Dockerfile:28`. Версию, закреплённую админом через «Обновить Xray», хранит настройка
  `xrayPinnedVersion` (панель) и `Node.XrayPinnedVersion` (ноды).
- Go-библиотека `xray-core` в `go.mod` указана по коммиту (`v1.260327.1-0.20260908...`) и нужна панели только для
  разбора конфигурации; она не определяет версию бинарника.
- Список версий в диалоге «Версии ядра» берётся динамически из `GET /repos/XTLS/Xray-core/releases`
  (`ServerService.GetXrayVersions`): prerelease входят, фильтр — не ниже 25.9.11, поэтому 26.9.30 и 26.10.10 в списке
  есть, как только GitHub их отдаёт.
- Рекомендация: образы не менять до проверки на тестовой ноде. Переход на 26.10.10 содержит несовместимое изменение
  (WireGuard, см. ниже); переключать лучше через «Обновить Xray» на одной ноде.

Версия работающего ядра панели доступна как `status.xray.version`; на фронтенде её отдаёт хук `useXrayCoreVersion`.
Минимальные версии функций описаны в `panel/lib/xrayVersionFeatures.ts` (чистые функции, тесты рядом). Если версия
неизвестна, ничего не блокируется. Ноды могут работать на другой версии: подсказки относятся к ядру самой панели.

## Что поддерживается

| Функция | Мин. версия | Где в панели |
|---|---|---|
| MASQUE outbound (CONNECT-IP, RFC 9484, HTTP/2 Extended CONNECT) | 26.9.30 | Xray → Outbounds: протокол `masque`, форма (адрес, порт, `remoteDNS`, `masqueSettings`, WARP, TLS) |
| MASQUE inbound | 26.9.30 | Только JSON шаблона ядра (схема, подсказки, сниппет `inbound:masque`, проверка) |
| WARP-профиль MASQUE, `warp.publicKey` обязателен | 26.10.10 | Форма outbound и проверка; на 26.9.30 ключ не требуется |
| Транспорт XDRIVE (Google Drive, `template`) | 26.9.30 | Outbounds: сеть `xdrive`, форма `xdriveSettings`; JSON-схема для inbound/outbound |
| Noise finalmask `type: "exp"` | 26.9.30 | JSON-схема, сниппет, проверка версии |
| XDNS finalmask: `domains[].names`, `resolvers[].addrs` | 26.10.10 | JSON-схема, сниппет, проверка (старые имена при ядре ≥ 26.10.10 — ошибка) |
| Lua `script` для `dns` и `routing` | 26.10.10 | JSON-схема (разделы `dns`, `routing`, полный шаблон), сниппет, предупреждение о версии; формы DNS и маршрутизации ключ сохраняют |
| WireGuard outbound: удалены `remoteDNS: ["local"]` и `domainStrategy` | 26.9.30 | Проверка конфигурации: ошибка и предупреждение при ядре ≥ 26.9.30 |

Проверки выполняются на вкладке настроек Xray (`lintXrayConfig`) и показываются рядом с разделом: обязательные поля
MASQUE (`address`, `port`, пользователи `email`/`pass`, префиксы `address`, `mtu` 1280–65535, запрещённые заголовки
`Host`/`Capsule-Protocol`, несовместимость с `mux`, `warp` + `user`/`pass`), транспорт `masque` только у протокола
`masque`, три секрета для Google Drive, обязательные операции и `namesRegex` с одной группой для `template`.

### Формат полей (проверен по исходникам)

- outbound `masque`: `settings` = `{address, port, remoteDNS[]}`; `streamSettings.network = "masque"`,
  `masqueSettings` = `{host, path, user, pass, headers, warp: {privateKey, publicKey, address[]}}`. Путь по умолчанию
  `/.well-known/masque/ip/*/*/`; для `warp` пустые `host`/`path` заменяются адресом Cloudflare.
- inbound `masque`: `settings` = `{users|clients: [{email, pass, level}], address: [префикс], mtu}`; не более одного
  префикса IPv4 и одного IPv6.
- `xdriveSettings`: `remoteFolder`, `service` (`Google Drive` — `secrets` = ClientID, ClientSecret, RefreshToken;
  `template` — объект `template`; `local`), `segmentBytes`, `flushIntervalMs`, `pollIntervalMs`, `maxPollIntervalMs`,
  `sessionTtlSeconds`, `concurrency`, `eagerWindowMs`, `holeTimeoutMs`.
- XDNS в 26.9.30 использовал `domains[].name` и `resolvers[].type`/`settings.addr`, до этого — строки; с 26.10.10 —
  `names` и `addrs`.

## Что намеренно не поддерживается

- **Inbound MASQUE и XDRIVE в «Inbound» панели** (клиенты, подписки, ссылки). Форма инбаундов привязана к
  фиксированному набору протоколов и сетей (`inboundDefaults.ts`), у MASQUE пользователь — пара `email`/`pass`, а
  стандартной share-ссылки у протокола нет. Использование: JSON шаблона ядра (Xray → Inbounds) или outbound. В
  подписках (ссылки, Clash, JSON) MASQUE/XDRIVE не публикуются: формат определяют клиенты, общепринятого нет.
- **Редактор Lua.** Панель только проверяет и подсказывает поле `script`; файл скрипта нужно положить рядом с ядром
  вручную, панель его не загружает и не проверяет.
- **TUN-инбаунд** (`autoSystemDnsToGateway`, `autoSystemWfpBlockLeak`): клиентская функция устройства, на серверной
  панели не используется. Обратите внимание: `autoSystemDNS` был переименован в `autoSystemDnsToGateway` в 26.10.10.
- **TLS-изменения** (встроенные RootCAs по умолчанию, ECH `verifyPeerCertByName: "fromMitm"`), FakeDNS (пул IPv6
  `2001:2::/48` по умолчанию), `xray api adu` для Hysteria, рефакторинг SS2022, заголовки HTTPUpgrade — работают в
  ядре без изменений конфигурации, UI не нужен.
- **Автоматическая миграция** конфигураций WireGuard и XDNS: панель только предупреждает, поля не переписываются.

## Ограничения

- Проверка версии использует ядро панели; ноды с другим ядром в предупреждениях не учитываются.
- Для WARP на 26.10.10 нужны оба ключа (`privateKey`, `publicKey`); профиль старого формата без `publicKey` не
  запустится после обновления ядра.
- Если ядро ниже 26.9.30, outbound `masque` и сеть `xdrive` не загрузятся: Xray ответит `unknown transport protocol`
  или `unknown protocol`.
