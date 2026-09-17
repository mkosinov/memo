# #257 IMPL: grep-инвентарь потребителей anonym_visits (Task 1)

Регенерирован 2026-09-16 на feat/257-anonymous-visits-unified @ 0ec854d.
Метод: `grep -rln "anonym_visits\|anonymVisits"` по backend/src, backend/tests, frontend/admin (app/hooks/__tests__/e2e), packages/.

## Backend src (12 хитов, 4 файла)
- `models/record.py:25` — колонка.
- `schemas/record.py:54,74,77(комментарий),87,98` — 4 схемы + комментарий.
- `services/record.py:101,352,466,501,591(комментарий),605,616(комментарий),623,661(комментарий),675,676,679,691(комментарий),693` — сборщик, guests-сортировка, create/update/patch.
- `domain/record_visits.py:28(комментарий),43` — пересчёт seats.

Расхождение со спекой (D2): план называл :101,:352,:466,:501,:605,:623,:675-699 — фактических точек больше (доп. :591,:616,:661,:691 — комментарии вокруг логики, гасятся тем же коммитом Task 2). Направление совпадает.

## Backend tests (53 хита, 9 файлов)
`conftest.py` (:604,:646-649 — fixture sample_record), `test_api_records.py` (28), `test_api_records_view.py` (:174,:569), `test_edge_cases.py` (:423-510), `test_record_seats_dedup.py` (4), `test_record_visits.py` (:30,:34), `domain/test_deletion.py` (4), `services/test_delete_cascades.py` (2), `services/test_visit_service.py` (2).

Расхождение со спекой: спека называла ~7 backend-тестов; фактических файлов 9 (добавились domain/test_deletion.py, services/test_delete_cascades.py, services/test_visit_service.py — упоминания в докстрингах/фикстурах, проверить при Task 2/9).

## Frontend source (7 файлов production + RecordHeader.test)
- `hooks/useRecordMutations.ts:171,329-330` (+ updateAnonymVisits ~:328-335).
- `app/(main)/clients/components/ClientRecordTab.tsx:213(комментарий),273`.
- `app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx:160`.
- `app/components/modal/ActivityDetailsModal/ClientTab.tsx:193,251,264`.
- `app/components/shared/record/blocks/RecordVisitsTable.tsx:117,207,235(+dead state)`.
- `app/components/shared/records/RecordHeader.tsx:16,21,24`.
- `e2e/wave6-record-status-derived.spec.ts:89,91,107` — scenario 3 (переписывается в Task 10).

## Frontend tests (14 файлов)
`__tests__/helpers/mockData.ts:155`, `__tests__/helpers/clientRecordTabSetup.ts:20`, `RecordsContext.test.tsx:81`, `ActivityDetailsModal.test.tsx:511`, `useReactQueryHooks.test.tsx:182`, `RecordsTable.test.tsx:24`, `useDeleteRecord.test.ts:50`, `ClientQuickCard.test.tsx:116`, `ClientsIntegration.test.tsx:137`, `recordsColumns.test.tsx:26`, `recordsTimeParity.test.ts:81`, `recordCacheSync.test.ts:77`, `ClientTab.integration.test.tsx`, `RecordVisitsTable.test.tsx`, `ClientRecordTab.interactions.test.tsx` (grep-хиты в свип-список Task 9).

## packages/api-client
`schemas.ts:391,500`, `endpoints.ts:585`, `schemas.test.ts:949,1008` — совпадает со спекой.

## Прочее
- `.gitignore` уже содержит `*.db` (:84) — правка не нужна.
- Артефакт workspace-БД: спека/план называли `~/dev/opencode/workspace/memo/memo.db` — путь в контейнере НЕ существует. Фактический артефакт найден и удалён: `/root/workspace/memo/memo.db` (корень репо; старая схема от 2026-06-01 — visits без tariff_id/custom_price, records без anonym_visits; 0 строк во всех таблицах; в git не отслеживался, покрыт `*.db`-игнором; guard `grep memo.db` по конфигам/скриптам живых ссылок не нашёл — все ссылаются на `backend/memo.db` или тестовые БД). Живой сид-конвейер `backend/memo.db` не тронут.
