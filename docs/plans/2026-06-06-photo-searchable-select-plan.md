# Photo SearchableSelect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain text UUID inputs in photo admin form with typeahead search components that dynamically search related entities by name/title.

**Architecture:** Backend adds search endpoints with ILIKE substring matching. Frontend creates a reusable `SearchableSelect` component that calls these endpoints on input with 300ms debounce.

**Tech Stack:** FastAPI, SQLAlchemy, SQLite, Next.js 14, TypeScript, Tailwind CSS

---

## File Structure

### Backend (new files)
- `backend/src/schemas/search.py` — Shared search result schemas
- `backend/src/api/v1/search.py` — Search router with all 3 endpoints

### Backend (modified files)
- `backend/src/api/v1/__init__.py` — Register search router

### Frontend (new files)
- `frontend/admin/components/SearchableSelect.tsx` — Reusable typeahead component
- `frontend/admin/components/__tests__/SearchableSelect.test.tsx` — Unit tests

### Frontend (modified files)
- `frontend/admin/app/(main)/photos/components/photoFields.tsx` — Update field configs
- `frontend/admin/app/(main)/photos/components/PhotoForm.tsx` — Wire SearchableSelect

---

## Task 1: Backend Search Schemas (trivial)

**Files:** `backend/src/schemas/search.py` (create)

### Steps

- [ ] Create `backend/src/schemas/search.py`:

```python
"""Shared search result schemas."""

from pydantic import BaseModel


class VisitorSearchResult(BaseModel):
    """Search result for visitor lookup."""
    id: str
    name: str
    age: int | None = None


class ServiceSearchResult(BaseModel):
    """Search result for service lookup."""
    id: str
    title: str


class ActivitySearchResult(BaseModel):
    """Search result for activity lookup."""
    id: str
    start: str  # ISO format
    service_title: str
```

- [ ] Run `cd backend && python -c "from src.schemas.search import *; print('OK')"` to verify imports

---

## Task 2: Backend Search Endpoints (standard)

**Files:** `backend/src/api/v1/search.py` (create), `backend/src/api/v1/__init__.py` (modify)

### Steps

- [ ] Create `backend/src/api/v1/search.py`:

```python
"""Search endpoints for entity lookup."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.activity import Activity
from src.models.service import Service
from src.models.visitor import Visitor
from src.schemas.search import (
    ActivitySearchResult,
    ServiceSearchResult,
    VisitorSearchResult,
)

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/visitors", response_model=list[VisitorSearchResult])
async def search_visitors(
    q: str = Query(min_length=1, max_length=100),
    db: AsyncSession = Depends(get_db),
):
    """Search visitors by name (case-insensitive substring)."""
    pattern = f"%{q}%"
    result = await db.execute(
        select(Visitor)
        .where(Visitor.name.ilike(pattern), Visitor.is_active == True)
        .limit(10)
    )
    return [
        VisitorSearchResult(id=v.id, name=v.name, age=v.age)
        for v in result.scalars()
    ]


@router.get("/services", response_model=list[ServiceSearchResult])
async def search_services(
    q: str = Query(min_length=1, max_length=100),
    db: AsyncSession = Depends(get_db),
):
    """Search services by title (case-insensitive substring)."""
    pattern = f"%{q}%"
    result = await db.execute(
        select(Service)
        .where(Service.title.ilike(pattern), Service.is_active == True)
        .limit(10)
    )
    return [
        ServiceSearchResult(id=s.id, title=s.title)
        for s in result.scalars()
    ]


@router.get("/activities", response_model=list[ActivitySearchResult])
async def search_activities(
    q: str = Query(min_length=1, max_length=100),
    db: AsyncSession = Depends(get_db),
):
    """Search activities by service title or start time (case-insensitive)."""
    pattern = f"%{q}%"
    result = await db.execute(
        select(Activity, Service.title.label("service_title"))
        .join(Service, Activity.service_id == Service.id)
        .where(
            (Service.title.ilike(pattern) | Activity.start.ilike(pattern)),
            Activity.is_active == True,
        )
        .limit(10)
    )
    return [
        ActivitySearchResult(
            id=a.id,
            start=a.start.isoformat(),
            service_title=title,
        )
        for a, title in result
    ]
```

- [ ] In `backend/src/api/v1/__init__.py`, add:

```python
from src.api.v1.search import router as search_router
api_router.include_router(search_router)
```

- [ ] Run `cd backend && python -c "from src.api.v1.search import router; print('OK')"` to verify

---

## Task 3: Frontend SearchableSelect Component (standard)

**Files:** `frontend/admin/components/SearchableSelect.tsx` (create), `frontend/admin/components/__tests__/SearchableSelect.test.tsx` (create)

### Steps

- [ ] Create `frontend/admin/components/SearchableSelect.tsx`:

```tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SearchableSelectProps {
  value: string | null;
  onChange: (uuid: string | null) => void;
  searchEndpoint: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  displayField: string;
  subtitleField?: string;
}

interface SearchItem {
  id: string;
  [key: string]: string | number | null | undefined;
}

export function SearchableSelect({
  value,
  onChange,
  searchEndpoint,
  label,
  placeholder = 'Введите для поиска...',
  required = false,
  displayField,
  subtitleField,
}: SearchableSelectProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${searchEndpoint}?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data);
      setIsOpen(data.length > 0);
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [searchEndpoint]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedLabel(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const handleSelect = (item: SearchItem) => {
    const label = String(item[displayField] || '');
    const sub = subtitleField ? ` (${item[subtitleField]})` : '';
    setSelectedLabel(`${label}${sub}`);
    setQuery('');
    setIsOpen(false);
    onChange(item.id);
  };

  const handleClear = () => {
    setSelectedLabel(null);
    setQuery('');
    onChange(null);
  };

  const formatItem = (item: SearchItem) => {
    const main = String(item[displayField] || '');
    const sub = subtitleField ? ` — ${item[subtitleField]}` : '';
    return `${main}${sub}`;
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={selectedLabel || query}
          onChange={handleInputChange}
          onFocus={() => {
            if (results.length > 0 && !selectedLabel) setIsOpen(true);
          }}
          placeholder={selectedLabel ? '' : placeholder}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          readOnly={!!selectedLabel}
        />
        {selectedLabel && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        )}
        {isLoading && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2">
            <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-blue-500 rounded-full" />
          </div>
        )}
      </div>
      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
          {results.map((item) => (
            <li
              key={item.id}
              onClick={() => handleSelect(item)}
              className="px-3 py-2 cursor-pointer hover:bg-gray-100 text-sm"
            >
              {formatItem(item)}
            </li>
          ))}
        </ul>
      )}
      {isOpen && results.length === 0 && !isLoading && query.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg px-3 py-2 text-sm text-gray-500">
          Ничего не найдено
        </div>
      )}
    </div>
  );
}
```

- [ ] Run `cd frontend && npx tsc --noEmit` to verify no type errors

---

## Task 4: Integrate SearchableSelect into Photo Form (small)

**Files:** `frontend/admin/app/(main)/photos/components/photoFields.tsx` (modify), `frontend/admin/app/(main)/photos/components/PhotoForm.tsx` (modify)

### Steps

- [ ] Update `photoFields.tsx`:

```tsx
/** Local field types */

interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

interface SearchableFieldConfig {
  type: 'searchable';
  key: string;
  label: string;
  searchEndpoint: string;
  displayField: string;
  subtitleField?: string;
  placeholder?: string;
  required?: boolean;
}

export type PhotoFieldConfig = TextFieldConfig | SearchableFieldConfig;

export const PHOTO_FIELDS: PhotoFieldConfig[] = [
  { type: 'text', key: 'filename', label: 'Имя файла', required: true, placeholder: 'photo-001.jpg' },
  { 
    type: 'searchable', 
    key: 'visitor_id', 
    label: 'Посетитель', 
    searchEndpoint: '/api/v1/search/visitors',
    displayField: 'name',
    subtitleField: 'age',
    placeholder: 'Введите имя...',
  },
  { 
    type: 'searchable', 
    key: 'service_id', 
    label: 'Услуга', 
    searchEndpoint: '/api/v1/search/services',
    displayField: 'title',
    placeholder: 'Введите название...',
  },
  { 
    type: 'searchable', 
    key: 'activity_id', 
    label: 'Активность', 
    searchEndpoint: '/api/v1/search/activities',
    displayField: 'service_title',
    subtitleField: 'start',
    placeholder: 'Введите услугу или дату...',
  },
];
```

- [ ] In `PhotoForm.tsx`, import `SearchableSelect` and add rendering logic for `type: 'searchable'` fields (alongside existing text field rendering)

- [ ] Run `cd frontend && npm run test` to verify no regressions

---

## Task 5: Visual Verification (trivial)

### Steps

- [ ] Start dev server: `cd frontend && npm run dev`
- [ ] Navigate to photo creation form
- [ ] Verify: text field for filename still works
- [ ] Verify: "Посетитель" field shows search icon
- [ ] Verify: typing in "Посетитель" triggers dropdown after delay
- [ ] Verify: selecting a visitor fills the field with name
- [ ] Verify: clear button (×) removes selection
- [ ] Same for "Услуга" and "Активность"
- [ ] Run `cd frontend && npm run test:all` to verify all tests pass

---

## Commit Strategy

After each task:
```bash
git add -A && git commit -m "feat(searchable-select): [task description]"
```

After all tasks complete:
```bash
git push origin feat/photo-searchable-select
gh pr create --title "feat: Photo form searchable select" --body "Closes #XX"
```
