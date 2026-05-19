# Архитектура Memo — Turborepo Monorepo

> Дата: 2026-05-19
> Статус: Активно (миграция завершена)

## Обзор

Проект Memo использует **Turborepo + npm workspaces** для управления множественными frontend-приложениями и shared packages.

**Почему Turborepo:**
- 3+ frontend приложения (admin, web, master) работают с одним backend
- Shared типы данных и API клиент без дублирования
- Изолированные бандлы — zero admin-кода в сайте colourmountains.ru
- Единый CI/CD pipeline

---

## Структура репозитория

```
memo/
├── apps/                          # Frontend приложения
│   ├── admin/                     # Админ-панель (Next.js 14)
│   │   ├── app/                   # App Router pages
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   └── package.json           # deps: @dnd-kit, @radix-ui
│   │
│   ├── web/                       # colourmountains.ru (Next.js 14)
│   │   ├── app/
│   │   ├── components/
│   │   └── package.json           # deps: framer-motion
│   │                              # НЕТ @dnd-kit, НЕТ admin-specific deps
│   │
│   └── master/                    # Приложение для мастеров (future)
│       └── package.json           # deps: mobile-first libs
│
├── packages/                      # Shared packages
│   ├── domain/                    # TypeScript типы + Zod схемы
│   │   ├── src/index.ts           # Artist, Activity, BookingRecord, etc.
│   │   └── package.json           # deps: zod
│   │                              # sideEffects: false, zero runtime
│   │
│   └── api-client/                # HTTP клиент к FastAPI
│       ├── src/client.ts          # fetch-обёртка с Zod-валидацией
│       ├── src/endpoints.ts       # getActivities, getBookings, etc.
│       └── package.json           # deps: zod, @memo/domain
│
├── backend/                       # FastAPI (отдельный сервис)
│   └── app/
│
├── turbo.json                     # Pipeline: build, dev, test
├── pnpm-workspace.yaml           # Workspace declaration
└── package.json                   # Root: workspaces + turbo
```

---

## Принципы разделения

### Что shared (packages/)

| Пакет | Что внутри | Почему shared |
|-------|-----------|---------------|
| `@memo/domain` | TypeScript интерфейсы + Zod схемы | Activity — это Activity в admin, web и master |
| `@memo/api-client` | Fetch-функции + runtime валидация | HTTP контракт один для всех |

### Что НЕ shared (каждый app сам)

| Компонент | Причина изоляции |
|-----------|-----------------|
| Button, Input, Card | Разный дизайн: admin (тёмный, плотный) ≠ web (светлый, визуальный) ≠ master (мобильный) |
| Layout (Sidebar, Header) | Разная структура навигации |
| @dnd-kit | Только admin нужен drag-n-drop |
| @radix-ui/react-dialog | Только admin использует сложные модалки |

---

## Зависимости между пакетами

```
@memo/domain              ← zero deps (только zod для схем)
    ↑
@memo/api-client          ← @memo/domain + zod
    ↑
apps/admin                ← @memo/domain + @memo/api-client + @dnd-kit
apps/web                  ← @memo/domain + @memo/api-client + framer-motion
apps/master               ← @memo/domain + @memo/api-client (future)
```

---

## TypeScript резолвинг

Каждое приложение имеет в `tsconfig.json`:

```json
"paths": {
  "@/*": ["./*"],
  "@memo/domain": ["../../packages/domain/src/index.ts"],
  "@memo/api-client": ["../../packages/api-client/src/index.ts"]
}
```

Это позволяет импортировать без билда packages:
```typescript
import { Activity, Artist } from '@memo/domain';
import { getActivities } from '@memo/api-client';
```

---

## Деплой

| App | URL | Vercel проект |
|-----|-----|---------------|
| admin | `admin.colourmountains.ru` или `/admin` | отдельный |
| web | `colourmountains.ru` | отдельный |
| master | `master.colourmountains.ru` | future |

---

## История изменений

- **2026-05-19**: Миграция из единого `frontend/` в Turborepo. Admin перенесён в `apps/admin/`. Созданы `packages/domain/` и `packages/api-client/`.
