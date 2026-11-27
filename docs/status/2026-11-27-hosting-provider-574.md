# GH #574 — VPS-хостинг прода (Selectel): редирект не-канонов, ежечасная проба доступности, скрипт провижинирования хоста

- **Date**: 2026-11-27
- **Branch**: `574-hosting-provider-prod-vps` (base `b2d7a927` = main на
  момент старта IMPL; HEAD `ded51044`)
- **Status**: Completed — код (3/4 задач); PR IMPL-этапа открывается
  сразу после docser-коммита (CI-watch/merge — finishing/@manager).
  Task 4 — ручной этап (владелец + сеанс) ПОСЛЕ мержа, выполняемым не
  считается
- **Range**: base `b2d7a927` — 3 код-коммита `9556fc48..ded51044`,
  4 файла, +1132/−0
- **Issue**: #574 — VPS-хостинг прода (Selectel): выбор провайдера,
  создание сервера, домены. Милстоун v1 (релиз 2026-12-01). Цель
  владельца — сервис открывается с мобильного во время режимов «белых
  списков»; провайдер — Selectel (реестр РКН + сигнал выживания
  подсетей), канон — `colourmountains.ru`, `www` и кириллический
  `.рф` — постоянный 301 на канон. Issue закрывается PR IMPL-этапа
- **Спека**: `docs/specs/2026-11-27-hosting-provider-574-design.md`
  (рев.2; `## Visual Compliance Checks` = N/A) — на main, unchanged
  by IMPL
- **План**: `docs/plans/2026-11-27-hosting-provider-574-plan.md`
  (4 задачи: 1–3 код, 4 — ручной этап) — на main, unchanged by IMPL
- **Смежные волны**: #616 (деплой-стек, в main через PR #629 — база
  этой волны), #617 (nginx/TLS/продление сертификатов), #618 (бэкапы),
  #619 (go-live ранбук; snapshot-before-release уходит туда)

## Что выполнено

Порядок исполнения по плану: 1 → 2 → 3; 4 — ручной этап после мержа
(сервер ещё не существует — редирект и провижининг должны быть на main
к моменту релизного деплоя).

1. **Edge — редирект не-канонов (T1, `9556fc48` small)** —
   `deploy/nginx.conf` (+24): `map $host $memo_noncanon { hostnames;
   default 1; colourmountains.ru 0; }` на http-уровне + server-level
   `if ($memo_noncanon) { return 301
   https://colourmountains.ru$request_uri; }` в существующем
   443-server. Без новых location/server-блоков; port 80 (редирект +
   ACME) и HSTS не тронуты. `www.colourmountains.ru` и punycode
   `xn--b1acfa3biol7a6ce.xn--p1ai` получают 301 с сохранением пути и
   query до любых ответов приложения (куки на не-канонах не ставятся).
2. **Ежечасная проба доступности (T2, `9140d337` ci small)** —
   `.github/workflows/uptime.yml` (новый, 30 строк): `schedule` cron
   `5 * * * *` + `workflow_dispatch`, один job `probe`, один шаг
   `curl -fsS --max-time 30 https://colourmountains.ru/api/v1/health`,
   `permissions: contents: read`. Раннеры GitHub — вне РФ: доступность
   пробы не зависит от белых списков.
3. **Скрипт провижинирования хоста (T3, `ded51044` standard)** —
   `deploy/provision-vps.sh` (новый, 559 строк): CLI
   `--user <name> [--pubkey <path|key>] [--email <addr>]`, preflight
   root + Ubuntu, восемь идемпотентных блоков в порядке плана, каждый
   печатает следующий ручной шаг; три env-шва для тестов
   (`PROVISION_ETC_ROOT`, `PROVISION_OPT_ROOT`, `PROVISION_SWAPFILE`).
   Hermetic dry-run сьют `deploy/provision-vps.sh.test.sh` (новый,
   519 строк, PATH-шим-архитектура, не подключён к CI — как сиблинги
   `deploy/*.test.sh`).

### Архитекторские решения IMPL (объясняют поведение скрипта)

1. CLI `--user/--pubkey/--email`; preflight root + Ubuntu; восемь
   идемпотентных блоков, каждый печатает следующий ручной шаг; три
   env-шва тестов.
2. **Lock-out guard**: у deploy-пользователя должен быть ≥1 authorized
   key (из `--pubkey` или `~/.ssh/authorized_keys` вызывающего) до
   любой записи sshd-харденинга; sudoers drop-in валидируется
   `visudo -cf` до установки; passwordless sudo — только для key-only
   deploy-пользователя.
3. **DNS-гейт (закрытый зазор плана)**: план планирует DNS A-записи
   после первого прогона скрипта, поэтому блок 7 отказывает в выпуске
   сертификата, пока хотя бы одно из трёх имён не резолвится — печатает
   ручной шаг и завершается кодом 10 («paused: owner action required —
   re-run»).
4. **Deploy-hook (закрытый зазор плана)**: продления certbot обновляют
   только `/etc/letsencrypt`; бинд-маунт-копия в `/opt/memo/certs`
   обновляется самим хуком (dereference + атомарная замена) перед
   `docker exec edge nginx -t && docker exec edge nginx -s reload`.
5. `/opt/memo/deploy` создаётся и отдаётся deploy-пользователю
   (GitHub Actions кладёт туда deploy-скрипты по scp); права:
   `env` + `deploy` → deploy-пользователь, `data` + `media(+public)` →
   uid 1001, `certs` + `acme` → root (сверено с `deploy/render-env.sh`,
   `.github/workflows/deploy.yml`, `deploy/docker-compose.prod.yml`,
   `deploy/Dockerfile.backend`).

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| T1 — throwaway dockerized probe P1–P5 | green: не-канонические `www` и punycode → 301 с точным `Location` (path + query сохранены), без `Set-Cookie`; канон не редиректится; port 80 без изменений |
| T1 — `deploy/verify-edge.sh` | **6/6** стадий green |
| T2 — throwaway js-yaml валидатор workflow | **18/18** |
| T2 — behavioral-стаб пробы | 200 → exit 0, 404 → exit 22 |
| T3 — `bash deploy/provision-vps.sh.test.sh` | **PASS 94 / FAIL 0** |
| T3 — `bash -n` / shellcheck | чисто / без находок |
| Ревью | T1 code-compliance ✅; T2 code-compliance ✅; T3 code-compliance ✅ (вкл. аудит герметичности/безопасности) + code-quality ✅ (5 неблокирующих замечаний) |
| Visual gate (спека `## Visual Compliance Checks`) | N/A → exit 0 |
| Полный CI | гейт PR (manager-owned) |

## Behavioral Delta

Пользовательского поведения в коде нет — фича инфраструктурная. Дельта
вступает в силу после ручного этапа (Task 4) и релизного деплоя с этим
редиректом: клиент с не-канона (`www.colourmountains.ru`, кириллический
`.рф`) по HTTPS получает 301 на канон с сохранением пути и query (куки
не ставятся — редирект уровня nginx до приложения); владелец получает
ежечасную внешнюю пробу доступности прода. Целевая цель спеки —
достижимость сервиса с мобильного в режимах белых списков —
верифицируется приёмкой Task 4 (наблюдение владельца + сверка /24
выданного IP с сообществскими списками выживших подсетей).

## Известные остатки (open items, issues НЕ заводятся из этой волны)

- **Task 4 — ручной этап (владелец + сеанс), после мержа**: VM Selectel
  2 vCPU/2 ГБ/30 ГБ Ubuntu 24.04, проверка выданного IP (белые списки,
  пересоздание до остальной настройки при «мёртвой» подсети), DNS
  A-записи `@`, `www`, `xn--b1acfa3biol7a6ce.xn--p1ai` (Яндекс DNS),
  GitHub-секреты `DEPLOY_SSH_HOST/USER/KEY` + app-секреты, еженедельные
  снапшоты Selectel, проба egress ghcr.io, релизный деплой (нужен
  редирект на main), 5 приёмочных сценариев спеки +
  `certbot renew --dry-run --run-deploy-hooks`; снапшот-перед-релизом
  уходит в ранбук #619.
- **Uptime-воркфлоу красный ежечасно** с мержа до go-live (принято
  планом); опция — отключить schedule до go-live.
- **Неблокирующие замечания ревью** `deploy/provision-vps.sh(.test.sh)`:
  сценарий с падающим certbot-шимом (ассерт STARTED→STOPPED
  temp-server); `bash -n` сгенерированного хука; дублирование прозы
  header ↔ `usage()`; внятная ошибка при наличии docker CLI без
  compose-плагина; python3-шим оставляет один осиротевший `sleep`.
- **Кандидат**: подключить `deploy/*.test.sh` в CI (сейчас ни один из
  них не гоняется в CI).

## PR-заметки

- `Closes #574` — только в описании PR (канон репо), в коммиты не
  пишется; issue закрывается PR IMPL-этапа.
- Спека рев.2 и план (4 задачи) — на main, unchanged by IMPL;
  docser-коммит — только мета-доки (PLAN.md, CHANGELOG.md, этот файл).
- Доска: карточка #574 остаётся в рабочем статусе до создания PR
  (перевод в `PR (G7)` — на моменте `gh pr create`, не docser).

## Тронутые файлы (`git diff --name-only b2d7a927..ded51044`)

```
.github/workflows/uptime.yml
deploy/nginx.conf
deploy/provision-vps.sh
deploy/provision-vps.sh.test.sh
```

## References

- **GitHub Issue**: #574
- **Design Spec**: `docs/specs/2026-11-27-hosting-provider-574-design.md`
  (рев.2)
- **Plan**: `docs/plans/2026-11-27-hosting-provider-574-plan.md`
- **Смежные**: #616 (деплой-стек), #617 (nginx/TLS/DNS), #618 (бэкапы),
  #619 (go-live ранбук)
- **PR**: открывается сразу после docser-коммита
