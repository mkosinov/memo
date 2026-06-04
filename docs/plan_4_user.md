# Memo MVP — Анализ статуса и план

> Дата: 2026-06-04 (обновлено)
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
| CI/CD | ⚠️ Partial | pytest + vitest ✅, E2E needs debug |

### Что осталось

| Задача | Дни | Приоритет |
|--------|-----|-----------|
| E2E в CI — починить schedule tests | 0.5 | Высокий |
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
- 12 CRUD сущностей
- FK enforcement включён
- Payment validation (gt=0) ✅ ИСПРАВЛЕНО
- Double-delete protection (404) ✅ ИСПРАВЛЕНО
- Health check, CORS, Admin panel

**Тесты:**
- 274 passed, 2 xfailed (cascade delete, capacity enforcement)
- Coverage: 78% (порог 80%)

**Осталось доработать:**
- Cascade delete (visits, payments при удалении record)
- Capacity enforcement (ограничение мест)

#### Admin Panel

**Готово:**
- Schedule (/schedule) — неделя, DnD, stamp, modal
- Records (/records) — таблица, фильтры, пагинация
- ActivityDetailsModal — Settings, Client, New Booking табы

**Тесты:**
- 299/300 vitest (Menubar тест исправлен ✅)
- 47 E2E tests (нужна отладка в CI)

**Осталось доработать:**
- E2E в CI — schedule page не грузит activities
- Clients page — полная реализация
- Masters page — полная реализация
- Chat page — полная реализация

#### CI/CD

**Готово:**
- GitHub Actions: pytest + vitest ✅
- Coverage threshold 80%
- Test/Dev DB separation
- CORS для E2E ✅

**Работает частично:**
- E2E tests — 33/48 pass
  - Visual regression — нет baseline скриншотов
  - Нужно добавить baseline скриншоты в репозиторий

---

### Roadmap до 15 июня

#### Неделя 1 (5-11 июня)

| День | Задача | Результат |
|------|--------|-----------|
| Пн | E2E debug — schedule loads from API | CI green |
| Вт | Cascade delete + capacity enforcement | 2 xfail → pass |
| Ср | Clients page — полная реализация | CRUD + фильтры |
| Чт | Masters page — полная реализация | CRUD + расписание |
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
| E2E в CI нестабильны | Высокая | Среднее | Debug schedule API |
| Artist App сложнее ожидаемого | Средняя | Высокое | Сократить до MVP |
| AI Concierge не нужен для MVP | Низкая | Среднее | Отложить после 15 июня |

---

### Метрики качества

| Метрика | Текущее | Цель |
|---------|---------|------|
| Backend coverage | 78% | 80%+ |
| Frontend tests | 299/300 | 300/300 |
| E2E tests | 11/48 pass | 48/48 |
| CI status | Partial | Full green |
