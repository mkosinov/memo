# #352 — dev-workflow skill: ограничение Playwright setOffline для установленных SSE-сокетов

- **Issue:** [#352](https://github.com/mkosinov/memo/issues/352) (docs/harness-only, fast-track)
- **Дата:** 2026-09-21 (rev2 — панель 5/6, все файндинги внесены)
- **Статус:** Gate B — ожидает ОК пользователя
- **Тип:** правка одного файла харнесса (`.opencode/skills/dev-workflow/SKILL.md`), код приложения не меняется

## Контекст и разведка

Грабля найдена в работе #330 (PR #350, смержен в main): `context.setOffline(true)` в Playwright блокирует **новые** запросы контекста, но **не разрывает уже установленный** EventSource (SSE)-сокет. Проба #330: 27 секунд «офлайна» — ноль событий `onerror`, канал жив («zombie channel»). Тест, который ассертит поведение мёртвого канала после `setOffline`, проходит «пусто» (vacuous): канал продолжал работать всё время.

Решение, применённое в #330: cold-start `route.abort` на SSE-эндпоинте — маршрут регистрируется **до** `page.goto`, соединение не устанавливается вовсе, `onerror` срабатывает детерминированно. Живые probe-факты: `frontend/admin/e2e/server-push-offline.spec.ts:36–39` (NOTE о zombie channel) и `:54–65` (VEHICLE — route.abort, NOT setOffline, probe-verified).

Факты по дереву (разведка 2026-09-21):

- dev-workflow skill существует **только** в контейнерной копии харнесса: `.opencode/skills/dev-workflow/SKILL.md` (269 строк); в `.zcode/skills/` его нет. Секция «## Playwright E2E» (строки 120–229) содержит подсекции 1–6; заметки про `setOffline` в ней нет — пробел подтверждён.
- `setOffline` в репо сегодня: `server-push-offline.spec.ts:140,150` (С5 — сходимость после возврата сети, валидное применение), `records.spec.ts:1241–1266` (S5 — провал commit-запроса, валидное применение), `activity-deferred-delete.spec.ts:324` (комментарий о ненадёжности для loopback-кейса).
- WebSocket в приложении **не используется** — транспорт только SSE (EventSource: `frontend/admin/app/ServerEventsProvider.tsx`).
- Историческая ловушка: план #239 (`docs/plans/2026-09-08-server-push-invalidation-239-plan.md:591`) советует «do NOT use route.abort: it does not reliably intercept EventSource». Это верно **только для уже установленного** сокета (route.abort не может убить живой SSE не лучше setOffline); cold-start abort — до установления — работает детерминированно. Оба утверждения совместимы, и их надо развести явно, иначе два документа выглядят противоположными советами.

**Вердикт разведки: актуально** — все три утверждения issue подтверждаются живым деревом, заметки в skill нет.

## Концепт (Gate A — авто-OK)

Единственный концепт: новая подсекция **«### 7. Offline simulation: setOffline vs established sockets»** в конце секции «## Playwright E2E» файла `.opencode/skills/dev-workflow/SKILL.md`. Текст по-английски (правило харнесса: skill-файлы — на английском).

Отвергнутые альтернативы:

- **Отдельный новый skill** — переизобретение: e2e-паттерны уже живут в dev-workflow, второе место плодит рассинхрон.
- **Заметка в `docs/tests_workflow.md`** — канон тестовой механики, но issue прямо указывает dev-workflow skill; docs/tests_workflow.md остаётся каноном визуальных базлайнов, не каждого e2e-приёма.

Различий видимым поведением, схемой данных, контрактом API нет — развилки для пользователя нет.

## Содержимое заметки (что именно войдёт в skill)

Подсекция фиксирует правила, сверенные с probe-фактами #330 (компактно, в объёме соседних подсекций — целевая длина до ~25 строк; имена сценариев в заметке — латиницей: S1, S5, без кириллической «С»):

1. **Ограничение** (probe-verified, dev Chromium). `context.setOffline(true)` blocks new requests but does NOT kill an established EventSource (SSE) socket — probe #330: 27s offline → zero onerror events. Any assert relying on the channel being dead after `setOffline` is vacuous. Same applies to any established socket (WebSocket included; the app is SSE-only today).
2. **Когда канал нужен мёртвым.** Cold-start `route.abort` on the SSE events endpoint, registered BEFORE any `page.goto` (живой паттерн: `ctxA.route('**/api/v1/events', route => route.abort('connectionreset'))` до загрузки страницы) — deterministic: ES connect fails, `onerror` loop, `readyState 0`. Restore = `unroute` the pattern → the ES reconnect fires `open`. Сноска: `navigator.onLine` stays TRUE — SPA navigation and plain fetches keep working unless the abort route covers them.
3. **setOffline НЕ запрещён.** Valid для симуляции офлайна обычного HTTP-трафика (мутации, refetch) — референс: `records.spec.ts` S5 (провал commit). Одна строка: `setOffline` is per-context — другие контексты (вторая страница/контекст теста) не затрагиваются.
4. **Развязка с историческими фразами** (1–2 строки). «route.abort does not reliably intercept EventSource» (план #239, спека #239 §6 сценарий 5, комментарий в `server-push-offline.spec.ts`) — про разрыв УЖЕ установленного сокета; cold-start abort — про установление. Не противоречие, а два случая. План #330 S1/S2 предписывал `setOffline` — superseded фактической реализацией PR #350 (route.abort).

## User Scenarios

1. **Агент контейнера пишет новый e2e-тест на смерть канала** (потеря соединения, детект разрыва, тишина пушей): открывает dev-workflow skill → правило → выбирает cold-start `route.abort` до загрузки страницы, не `setOffline`; для проверки восстановления канала знает, что снимать — `unroute`. Референс реализации: S1/S2 #330 (`server-push-offline.spec.ts`).
2. **Агент читает чужой тест с `setOffline`** (`records.spec.ts` S5): правило разводит случаи — блокировка HTTP-запросов валидна, ожидание мёртвого SSE-канала — нет; агент не «чинит» рабочие тесты и не копирует паттерн не туда.
3. **Ревьюер (или автор) смотрит «зелёный» тест на смерть канала**: критерий — маршрут abort зарегистрирован ДО `page.goto` (cold-start)? Если тест стоит на `setOffline` — ассерт vacuous, канал жил («zombie channel»), ссылка на подсекцию; автор находит в ней объяснение и probe-факты, транспорт меняется до мержа, а не после инцидента.

(Сценарии — сценарии использования документации; механическая проверка их носителя — в секции Verification.)

## Behavioral Delta

- **До:** правило живёт только в комментариях живого теста (`server-push-offline.spec.ts:36–65`) и в памяти участников #330. Агент вне этого контекста повторяет граблю: пишет «тест потери канала» на `setOffline`, получает зелёный vacuous-прогон, дефект детекта разрыва не ловится.
- **После:** правило в каноническом месте харнесса — e2e-секция dev-workflow skill, которую агент контейнера читает перед написанием e2e. Выбор транспорта офлайн-симуляции (setOffline vs cold-start abort vs остановка сервера) делается по правилу, а не по догадке; видимое противоречие с планом #239 снято явной развязкой.

## Границы скоупа (что сознательно НЕ строим)

- Не меняем существующие e2e-тесты — они корректны (проверено разведкой).
- Не создаём отдельный skill и не переносим заметку в `docs/tests_workflow.md`.
- Не добавляем WebSocket-инфраструктуру и WS-тесты — применимость правила к WS фиксируется одной строкой в пункте 1.
- Не правим исторические документы (план/спека #239, план #330) — развязка с их фразами живёт строкой в пункте 4 заметки.
- Не дублируем подсекцию в `.zcode/skills/` — dev-workflow skill контейнерный, живёт одной копией.

## Verification (fast-track — план не пишется)

1. `grep -n "setOffline" .opencode/skills/dev-workflow/SKILL.md` — находит новую подсекцию (до правки: пусто).
2. Подсекция пронумерована «7» и стоит внутри «## Playwright E2E» после «### 6. Visual snapshot regeneration».
3. Формулировки сверены с probe-фактами `server-push-offline.spec.ts:36–65` (27s offline → zero onerror; явно присутствуют «registered BEFORE `page.goto`», «dev Chromium», `unroute` как путь восстановления канала).
4. Файл остаётся англоязычным; длина подсекции — до ~25 строк (в духе соседних подсекций, 12–18 строк).
5. `git diff` показывает изменение ровно одного файла харнесса.
