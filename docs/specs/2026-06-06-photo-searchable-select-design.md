# Photo SearchableSelect Design

## Problem

Photo admin form (`photoFields.tsx`) has plain text inputs for UUID FK fields (`visitor_id`, `service_id`, `activity_id`). Users must manually type UUIDs, which is error-prone and unusable.

## Solution

Replace text inputs with `SearchableSelect` — typeahead component with dynamic search.

## Backend: Search Endpoints

Add 3 search endpoints. All use `ILIKE '%query%'` for case-insensitive substring matching.

### `GET /api/v1/visitors/search?q={query}`

**Response:**
```json
[
  { "id": "uuid", "name": "Иван Петров", "age": 25 }
]
```

**SQL:** `SELECT id, name, age FROM visitors WHERE name ILIKE '%query%' AND is_active = true LIMIT 10`

### `GET /api/v1/services/search?q={query}`

**Response:**
```json
[
  { "id": "uuid", "title": "Мастер-класс по керамике" }
]
```

**SQL:** `SELECT id, title FROM services WHERE title ILIKE '%query%' AND is_active = true LIMIT 10`

### `GET /api/v1/activities/search?q={query}`

**Response:**
```json
[
  { "id": "uuid", "start": "2026-06-15T14:00:00", "service_title": "Керамика" }
]
```

**SQL:** 
```sql
SELECT a.id, a.start, s.title as service_title 
FROM activities a 
JOIN services s ON a.service_id = s.id 
WHERE (s.title ILIKE '%query%' OR datetime(a.start) ILIKE '%query%') 
AND a.is_active = true 
LIMIT 10
```

### Common rules
- All endpoints require admin auth
- `LIMIT 10` — max results per search
- Empty `q` → return empty array
- Only active records (`is_active = true`)

## Frontend: SearchableSelect Component

### Props
```typescript
interface SearchableSelectProps {
  value: string | null;           // UUID
  onChange: (uuid: string | null) => void;
  searchEndpoint: string;         // e.g. '/api/v1/visitors/search'
  label: string;                  // Field label
  placeholder?: string;
  required?: boolean;
  displayField: string;           // Which field to show in dropdown (e.g. 'name')
  subtitleField?: string;         // Optional second field (e.g. 'age')
}
```

### Behavior
1. **Initial state:** Shows selected value (displayField) or placeholder
2. **On focus:** If has value, show it selected. If empty, show nothing.
3. **On type (debounce 300ms):** 
   - Call `{searchEndpoint}?q={input}`
   - Show dropdown with results
4. **Dropdown items:** Show `displayField` + optional `subtitleField`
5. **On select:** Set UUID value, close dropdown, show displayField in input
6. **Clear button (×):** Sets value to null
7. **Empty results:** Show "Ничего не найдено"

### Integration in photoFields.tsx

Replace:
```tsx
{ type: 'text', key: 'visitor_id', label: 'Visitor ID', placeholder: 'UUID посетителя' }
```

With:
```tsx
{ 
  type: 'searchable', 
  key: 'visitor_id', 
  label: 'Посетитель', 
  searchEndpoint: '/api/v1/visitors/search',
  displayField: 'name',
  subtitleField: 'age',
  placeholder: 'Введите имя...'
}
```

## Files to Change

| File | Change |
|------|--------|
| `backend/src/api/v1/visitors.py` | Add `GET /search` endpoint |
| `backend/src/api/v1/services.py` | Add `GET /search` endpoint |
| `backend/src/api/v1/activities.py` | Add `GET /search` endpoint |
| `backend/src/schemas/visitor.py` | Add `VisitorSearchResult` schema |
| `backend/src/schemas/service.py` | Add `ServiceSearchResult` schema |
| `backend/src/schemas/activity.py` | Add `ActivitySearchResult` schema |
| `frontend/admin/components/SearchableSelect.tsx` | New component |
| `frontend/admin/app/(main)/photos/components/photoFields.tsx` | Update field configs |
| `frontend/admin/app/(main)/photos/components/` | Wire SearchableSelect into form |

## Visual Compliance Checks

- [ ] Photo form shows "Посетитель" field with search icon
- [ ] Typing in "Посетитель" field triggers dropdown after 300ms
- [ ] Dropdown shows visitor names (not UUIDs)
- [ ] Selecting a visitor fills the field with the name
- [ ] Clear button (×) removes the selected value
- [ ] Same behavior for "Услуга" and "Активность" fields
