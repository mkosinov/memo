# Admin Clients Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build admin page `/clients` — table of clients with server-side filtering, pagination, sorting, and master-detail modal for viewing/editing clients and their records.

**Architecture:** Backend extends existing `GET /clients` with stats aggregation + new PATCH endpoint. Frontend adds new page with ClientsContext, ClientsTable, ClientsFilters, and ClientCardModal following ActivityDetailsModal pattern.

**Tech Stack:** FastAPI, SQLAlchemy, SQLite, Next.js 14, TypeScript, Tailwind CSS, @tanstack/react-query

---

## File Structure

### Backend (modify existing)

| File | Change |
|------|--------|
| `backend/src/models/client.py` | Make `name`, `phone`, `channel` nullable |
| `backend/src/schemas/client.py` | Add `ClientPatch`, `ClientWithStats`, update `ClientBase` |
| `backend/src/services/client.py` | Add stats aggregation, PATCH support |
| `backend/src/api/v1/clients.py` | Add PATCH endpoint, extend GET with filters/pagination |
| `backend/alembic/versions/xxx_make_client_fields_nullable.py` | Migration |

### Frontend (create new)

| File | Responsibility |
|------|----------------|
| `frontend/admin/app/(main)/clients/page.tsx` | Page entry point |
| `frontend/admin/contexts/ClientsContext.tsx` | State management + API calls |
| `frontend/admin/app/(main)/clients/components/ClientsTable.tsx` | Table with columns |
| `frontend/admin/app/(main)/clients/components/ClientsFilters.tsx` | Filter panel |
| `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx` | Master-detail modal wrapper |
| `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx` | Client tab (editable fields) |
| `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` | Record tab (adapted from ClientTab) |

### API Client (modify existing)

| File | Change |
|------|--------|
| `frontend/admin/lib/api-client.ts` | Add `getClientsWithStats`, `patchClient` |

---

## Task 1: Migration — Make client fields nullable

**Files:** `backend/alembic/versions/`

- [ ] Generate migration: `cd backend && alembic revision --autogenerate -m "make client fields nullable"`
- [ ] Edit generated migration to ensure it runs correctly on SQLite:
  ```sql
  ALTER TABLE clients ALTER COLUMN name DROP NOT NULL;
  ALTER TABLE clients ALTER COLUMN phone DROP NOT NULL;
  ALTER TABLE clients ALTER COLUMN channel DROP NOT NULL;
  ```
- [ ] Run migration: `alembic upgrade head`
- [ ] Verify: `sqlite3 memo.db ".schema clients"` — confirm all three columns are nullable
- [ ] Commit: `git add backend/alembic/ && git commit -m "feat: make client name/phone/channel nullable"`

---

## Task 2: Backend — Update ORM model and schemas

**Files:** `backend/src/models/client.py`, `backend/src/schemas/client.py`

- [ ] Update ORM model (`backend/src/models/client.py`):
  ```python
  name: Mapped[str | None] = mapped_column(String(200), nullable=True)
  phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
  channel: Mapped[str | None] = mapped_column(String(50), nullable=True)
  ```
- [ ] Update Pydantic schemas (`backend/src/schemas/client.py`):
  ```python
  class ClientBase(BaseModel):
      name: str | None = None
      phone: str | None = None
      email: str | None = None
      channel: Channel | None = None

  class ClientPatch(BaseModel):
      name: str | None = None
      phone: str | None = None
      email: str | None = None
      channel: Channel | None = None

  class ClientWithStats(ClientResponse):
      visits_count: int = 0
      last_visit: str | None = None
      total_paid: int = 0
      missed_visits: int = 0
  ```
- [ ] Run existing tests to ensure no regression: `cd backend && pytest tests/test_api_clients.py -v`
- [ ] Commit: `git add backend/src/ && git commit -m "feat: update client schemas for nullable fields + stats"`

---

## Task 3: Backend — PATCH endpoint

**Files:** `backend/src/api/v1/clients.py`, `backend/src/services/client.py`

- [ ] Add PATCH endpoint to router (`backend/src/api/v1/clients.py`):
  ```python
  @router.patch("/{client_id}", response_model=ClientResponse)
  async def patch_client(
      client_id: str,
      data: ClientPatch,
      service: _ServiceDep,
      session: SessionDep,
  ) -> ClientResponse:
      """Partial-update a client by ID (PATCH)."""
      client = await service.patch(db_session=session, id=client_id, data=data)
      if not client:
          raise HTTPException(status_code=404, detail="Client not found")
      return client
  ```
- [ ] Add `patch` method to service (`backend/src/services/client.py`):
  ```python
  async def patch(self, db_session, id, data: ClientPatch):
      client = await self.get(db_session, id)
      if not client:
          return None
      update_data = data.model_dump(exclude_unset=True)
      for field, value in update_data.items():
          setattr(client, field, value)
      await db_session.commit()
      await db_session.refresh(client)
      return client
  ```
- [ ] Write test for PATCH (`backend/tests/test_api_clients.py`):
  ```python
  def test_patch_client(self, api_client, sample_client):
      response = api_client.patch(f"/api/v1/clients/{sample_client.id}", json={"name": "Updated"})
      assert response.status_code == 200
      assert response.json()["name"] == "Updated"
      assert response.json()["phone"] == sample_client.phone  # unchanged
  ```
- [ ] Run tests: `pytest tests/test_api_clients.py -v`
- [ ] Commit: `git add backend/ && git commit -m "feat: add PATCH /clients endpoint"`

---

## Task 4: Backend — Extended GET with stats aggregation

**Files:** `backend/src/api/v1/clients.py`, `backend/src/services/client.py`, `backend/src/schemas/client.py`

- [ ] Add `ClientListParams` query model (`backend/src/schemas/client.py`):
  ```python
  from pydantic import BaseModel, Field
  from datetime import date

  class ClientListParams(BaseModel):
      page: int = 1
      per_page: int = Field(default=20, le=100)
      search: str | None = None
      is_active: bool | None = None
      created_from: date | None = None
      created_to: date | None = None
      updated_from: date | None = None
      updated_to: date | None = None
      min_visits: int | None = None
      max_visits: int | None = None
      min_paid: int | None = None
      max_paid: int | None = None
      missed_from: int | None = None
      missed_to: int | None = None
      sort_by: str = "name"
      sort_order: str = "asc"
  ```
- [ ] Add `ClientListResponse` schema:
  ```python
  class ClientListResponse(BaseModel):
      items: list[ClientWithStats]
      total: int
      page: int
      per_page: int
  ```
- [ ] Add service method `list_with_stats` (`backend/src/services/client.py`):
  ```python
  async def list_with_stats(self, db_session, params: ClientListParams):
      # 1. Build stats subquery
      stats_subq = (
          select(
              Record.client_id,
              func.count(Visit.id).label("visits_count"),
              func.max(Visit.created_at).label("last_visit"),
              func.coalesce(func.sum(Payment.amount), 0).label("total_paid"),
              func.sum(case((Visit.status == "missed", 1), else_=0)).label("missed_visits"),
          )
          .join(Visit, Visit.record_id == Record.id)
          .outerjoin(Payment, Payment.record_id == Record.id)
          .where(Record.is_active == True)
          .group_by(Record.client_id)
          .subquery()
      )

      # 2. Main query with LEFT JOIN on stats
      query = (
          select(Client, stats_subq)
          .outerjoin(stats_subq, Client.id == stats_subq.c.client_id)
          .where(Client.is_active == True)
      )

      # 3. Apply filters (search, is_active, date ranges, visit ranges, paid ranges)
      # 4. Apply sorting
      # 5. Apply pagination
      # 6. Return ClientListResponse with items, total, page, per_page
  ```
- [ ] Add new endpoint (`backend/src/api/v1/clients.py`):
  ```python
  @router.get("", response_model=ClientListResponse)
  async def list_clients_with_stats(
      service: _ServiceDep,
      session: SessionDep,
      params: ClientListParams = Depends(),
  ) -> ClientListResponse:
      """Return paginated clients with stats."""
      return await service.list_with_stats(db_session=session, params=params)
  ```
- [ ] Write tests for filtering, pagination, sorting (`backend/tests/test_api_clients.py`)
- [ ] Run tests: `pytest tests/test_api_clients.py -v`
- [ ] Commit: `git add backend/ && git commit -m "feat: extend GET /clients with stats aggregation"`

---

## Task 5: Frontend — API Client additions

**Files:** `frontend/admin/lib/api-client.ts`

- [ ] Add `ClientWithStats` type:
  ```typescript
  export interface ClientWithStats extends ClientResponse {
      visits_count: number;
      last_visit: string | null;
      total_paid: number;
      missed_visits: number;
  }
  ```
- [ ] Add `ClientListResponse` type:
  ```typescript
  export interface ClientListResponse {
      items: ClientWithStats[];
      total: number;
      page: number;
      per_page: number;
  }
  ```
- [ ] Add `getClientsWithStats` function:
  ```typescript
  export async function getClientsWithStats(params: Record<string, string | number | boolean | undefined>): Promise<ClientListResponse> {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
              searchParams.append(key, String(value));
          }
      });
      const response = await fetch(`${API_BASE}/api/v1/clients?${searchParams}`);
      if (!response.ok) throw new Error('Failed to fetch clients');
      return response.json();
  }
  ```
- [ ] Add `patchClient` function:
  ```typescript
  export async function patchClient(id: string, data: Partial<ClientResponse>): Promise<ClientResponse> {
      const response = await fetch(`${API_BASE}/api/v1/clients/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to patch client');
      return response.json();
  }
  ```
- [ ] Commit: `git add frontend/admin/lib/ && git commit -m "feat: add API client functions for clients"`

---

## Task 6: Frontend — ClientsContext

**Files:** `frontend/admin/contexts/ClientsContext.tsx`

- [ ] Create context file with types:
  ```typescript
  'use client';
  import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { getClientsWithStats, createClient, updateClient, patchClient, deleteClient } from '@/lib/api-client';
  import type { ClientWithStats, ClientListResponse } from '@/lib/api-client';

  interface ClientFilters {
      search: string;
      is_active: boolean | null;
      created_from: string;
      created_to: string;
      updated_from: string;
      updated_to: string;
      min_visits: number | null;
      max_visits: number | null;
      min_paid: number | null;
      max_paid: number | null;
      missed_from: number | null;
      missed_to: number | null;
  }

  interface ClientsContextType {
      clients: ClientWithStats[];
      total: number;
      page: number;
      perPage: number;
      filters: ClientFilters;
      sortBy: string;
      sortOrder: 'asc' | 'desc';
      isLoading: boolean;
      error: string | null;
      setPage: (page: number) => void;
      setPerPage: (perPage: number) => void;
      setFilters: (filters: Partial<ClientFilters>) => void;
      setSort: (field: string, order: 'asc' | 'desc') => void;
      resetFilters: () => void;
      createClient: (data: any) => Promise<void>;
      updateClient: (id: string, data: any) => Promise<void>;
      patchClient: (id: string, data: any) => Promise<void>;
      deleteClient: (id: string) => Promise<void>;
  }
  ```
- [ ] Implement provider with react-query:
  ```typescript
  export function ClientsProvider({ children }: { children: React.ReactNode }) {
      const queryClient = useQueryClient();
      const [page, setPage] = useState(1);
      const [perPage, setPerPage] = useState(20);
      const [filters, setFiltersState] = useState<ClientFilters>({...});
      const [sortBy, setSortBy] = useState('name');
      const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

      const { data, isLoading, error } = useQuery({
          queryKey: ['clients', page, perPage, filters, sortBy, sortOrder],
          queryFn: () => getClientsWithStats({ page, perPage, ...filters, sort_by: sortBy, sort_order: sortOrder }),
      });

      const setFilters = useCallback((newFilters) => {
          setFiltersState(prev => ({ ...prev, ...newFilters }));
          setPage(1); // reset to page 1 on filter change
      }, []);

      const setSort = useCallback((field, order) => {
          setSortBy(field);
          setSortOrder(order);
      }, []);

      const resetFilters = useCallback(() => {
          setFiltersState(defaultFilters);
          setPage(1);
      }, []);

      // Mutations with cache invalidation
      const createMutation = useMutation({
          mutationFn: createClient,
          onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
      });

      // ... similar for update, patch, delete

      const value = useMemo(() => ({
          clients: data?.items || [],
          total: data?.total || 0,
          page, perPage, filters, sortBy, sortOrder,
          isLoading, error: error?.message || null,
          setPage, setPerPage, setFilters, setSort, resetFilters,
          createClient: createMutation.mutateAsync,
          updateClient: updateMutation.mutateAsync,
          patchClient: patchMutation.mutateAsync,
          deleteClient: deleteMutation.mutateAsync,
      }), [data, page, perPage, filters, sortBy, sortOrder, isLoading, error]);

      return <ClientsContext.Provider value={value}>{children}</ClientsContext.Provider>;
  }
  ```
- [ ] Add `useClients` hook
- [ ] Commit: `git add frontend/admin/contexts/ && git commit -m "feat: add ClientsContext"`

---

## Task 7: Frontend — ClientsTable

**Files:** `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`

- [ ] Create table component with columns:
  ```typescript
  'use client';
  import { useClients } from '@/contexts/ClientsContext';

  const COLUMNS = [
      { key: 'name', label: 'Имя', sortable: true },
      { key: 'phone', label: 'Телефон', sortable: true },
      { key: 'visits_count', label: 'Кол-во визитов', sortable: true },
      { key: 'last_visit', label: 'Последний визит', sortable: true },
      { key: 'total_paid', label: 'Сумма оплат', sortable: true },
  ];

  export function ClientsTable({ onClientClick }: { onClientClick: (client: ClientWithStats) => void }) {
      const { clients, isLoading, sortBy, sortOrder, setSort } = useClients();

      if (isLoading) return <Skeleton rows={10} />;
      if (clients.length === 0) return <EmptyState />;

      return (
          <table>
              <thead>
                  <tr>
                      {COLUMNS.map(col => (
                          <th key={col.key} onClick={() => col.sortable && setSort(col.key, sortOrder === 'asc' ? 'desc' : 'asc')}>
                              {col.label} {sortBy === col.key && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                      ))}
                  </tr>
              </thead>
              <tbody>
                  {clients.map(client => (
                      <tr key={client.id} onClick={() => onClientClick(client)} className="hover:bg-gray-50">
                          <td>{client.name ?? 'Дорогой гость'}</td>
                          <td>{client.phone ?? 'Не указан'}</td>
                          <td>{client.visits_count}</td>
                          <td>{client.last_visit ? new Date(client.last_visit).toLocaleDateString('ru-RU') : '—'}</td>
                          <td>{client.total_paid.toLocaleString('ru-RU')} ₽</td>
                      </tr>
                  ))}
              </tbody>
          </table>
      );
  }
  ```
- [ ] Implement loading skeleton
- [ ] Implement empty state
- [ ] Add delete icon on hover
- [ ] Commit: `git add frontend/admin/app/ && git commit -m "feat: add ClientsTable"`

---

## Task 8: Frontend — ClientsFilters

**Files:** `frontend/admin/app/(main)/clients/components/ClientsFilters.tsx`

- [ ] Create filter panel component:
  ```typescript
  'use client';
  import { useClients } from '@/contexts/ClientsContext';
  import { useDebouncedCallback } from 'use-debounce';

  export function ClientsFilters() {
      const { filters, setFilters, resetFilters } = useClients();
      const debouncedSearch = useDebouncedCallback((value) => {
          setFilters({ search: value });
      }, 300);

      return (
          <div className="space-y-3">
              <input
                  type="text"
                  placeholder="Поиск по имени или телефону"
                  onChange={(e) => debouncedSearch(e.target.value)}
              />
              <div className="flex gap-4">
                  <select onChange={(e) => setFilters({ is_active: e.target.value === '' ? null : e.target.value === 'true' })}>
                      <option value="">Все</option>
                      <option value="true">Активные</option>
                      <option value="false">Неактивные</option>
                  </select>
                  {/* Number inputs for visits, missed, paid */}
                  {/* Date inputs for created, updated */}
              </div>
              <button onClick={resetFilters}>Сбросить фильтры</button>
          </div>
      );
  }
  ```
- [ ] Implement all filter controls
- [ ] Add debounce for search
- [ ] Commit: `git add frontend/admin/app/ && git commit -m "feat: add ClientsFilters"`

---

## Task 9: Frontend — ClientInfoTab

**Files:** `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx`

- [ ] Create client tab with grouped editable fields:
  ```typescript
  'use client';
  import { useState, useEffect, useCallback } from 'react';
  import type { ClientWithStats } from '@/lib/api-client';

  interface ClientInfoTabProps {
      client: ClientWithStats;
      onSave: (data: Partial<ClientWithStats>) => Promise<void>;
      onDelete: () => void;
  }

  export function ClientInfoTab({ client, onSave, onDelete }: ClientInfoTabProps) {
      const [name, setName] = useState(client.name || '');
      const [phone, setPhone] = useState(client.phone || '');
      const [email, setEmail] = useState(client.email || '');
      const [channel, setChannel] = useState(client.channel || '');
      const [hasChanges, setHasChanges] = useState(false);

      useEffect(() => {
          setName(client.name || '');
          setPhone(client.phone || '');
          setEmail(client.email || '');
          setChannel(client.channel || '');
          setHasChanges(false);
      }, [client]);

      const handleChange = useCallback(() => {
          setHasChanges(true);
      }, []);

      const handleSave = useCallback(async () => {
          await onSave({ name, phone, email, channel });
          setHasChanges(false);
      }, [name, phone, email, channel, onSave]);

      return (
          <div className="space-y-4 p-4">
              {/* Contact data group */}
              <div className="grid grid-cols-3 gap-4">
                  <label>Имя <input value={name} onChange={e => { setName(e.target.value); handleChange(); }} /></label>
                  <label>Телефон <input value={phone} onChange={e => { setPhone(e.target.value); handleChange(); }} /></label>
                  <label>Канал <select value={channel} onChange={e => { setChannel(e.target.value); handleChange(); }}>...</select></label>
                  <label>Email <input value={email} onChange={e => { setEmail(e.target.value); handleChange(); }} /></label>
              </div>

              {/* Metrics group (read-only) */}
              <div className="grid grid-cols-4 gap-2">
                  <div>Визитов: {client.visits_count}</div>
                  <div>Пропущено: {client.missed_visits}</div>
                  <div>Последний: {client.last_visit ?? '—'}</div>
                  <div>Оплачено: {client.total_paid.toLocaleString()} ₽</div>
              </div>

              {/* Save/Cancel buttons */}
              <div className="flex gap-2">
                  <button disabled={!hasChanges} onClick={handleSave}>Сохранить</button>
                  <button onClick={() => {/* reset */}}>Отмена</button>
                  <button onClick={onDelete} className="text-red-500">Удалить клиента</button>
              </div>
          </div>
      );
  }
  ```
- [ ] Implement grouped layout per design
- [ ] Implement save button state (disabled/enabled)
- [ ] Commit: `git add frontend/admin/app/ && git commit -m "feat: add ClientInfoTab"`

---

## Task 10: Frontend — ClientRecordTab

**Files:** `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`

- [ ] Adapt from existing `ClientTab` in ActivityDetailsModal
- [ ] Update to work with `useClients` context
- [ ] Implement grouped layout per design (Мероприятие, Посетители, Оплата, Комментарий)
- [ ] Add delete record functionality
- [ ] Commit: `git add frontend/admin/app/ && git commit -m "feat: add ClientRecordTab"`

---

## Task 11: Frontend — ClientCardModal

**Files:** `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx`

- [ ] Create master-detail modal wrapper:
  ```typescript
  'use client';
  import { useState, useEffect } from 'react';
  import { useClients } from '@/contexts/ClientsContext';
  import { ClientInfoTab } from './ClientInfoTab';
  import { ClientRecordTab } from './ClientRecordTab';
  import type { ClientWithStats } from '@/lib/api-client';

  interface ClientCardModalProps {
      client: ClientWithStats | null;
      isOpen: boolean;
      onClose: () => void;
      mode: 'view' | 'create';
  }

  export function ClientCardModal({ client, isOpen, onClose, mode }: ClientCardModalProps) {
      const [activeTab, setActiveTab] = useState('client');
      const { updateClient, deleteClient } = useClients();

      if (!isOpen) return null;

      return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/30" onClick={onClose} />
              <div className="relative bg-white rounded-xl w-full max-w-2xl flex" style={{ maxHeight: '85vh' }}>
                  {/* Left panel */}
                  <div className="w-44 border-r" style={{ borderColor: 'var(--line)' }}>
                      <div className="p-3 border-b">
                          <div className="font-medium">{client?.name ?? 'Дорогой гость'}</div>
                          <div className="text-sm text-gray-500">{client?.phone ?? 'Не указан'}</div>
                      </div>
                      <div className="p-2">
                          {client?.records?.map(record => (
                              <button
                                  key={record.id}
                                  className={`w-full text-left px-3 py-2 rounded ${activeTab === `record-${record.id}` ? 'bg-brand text-white' : ''}`}
                                  onClick={() => setActiveTab(`record-${record.id}`)}
                              >
                                  {new Date(record.date).toLocaleDateString('ru-RU')} {record.time}
                              </button>
                          ))}
                      </div>
                  </div>

                  {/* Right panel */}
                  <div className="flex-1 overflow-y-auto">
                      {activeTab === 'client' ? (
                          <ClientInfoTab
                              client={client!}
                              onSave={(data) => updateClient(client!.id, data)}
                              onDelete={() => { deleteClient(client!.id); onClose(); }}
                          />
                      ) : (
                          <ClientRecordTab recordId={activeTab.replace('record-', '')} />
                      )}
                  </div>
              </div>
          </div>
      );
  }
  ```
- [ ] Implement left panel with client header + record list
- [ ] Implement tab switching
- [ ] Implement create mode
- [ ] Commit: `git add frontend/admin/app/ && git commit -m "feat: add ClientCardModal"`

---

## Task 12: Frontend — Clients page

**Files:** `frontend/admin/app/(main)/clients/page.tsx`

- [ ] Create page entry point:
  ```typescript
  'use client';
  import { useState } from 'react';
  import { ClientsProvider, useClients } from '@/contexts/ClientsContext';
  import { ClientsTable } from './components/ClientsTable';
  import { ClientsFilters } from './components/ClientsFilters';
  import { ClientCardModal } from './components/ClientCardModal';
  import type { ClientWithStats } from '@/lib/api-client';

  function ClientsPageContent() {
      const [selectedClient, setSelectedClient] = useState<ClientWithStats | null>(null);
      const [isCreateMode, setIsCreateMode] = useState(false);
      const { total, page, perPage, setPage, setPerPage } = useClients();

      return (
          <div className="p-4 space-y-4">
              <ClientsFilters />
              <ClientsTable onClientClick={setSelectedClient} />

              {/* Pagination */}
              <div className="flex justify-between items-center">
                  <span>{total} клиентов</span>
                  <div className="flex gap-2">
                      <button disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
                      <span>Стр. {page}</span>
                      <button disabled={page * perPage >= total} onClick={() => setPage(page + 1)}>→</button>
                  </div>
              </div>

              {/* Create button */}
              <button onClick={() => setIsCreateMode(true)}>+ Новый клиент</button>

              {/* Modal */}
              <ClientCardModal
                  client={selectedClient}
                  isOpen={!!selectedClient || isCreateMode}
                  onClose={() => { setSelectedClient(null); setIsCreateMode(false); }}
                  mode={isCreateMode ? 'create' : 'view'}
              />
          </div>
      );
  }

  export default function ClientsPage() {
      return (
          <ClientsProvider>
              <ClientsPageContent />
          </ClientsProvider>
      );
  }
  ```
- [ ] Wrap with ClientsProvider
- [ ] Add "Новый клиент" button
- [ ] Add pagination controls
- [ ] Commit: `git add frontend/admin/app/ && git commit -m "feat: add Clients page"`

---

## Task 13: Backend — Tests

**Files:** `backend/tests/test_api_clients.py`

- [ ] Write tests for PATCH endpoint
- [ ] Write tests for extended GET with filters
- [ ] Write tests for pagination
- [ ] Write tests for sorting
- [ ] Write tests for stats aggregation
- [ ] Run full test suite: `pytest tests/test_api_clients.py -v`
- [ ] Commit: `git add backend/tests/ && git commit -m "test: add tests for clients API"`

---

## Task 14: Frontend — Component tests

**Files:** `frontend/admin/__tests__/clients/`

- [ ] Test ClientsTable renders rows
- [ ] Test ClientsFilters applies filters
- [ ] Test ClientCardModal opens/closes
- [ ] Test ClientInfoTab save button state
- [ ] Run tests: `cd frontend/admin && npm run test`
- [ ] Commit: `git add frontend/admin/__tests__/ && git commit -m "test: add component tests for clients"`

---

## Task 15: E2E test

**Files:** `frontend/admin/e2e/clients.spec.ts`

- [ ] Write E2E test for full cycle:
  - Create client
  - View client in table
  - Open client card
  - Edit client
  - Delete client
- [ ] Run E2E tests: `cd frontend/admin && npx playwright test clients`
- [ ] Commit: `git add frontend/admin/e2e/ && git commit -m "test: add E2E test for clients"`

---

## Task 16: Final verification

- [ ] Run all backend tests: `cd backend && pytest`
- [ ] Run all frontend tests: `cd frontend/admin && npm run test:all`
- [ ] Start dev server: `./dev.sh --admin`
- [ ] Verify page loads at http://localhost:3101/clients
- [ ] Test create → view → edit → delete cycle manually
- [ ] Verify visual compliance against design spec
- [ ] Update scratchpad with completion status
