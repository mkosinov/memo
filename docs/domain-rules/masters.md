# Masters — Domain Rules

## Naming Convention (CRITICAL)

**В коде используем ТОЛЬКО слово "Master" (Мастер).**

- ❌ Artist — НЕ ИСПОЛЬЗОВАТЬ
- ❌ artistId, artistName — НЕ ИСПОЛЬЗОВАТЬ
- ✅ Master, masterId, masterName

Это правило распространяется на:
- Backend: модели, схемы, API эндпоинты
- Frontend: компоненты, хуки, типы, переменные
- Domain package: типы и схемы

## Description
Мастера — сотрудники студии, которые проводят мастер-классы. Каждый мастер имеет специализацию и цвет для отображения в расписании.

## Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (UUID) | ✅ | Unique identifier |
| first_name | string(100) | ✅ | Имя |
| last_name | string(100) | ✅ | Фамилия |
| color | string(7) | ✅ | HEX color for schedule (e.g. #FF5733) |
| position | enum | ✅ | "мастер" or "администратор" |
| specialty | enum | ✅ | "живопись" or "керамика" |
| avatar_url | string | ❌ | URL to avatar image |

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/masters | List all active masters |
| GET | /api/v1/masters/{id} | Get master by ID |
| POST | /api/v1/masters | Create master |
| PUT | /api/v1/masters/{id} | Update master |
| PATCH | /api/v1/masters/{id} | Partial update |
| DELETE | /api/v1/masters/{id} | Soft-delete master |

## Relationships
- Master → has many Activities
- Master → has many Tags (M2M via master_tags)
