# Memo MVP — Анализ статуса и план

> Дата: 2026-06-04
> Дедлайн: 15 июня 2026

---

## КРАТКАЯ ВЕРСИЯ

### Что готово

| Модуль | Статус | Тесты |
|--------|--------|-------|
| Backend (FastAPI) | ✅ Готов | 274 passed, 2 xfailed |
| Admin Panel (Next.js) | ✅ Готов | 299/300 vitest |
| Public Website | ✅ Готов | 285 tests |
| API Integration | ✅ Готов | — |
| CI/CD | ✅ Готов | pytest + vitest + playwright |

### Что осталось

| Задача | Дни | Приоритет |
|--------|-----|-----------|
| Artist App (P4) | 4-5 | Средний |
| AI Concierge (P5) | 3 | Низкий |
| Tests & Polish | 2-3 | Высокий |

### Итого: ~10 дней до 15 июня

---

## ПОДРОБНАЯ ВЕРСИЯ

### Текущий статус (04.06.2026)

#### Backend

**Готово:**
- FastAPI + SQLite + Clean Architecture
- 12 CRUD сущностей (Masters, Services, Locations, Activities, Records, Clients, Payments, Visits, Visitors, Photos, Materials, Tags)
- FK enforcement включён
- Payment validation (gt=0)
- Double-delete protection (404)
- Health check, CORS, Admin panel

**Тесты:**
- 274 passed, 2 xfailed (cascade delete, capacity enforcement)
- Coverage: 78% (порог 80% — нужен рост на ~30 строк)
- E2E: 13 tests с DB verification

**Осталось доработать:**
- Cascade delete (visits, payments при удалении record)
- Capacity enforcement (ограничение мест)

#### Admin Panel

**Готово:**
- Schedule (/schedule) — неделя, DnD, stamp, modal
- Records (/records) — таблица, фильтры, пагинация
- Clients, Masters, Chat — заготовки
- ActivityDetailsModal — Settings, Client, New Booking табы
- Toasts, MiniCalendar, ThemeProvider

**Тесты:**
- 299/300 vitest (1 pre-existing Menubar — исправлен в PR)
- 47 E2E tests (schedule, records, visual regression)

**Осталось доработать:**
- ConflictWarning (двойное бронирование)
- Filters by artist/location на schedule
- Clients page — полная реализация
- Masters page — полная реализация
- Chat page — полная реализация

#### Public Website (colourmountains.ru)

**Готово:**
- Home, Services, Booking (4-step), Contact
- Online booking полный цикл
- 285 tests

**Осталось доработать:**
- SEO metadata, sitemap, robots

#### CI/CD

**Готово:**
- GitHub Actions: pytest + vitest + playwright
- Coverage threshold 80%
- Test/Dev DB separation

---

### Roadmap до 15 июня

#### Неделя 1 (5-11 июня)

| День | Задача | Результат |
|------|--------|-----------|
| Пн | Cascade delete + capacity enforcement | 2 xfail → pass, coverage 80%+ |
| Вт | Clients page — полная реализация | CRUD + фильтры |
| Ср | Masters page — полная реализация | CRUD + расписание |
| Чт | Chat page — базовая реализация | UI + mock responses |
| Пт | Tests & Polish — a11y, mobile | Build без ошибок |

#### Неделя 2 (12-15 июня)

| День | Задача | Результат |
|------|--------|-----------|
| Сб | Artist App (P4) — начало | Mobile schedule view |
| Вс | Artist App — продолжение | Availability toggle |
| Пн | Artist App — завершение | Push notifications (basic) |
| Вт | Final polish + deploy | MVP ready |

---

### Риски

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Artist App сложнее ожидаемого | Средняя | Высокое | Сократить до MVP (только расписание) |
| AI Concierge не нужен для MVP | Низкая | Среднее | Отложить после 15 июня |
| Coverage не вырастет до 80% | Низкая | Низкое | Уже 78%, легко добавить тесты |
| E2E тесты в CI не стабильны | Средняя | Среднее | Retry в playwright config |

---

### Рекомендации

1. **Сфокусироваться на Admin Panel** — это ядро MVP
2. **Artist App — упростить** — только расписание + доступность, без push
3. **AI Concierge — отложить** — не критично для запуска
4. **Tests & Polish — параллельно** — не ждать конца
5. **Deploy — автоматизировать** — Docker + CI/CD

---

### Метрики качества

| Метрика | Текущее | Цель |
|---------|---------|------|
| Backend coverage | 78% | 80%+ |
| Frontend tests | 299/300 | 300/300 |
| E2E tests | 47 | 50+ |
| Build time | ~2min | <3min |
| CI total time | ~5min | <8min |
