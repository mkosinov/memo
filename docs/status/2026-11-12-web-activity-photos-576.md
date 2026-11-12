# GH #576 — Публичные фото услуги и её занятий в деталях расписания (web)

- **Date**: 2026-11-12
- **Branch**: `576-web-activity-photos` (HEAD `714bd412`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `35b7521f` — 6 задач, 9 коммитов, 26 файлов, +1342/−278
- **Issue**: #576 — гость, открыв детали занятия в веб-расписании, видит под
  главной картинкой (обложка услуги) ряд миниатюр: публичные прямые фото
  услуги, затем публичные фото её занятий (≤20, один запрос); клик по
  миниатюре ставит её в главную; нет фото — ряда нет. Один новый фильтр
  `service_id` на `GET /api/v1/public/photos` (объединяющая семантика
  variant A + двухгрупповой порядок).
- **Спека**: `docs/specs/2026-11-12-web-activity-photos-576-design.md`
  (рев.3) — на main (`856fc5eb`), unchanged by IMPL
- **План**: `docs/plans/2026-11-12-web-activity-photos-576-plan.md` — на
  main (`35b7521f`), 6/6 задач, все done, unchanged by IMPL
- **Domain rules**: `docs/domain-rules/photos.md` — секция «Галерея деталей
  занятия в web (#576)» (Frontend composition) и строка `service_id` в
  таблице эндпоинтов влиты в main вместе со спекой (`856fc5eb`, канон:
  дом-правила едут со спекой) — отдельной задачи IMPL не требовали

## Что выполнено

1. **Бэкенд — фильтр `service_id` на публичной витрине (T1, `d112968c`
   standard)** — `GET /api/v1/public/photos` принимает `service_id`:
   новый параметрический кирпич `PublicPhotoListParams(PaginationParams)`
   с единственным полем (вместо админского `PhotoListParams` — иначе на
   анонимный маршрут протекли бы админ-фильтры); в
   `list_public_photos_view` при заданном фильтре — переиспользование
   ветки variant A общего билдера (LEFT OUTER JOIN: прямые фото услуги
   ИЛИ фото её занятий) + кастомный двухгрупповой `order_by`-шов для
   разделяемого list-core: сначала прямые фото услуги, затем фото
   занятий, внутри групп закреплённый `created_at desc, id asc`;
   принудительный `is_public=True` и схема `PhotoPublicResponse` не
   изменились; без фильтра — прежний путь байт-в-байт.
2. **api-client — `service_id` у `getPublicPhotos` (T2, `2238a60a`
   trivial)** — `PhotoPublicListParams` получил `service_id?: string`,
   попадает в query-string; параметр отсутствует — в URL не пишется;
   Zod-зеркало ответа не тронуто.
3. **Web-модель — `serviceId` вниз по цепочке, мёртвая цепочка долой
   (T3, `8046a7f7` + `a122efc2` + `66f14176`, standard)** —
   `serviceId` протянут вниз `WebScheduleDTO` → `ScheduleView` →
   `ActivityView` (маппер `to-schedule-vm`, адаптер `page.tsx`);
   удалена мёртвая цепочка `photos`/`guestPhotos`: поле
   `WebScheduleDTO.photos`, `ScheduleView.photos`, адаптерный
   `guestPhotos`, осиротевшие DTO-модули `activity`/`schedule`/`photo`
   и мёртвый маппер `to-activity-vm` вместе с тестом — рендером не
   использовались.
4. **Хук `useServicePhotos` (T4, `2e92591a` small)** — одна загрузка
   `getPublicPhotos({ service_id, per_page: 20 })` на ключе
   `['photos', 'public', 'service', serviceId]`; политики кэша как у
   `useGallery` (`staleTime` 5 мин / `gcTime` 10 мин); маппинг через
   `toGalleryPhotoView` (allowlist — невалидный filename
   отбрасывается, порядок ответа сохраняется); ошибка пробрасывается —
   `photos: []` + `error`.
5. **Полоса миниатюр в `ActivityDetail` (T5, `f426320d` standard)** —
   под главной картинкой контейнер `activity-photo-strip`
   (`flex overflow-x-auto no-scrollbar`): первая миниатюра — обложка
   (при наличии), далее фото из `useServicePhotos(activity.serviceId)`
   в порядке ответа; главная картинка `activity-photo-main` — дефолт
   обложка, клик по миниатюре (`activity-photo-thumb`, нативный
   `<button>`) меняет `src` локальным состоянием, активная —
   `aria-current="true"`; обложки нет — главная по умолчанию первое
   фото ряда, миниатюры обложки нет; пустой ответ — ряда нет; a11y
   (`role="group"`, `tabindex="0"`, `aria-label` ряда и миниатюр,
   `:focus-visible`), `loading="lazy"` + `decoding="async"` + явные
   `width`/`height`.
6. **E2E `activity-photos.spec.ts` (T6, `64c762a7` + `714bd412`
   standard)** — фикстуры через API (не сид): стафф-логин в `beforeAll`,
   выбор услуги и двух её занятий на видимой в вебе неделе, 5 фото
   (2 публичных прямых услуги с разными `created_at`, 2 публичных
   второго занятия, 1 непубличное услуги), filename — существующие
   статические изображения `public/images/` (канон #513: байты отдаёт
   статика, `is_public` фильтрует только списки); `afterAll` — чистка;
   захват дат однократно, выводимый индекс группы (устойчивость
   фикстур, `714bd412`). Сценарии: US-1 полный состав и порядок ряда +
   смена главной + возврат обложки + отсутствие непубличного; US-2
   занятие без своих фото; US-3 услуга без прямых фото, фото только у
   занятия; US-4 фото нет вовсе — ряда нет, обложка на месте. Спек
   мутационно-верифицируемый (дискриминирующие ассерты).

## Отклонения и фикс-циклы

- Девиаций от спеки рев.3 нет; спека, план и дом-правило — коммиты
  main (`856fc5eb`, `35b7521f`) ещё до ветки, IMPL их не касался.
- T6: fix-коммит `714bd412` — устойчивость e2e-фикстур (захват дат
  однократно, выводимый индекс группы вместо хрупких селекторов).
- **Visual gate G4.5**: runner не может кликнуть в детали занятия
  (§7 overlay seam) → exit 1 без продуктового дефекта; **пользовательское
  решение (Option A)** — e2e-спек принят визуальной верификацией фазы;
  follow-up дизайн-issue **#602** уже заведён (не дублировать).

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| Backend таргет (фото-сьюты, вкл. `test_api_photos.py` 79/79) | **259/259** |
| web vitest | **570/570** (64 файла) |
| api-client vitest | **577/577** |
| e2e `activity-photos.spec.ts` (US-1…US-4, мутационно-верифицируемый) | **4/4** |
| e2e cabinet-photos (санити соседней поверхности) | **1/1** |
| tsc (web + api-client) | чистые |
| ruff / mypy (изменённые файлы) | чистые |
| Visual compliance gate G4.5 | **exit 1 → пользовательское перекрытие (Option A)** — §7 overlay seam (runner не кликает в детали), не продуктовый дефект; e2e принят визуальной верификацией; follow-up — #602 |

## Ревью

- T1–T3, T5, T6 — standard (two-stage), T4 — small (1-stage); все
  ревью пройдены (compliance ✅, quality ✅ где применимо), финальный
  статус — review-green; T6 fix-раунд сложен в ветку (`714bd412`).
- Миноры quality-ревью — не блокирующие, в этот PR не входят
  (follow-up-кандидаты, см. ниже).

## Behavioral Delta

Новая пользовательская возможность для гостя веб-витрины: в деталях
занятия под главной картинкой появляется ряд миниатюр — обложка услуги
(первая, главная по умолчанию), затем публичные прямые фото услуги,
затем публичные фото её занятий; один запрос
`GET /api/v1/public/photos?service_id=…`, ≤20 фото, больше — молчаливое
усечение (догрузка вне объёма); клик по миниатюре ставит её в главную;
пусто после allowlist — ряда нет; видимость владельца не проверяется
(контур один — `is_public`). Контракт публичной витрины расширен
опциональным `service_id` (объединяющая семантика variant A,
двухгрупповой порядок); без параметра ответ прежней формы. Мёртвая
цепочка `photos`/`guestPhotos` в web-модели удалена — поведение не
менялось (рендером не использовалась). Админка, кабинет, галерея
витрины не тронуты.

## Известные остатки (follow-up-кандидаты, не в этом PR)

- `ActivityDetail.tsx`: `enabled`-гвард хука на пустой `serviceId`
  (теоретический минор quality-ревью).
- Дубли URL в ряде: неоднозначность `aria-current` при совпадающих
  адресах картинок — выбирать по ключу, не по `src`.
- E2E-фикстура `activity-photos.ts` ~100 строк дублирования против
  `admin-activity.ts` — кандидат на выделение общего хелпера.
- §7 overlay seam визуального гейта — дизайн-issue **#602** (уже
  заведён, не дублировать).

## PR-заметки

- `Closes #576` — только в описании PR (канон репо), в коммиты не пишется.
- Спека рев.3 (`856fc5eb`), план (`35b7521f`) и дом-правило
  (`photos.md`, Frontend composition + строка `service_id`) — на main,
  unchanged by IMPL; docser-коммит — только мета-доки (PLAN.md,
  CHANGELOG.md, этот файл).
- Visual gate G4.5: пользовательское перекрытие Option A (2026-11-12) —
  e2e-спек принят визуальной верификацией фазы; follow-up #602 уже на
  доске.

## Тронутые файлы (`git diff --name-only 35b7521f..714bd412`)

```
backend/src/api/v1/public.py
backend/src/schemas/photo.py
backend/src/services/photo.py
backend/tests/test_api_photos.py
frontend/web/app/__tests__/page.test.tsx
frontend/web/app/hooks/__tests__/useServicePhotos.test.tsx
frontend/web/app/hooks/useServicePhotos.ts
frontend/web/app/lib/mappers/__tests__/buildSchedule.test.ts
frontend/web/app/lib/mappers/__tests__/to-activity-vm.test.ts
frontend/web/app/lib/mappers/__tests__/to-schedule-vm.test.ts
frontend/web/app/lib/mappers/buildSchedule.ts
frontend/web/app/lib/mappers/to-activity-vm.ts
frontend/web/app/lib/mappers/to-schedule-vm.ts
frontend/web/app/lib/model/dto/activity.ts
frontend/web/app/lib/model/dto/photo.ts
frontend/web/app/lib/model/dto/schedule.ts
frontend/web/app/lib/model/view/activity.ts
frontend/web/app/lib/model/view/schedule.ts
frontend/web/app/page.tsx
frontend/web/app/ui/ActivityDetail.tsx
frontend/web/app/ui/__tests__/ActivityDetail.test.tsx
frontend/web/app/ui/__tests__/BookingOverlay.test.tsx
frontend/web/e2e/activity-photos.spec.ts
frontend/web/e2e/fixtures/activity-photos.ts
packages/api-client/src/endpoints.test.ts
packages/api-client/src/endpoints.ts
```

## References

- **GitHub Issue**: #576
- **Design Spec**: `docs/specs/2026-11-12-web-activity-photos-576-design.md` (рев.3)
- **Plan**: `docs/plans/2026-11-12-web-activity-photos-576-plan.md` (6/6)
- **Domain rules**: `docs/domain-rules/photos.md` «Галерея деталей занятия в web (#576)»
- **Смежные**: #493 (публичный фото-контракт — маршрут и схема, на которых стоит фильтр), #583 (канон тестов публичной витрины), #513 (кабинет — канон статических filename-фикстур), #602 (follow-up: §7 overlay seam визуального гейта)
- **PR**: _(to be added after PR creation)_
