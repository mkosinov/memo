import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientInfoTab } from '../app/(main)/clients/components/ClientInfoTab';
import type { ClientInfoTabHandle } from '../app/(main)/clients/components/ClientInfoTab';
import { mockClientWithStats, mockVisitor } from './helpers/mockData';
import type { ClientWithStats, VisitorResponse } from '@memo/api-client';

// Mock API calls
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getClientVisitors: vi.fn(),
    createVisitor: vi.fn(),
    deleteVisitor: vi.fn(),
    dryRunDeleteVisitor: vi.fn(),
    resolveDeleteVisitor: vi.fn(),
  };
});

import {
  getClientVisitors,
  createVisitor,
  deleteVisitor,
  dryRunDeleteVisitor,
  resolveDeleteVisitor,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode } from '@memo/api-client';

// #324 Task 8: the conveyor pieces — the hook's enqueue is controlled here
// (same pattern as ClientRecordTab.api.test.tsx); the hook's toast shower
// is a plain vi.fn (useUI mock — the component itself never showed toasts).
const mockEnqueuePendingAction = vi.fn();
vi.mock('@/contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));

// Global ref holder for tests that need to call save()/cancel()
let testRefHandle: ClientInfoTabHandle | null = null;

function RefCapture({ children }: { children: (ref: React.Ref<ClientInfoTabHandle>) => React.ReactNode }) {
  const ref = React.useCallback((instance: ClientInfoTabHandle | null) => {
    testRefHandle = instance;
  }, []) as React.Ref<ClientInfoTabHandle>;
  return <>{children(ref)}</> as React.ReactElement;
}

type RenderResult = ReturnType<typeof render>;

/** #324 Task 8: the conveyor hook consumes useQueryClient — every render
 *  wraps in a fresh QueryClientProvider (retry:false keeps errors fast). */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function renderClientInfoTab(overrides?: {
  client?: ClientWithStats;
  onSave?: (data: Partial<ClientWithStats>) => Promise<void>;
  onHasChanges?: (hasChanges: boolean) => void;
}): RenderResult {
  const client = overrides?.client ?? mockClientWithStats;
  const onSave = overrides?.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onHasChanges = overrides?.onHasChanges;
  return render(
    <ClientInfoTab client={client} onSave={onSave} onHasChanges={onHasChanges} />,
    { wrapper: createWrapper() },
  );
}

/** Like renderClientInfoTab but exposes a ref for calling save()/cancel() */
function renderClientInfoTabWithRef(overrides?: {
  client?: ClientWithStats;
  onSave?: (data: Partial<ClientWithStats>) => Promise<void>;
  onHasChanges?: (hasChanges: boolean) => void;
}) {
  const client = overrides?.client ?? mockClientWithStats;
  const onSave = overrides?.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onHasChanges = overrides?.onHasChanges;
  render(
    <RefCapture>
      {(ref) => (
        <ClientInfoTab client={client} onSave={onSave} onHasChanges={onHasChanges} ref={ref} />
      )}
    </RefCapture>,
    { wrapper: createWrapper() },
  );
  return { client, onSave, getRef: () => testRefHandle };
}

describe('ClientInfoTab', () => {
  beforeEach(() => {
    vi.mocked(getClientVisitors).mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());
  it('renders client name in input', () => {
    renderClientInfoTab();
    const input = screen.getByLabelText('Имя') as HTMLInputElement;
    expect(input.value).toBe('Анна Иванова');
  });

  it('renders phone in input', () => {
    renderClientInfoTab();
    const input = screen.getByLabelText('Телефон') as HTMLInputElement;
    // GH #414: the stored «+7 (900) 123-45-67» initializes the widget on RU
    // with the national remainder, grouped as-you-type for display.
    expect(input.value).toBe('900 123-45-67');
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
  });

  it('renders email in input', () => {
    renderClientInfoTab();
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('renders channel selector with correct value', () => {
    renderClientInfoTab();
    const select = screen.getByLabelText('Канал') as HTMLSelectElement;
    expect(select.value).toBe('telegram');
  });

  it('shows metrics: records, missed, last record, total paid', () => {
    renderClientInfoTab();
    expect(screen.getByText('Записей')).toBeInTheDocument();
    expect(screen.getByText('Пропущено')).toBeInTheDocument();
    expect(screen.getByText('Последняя')).toBeInTheDocument();
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows formatted total paid with currency', () => {
    renderClientInfoTab();
    expect(screen.getByText(/17 500/)).toBeInTheDocument();
  });

  it('shows created and updated dates', () => {
    renderClientInfoTab();
    expect(screen.getByText(/Создан/)).toBeInTheDocument();
    expect(screen.getByText(/Обновлён/)).toBeInTheDocument();
  });

  it('save button is disabled when no changes', () => {
    const onHasChanges = vi.fn();
    renderClientInfoTab({ onHasChanges });
    // ClientInfoTab no longer renders save button (moved to ClientCardModal footer)
    // Instead it notifies parent via onHasChanges callback
    expect(onHasChanges).toHaveBeenCalledWith(false);
  });

  it('enables save when name changes (onHasChanges fires)', () => {
    const onHasChanges = vi.fn();
    renderClientInfoTab({ onHasChanges });
    onHasChanges.mockClear();
    const input = screen.getByLabelText('Имя');
    fireEvent.change(input, { target: { value: 'Новое Имя' } });
    expect(onHasChanges).toHaveBeenCalledWith(true);
  });

  it('calls onSave with updated data via ref.save()', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getRef } = renderClientInfoTabWithRef({ onSave });
    const input = screen.getByLabelText('Имя');
    fireEvent.change(input, { target: { value: 'Новое Имя' } });
    // Save is triggered via ref by the parent ClientCardModal
    await getRef()!.save();
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: 'Новое Имя',
        phone: '+7 (900) 123-45-67',
        email: null,
        channel: 'telegram',
      });
    });
  });

  it('does not render save/delete buttons (moved to parent modal)', () => {
    renderClientInfoTab();
    // Save and delete buttons are now in ClientCardModal footer, not in ClientInfoTab
    expect(screen.queryByRole('button', { name: /Сохранить/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Удалить клиента/i })).not.toBeInTheDocument();
  });

  it('resets form when client prop changes', () => {
    const { rerender } = renderClientInfoTab();
    const newClient = { ...mockClientWithStats, name: 'Другой Клиент' };
    rerender(
      <ClientInfoTab
        client={newClient}
        onSave={vi.fn()}
      />
    );
    const input = screen.getByLabelText('Имя') as HTMLInputElement;
    expect(input.value).toBe('Другой Клиент');
  });

  it('displays last visit date in Russian locale', () => {
    renderClientInfoTab();
    expect(screen.getByText(/15\.05\.2026/)).toBeInTheDocument();
  });

  // ─── Save button state edge cases ───────────────────────────────────────

  describe('save button state', () => {
    it('onHasChanges resets after ref.save() completes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onHasChanges = vi.fn();
      const { getRef } = renderClientInfoTabWithRef({ onSave, onHasChanges });
      onHasChanges.mockClear();

      // Change name to trigger hasChanges
      const input = screen.getByLabelText('Имя');
      fireEvent.change(input, { target: { value: 'Новое Имя' } });
      expect(onHasChanges).toHaveBeenCalledWith(true);
      onHasChanges.mockClear();

      // Save via ref (simulating parent modal clicking save)
      await getRef()!.save();

      // After save, hasChanges resets
      await waitFor(() => {
        expect(onHasChanges).toHaveBeenCalledWith(false);
      });
    });

    it('onHasChanges fires when phone is changed', () => {
      const onHasChanges = vi.fn();
      renderClientInfoTab({ onHasChanges });
      onHasChanges.mockClear();

      const phoneInput = screen.getByLabelText('Телефон');
      fireEvent.change(phoneInput, { target: { value: '9991112233' } });
      expect(onHasChanges).toHaveBeenCalledWith(true);
    });

    it('onHasChanges fires when email is changed', () => {
      const onHasChanges = vi.fn();
      renderClientInfoTab({ onHasChanges });
      onHasChanges.mockClear();

      const emailInput = screen.getByLabelText('Email');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      expect(onHasChanges).toHaveBeenCalledWith(true);
    });

    it('onHasChanges fires when channel is changed', () => {
      const onHasChanges = vi.fn();
      renderClientInfoTab({ onHasChanges });
      onHasChanges.mockClear();

      const channelSelect = screen.getByLabelText('Канал');
      fireEvent.change(channelSelect, { target: { value: 'whatsapp' } });
      expect(onHasChanges).toHaveBeenCalledWith(true);
    });

    it('onHasChanges stays true after multiple changes', () => {
      const onHasChanges = vi.fn();
      renderClientInfoTab({ onHasChanges });
      onHasChanges.mockClear();

      fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'A' } });
      expect(onHasChanges).toHaveBeenCalledWith(true);

      // Subsequent changes don't re-fire onHasChanges since hasChanges is already true
      // (React effect won't re-run when the value hasn't changed)
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '9990000000' } });
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
      // hasChanges remains true throughout
      expect(onHasChanges).toHaveBeenLastCalledWith(true);
    });

    it('onHasChanges resets after save then new change re-enables', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onHasChanges = vi.fn();
      const { getRef } = renderClientInfoTabWithRef({ onSave, onHasChanges });
      onHasChanges.mockClear();

      const input = screen.getByLabelText('Имя');
      fireEvent.change(input, { target: { value: 'New' } });
      expect(onHasChanges).toHaveBeenCalledWith(true);

      await getRef()!.save();

      await waitFor(() => {
        expect(onHasChanges).toHaveBeenCalledWith(false);
      });
      onHasChanges.mockClear();

      // Making a new change should re-enable
      fireEvent.change(input, { target: { value: 'New Again' } });
      expect(onHasChanges).toHaveBeenCalledWith(true);
    });

    it('delete button is not in ClientInfoTab (parent modal owns it)', () => {
      renderClientInfoTab();
      // Delete button lives in ClientCardModal footer
      expect(screen.queryByRole('button', { name: /Удалить/i })).not.toBeInTheDocument();
    });
  });

  // ─── Additional form field tests ────────────────────────────────────────

  describe('form field behaviors', () => {
    it('channel select shows all options', () => {
      renderClientInfoTab();
      const select = screen.getByLabelText('Канал') as HTMLSelectElement;
      const options = Array.from(select.querySelectorAll('option'));
      const values = options.map(o => o.value);
      expect(values).toContain('');
      expect(values).toContain('telegram');
      expect(values).toContain('whatsapp');
      expect(values).toContain('max');
    });

    it('sends correct data with all fields changed', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({ onSave });

      fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новое Имя' } });
      // GH #414: a CHANGED number saves as the compact «+<код><нац.>».
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '9991112233' } });
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@test.com' } });
      fireEvent.change(screen.getByLabelText('Канал'), { target: { value: 'whatsapp' } });

      // Save via ref (parent modal calls ref.save())
      await getRef()!.save();

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith({
          name: 'Новое Имя',
          phone: '+79991112233',
          email: 'new@test.com',
          channel: 'whatsapp',
        });
      });
    });

    it('shows "—" for client with null last_record', () => {
      const clientNoVisit = { ...mockClientWithStats, last_record: null as string | null };
      renderClientInfoTab({ client: clientNoVisit });
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('shows formatted total paid with ₽ symbol', () => {
      renderClientInfoTab();
      expect(screen.getByText(/17 500 ₽/)).toBeInTheDocument();
    });
  });

  // ─── GH #414: PhoneField in the client card (spec §Инициализация
  // существующих значений / §Форматирование, валидация, хранение) ────────
  //
  // The card initializes the widget from the stored string; a PRISTINE
  // (untouched) value saves VERBATIM (byte-identical legacy spellings
  // survive a save); validation applies ONLY to a CHANGED number —
  // «без страны» → «Выберите страну из списка», incomplete → the #221
  // message; empty is allowed (phone nullable).
  describe('phone field (GH #414)', () => {
    const LEGACY_RU = '8 999 123-45-67';
    const OUT_OF_LIST = '+1 555 123-45-67';
    const INCOMPLETE_MSG = 'Проверьте номер телефона — возможно, он введён не полностью';
    const NO_COUNTRY_MSG = 'Выберите страну из списка';

    it('initializes from a legacy «8 …» spelling: RU bound, national remainder grouped', () => {
      renderClientInfoTab({ client: { ...mockClientWithStats, phone: LEGACY_RU } });
      expect((screen.getByLabelText('Телефон') as HTMLInputElement).value).toBe('999 123-45-67');
      expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
    });

    it('initializes an out-of-list stored number into the «без страны» state (digits shown)', () => {
      renderClientInfoTab({ client: { ...mockClientWithStats, phone: OUT_OF_LIST } });
      expect((screen.getByLabelText('Телефон') as HTMLInputElement).value).toBe('15551234567');
      // No honest template while unbound.
      expect(screen.getByLabelText('Телефон')).toHaveAttribute('placeholder', '');
    });

    it('an empty stored phone starts on the RU selector, pristine', () => {
      renderClientInfoTab({ client: { ...mockClientWithStats, phone: null } });
      expect((screen.getByLabelText('Телефон') as HTMLInputElement).value).toBe('');
      expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
    });

    it('pristine legacy value saves VERBATIM (no compact rewrite, no validation)', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({
        onSave,
        client: { ...mockClientWithStats, phone: LEGACY_RU },
      });
      // Only the name changes — the phone is never touched.
      fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новое Имя' } });
      await getRef()!.save();
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Новое Имя', phone: LEGACY_RU }),
        );
      });
    });

    it('pristine garbage value saves verbatim too (the pristine path never validates)', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({
        onSave,
        client: { ...mockClientWithStats, phone: 'звонить вечером' },
      });
      fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'X' } });
      await getRef()!.save();
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: 'звонить вечером' }));
      });
    });

    it('a CHANGED number without country blocks the save with «Выберите страну из списка»', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({ onSave });
      // Paste an out-of-list number — the «no country» state.
      fireEvent.paste(screen.getByLabelText('Телефон'), {
        clipboardData: { getData: () => OUT_OF_LIST },
      });
      await getRef()!.save();
      expect(screen.getByText(NO_COUNTRY_MSG)).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('a CHANGED incomplete RU number blocks the save with the #221 message', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({ onSave });
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '9991234' } });
      await getRef()!.save();
      expect(screen.getByText(INCOMPLETE_MSG)).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('a blocked save keeps hasChanges true (the fix is one edit away)', async () => {
      const onHasChanges = vi.fn();
      const { getRef } = renderClientInfoTabWithRef({ onHasChanges });
      onHasChanges.mockClear();
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '9991234' } });
      await getRef()!.save();
      expect(onHasChanges).toHaveBeenLastCalledWith(true);
    });

    it('a CHANGED complete number saves as the compact «+<код><нац.>»', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({ onSave });
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '9991234567' } });
      await getRef()!.save();
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: '+79991234567' }));
      });
    });

    it('a CLEARED phone saves as null (phone is nullable)', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({
        onSave,
        client: { ...mockClientWithStats, phone: LEGACY_RU },
      });
      fireEvent.click(screen.getByRole('button', { name: 'clear' }));
      await getRef()!.save();
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: null }));
      });
    });

    it('the error clears on the next edit of the field', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({ onSave });
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '9991234' } });
      await getRef()!.save();
      expect(screen.getByText(INCOMPLETE_MSG)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '9991234567' } });
      expect(screen.queryByText(INCOMPLETE_MSG)).not.toBeInTheDocument();
      await getRef()!.save();
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: '+79991234567' }));
      });
    });

    it('cancel() restores the stored phone (display AND the pristine save path)', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { getRef } = renderClientInfoTabWithRef({
        onSave,
        client: { ...mockClientWithStats, phone: LEGACY_RU },
      });
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '9991234' } });
      act(() => {
        getRef()!.cancel();
      });
      expect((screen.getByLabelText('Телефон') as HTMLInputElement).value).toBe('999 123-45-67');
      fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Y' } });
      await getRef()!.save();
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: LEGACY_RU }));
      });
    });
  });

  // ─── Visitors section ───────────────────────────────────────────────────

  describe('visitors section', () => {
    const mockVisitors: VisitorResponse[] = [
      { ...mockVisitor, id: 'vis1', name: 'Анна (взр.)', age: 30 },
      { ...mockVisitor, id: 'vis2', name: 'Маша', age: 8 },
    ];

    beforeEach(() => {
      // #324 Task 8: call-history reset — the file's afterEach restoreAllMocks
      // does not clear module-mock vi.fn() histories, and the new conveyor
      // tests assert enqueue call counts.
      vi.clearAllMocks();
      vi.mocked(getClientVisitors).mockResolvedValue(mockVisitors);
      vi.mocked(createVisitor).mockResolvedValue({
        ...mockVisitor,
        id: 'vis_new',
        name: 'Новый Гость',
        age: null,
      });
      vi.mocked(dryRunDeleteVisitor).mockResolvedValue(undefined);
      vi.mocked(resolveDeleteVisitor).mockResolvedValue(undefined);
      mockEnqueuePendingAction.mockClear();
    });

    it('renders visitors section heading', async () => {
      renderClientInfoTab();
      expect(screen.getByText('Посетители')).toBeInTheDocument();
    });

    it('fetches and displays existing visitors', async () => {
      renderClientInfoTab();
      await waitFor(() => {
        expect(getClientVisitors).toHaveBeenCalledWith('c1');
      });
      // The list renders from the query — await the observer's re-render.
      expect(await screen.findByText(/Анна/)).toBeInTheDocument();
      expect(await screen.findByText(/Маша/)).toBeInTheDocument();
    });

    it('shows add visitor button', () => {
      renderClientInfoTab();
      expect(screen.getByText(/Добавить посетителя/)).toBeInTheDocument();
    });

    it('shows inline add form when button clicked', async () => {
      renderClientInfoTab();
      fireEvent.click(screen.getByText(/Добавить посетителя/));
      expect(screen.getByTestId('input-visitor-name')).toBeInTheDocument();
      expect(screen.getByTestId('input-visitor-age')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Создать/ })).toBeInTheDocument();
      // Visitor form has its own cancel button (the smaller one)
      const cancelButtons = screen.getAllByRole('button', { name: /Отмена/ });
      expect(cancelButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('creates visitor on form submit', async () => {
      renderClientInfoTab();
      fireEvent.click(screen.getByText(/Добавить посетителя/));

      // Fill in the new visitor form
      const nameInput = screen.getByTestId('input-visitor-name') as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'Новый Гость' } });

      const createBtn = screen.getByRole('button', { name: /Создать/ });
      fireEvent.click(createBtn);

      await waitFor(() => {
        expect(createVisitor).toHaveBeenCalledWith({
          client_id: 'c1',
          name: 'Новый Гость',
          age: undefined,
        });
      });
    });

    it('creates visitor with age when age provided', async () => {
      renderClientInfoTab();
      fireEvent.click(screen.getByText(/Добавить посетителя/));

      const nameInput = screen.getByTestId('input-visitor-name') as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'Ребёнок' } });

      const ageInput = screen.getByTestId('input-visitor-age') as HTMLInputElement;
      fireEvent.change(ageInput, { target: { value: '5' } });

      fireEvent.click(screen.getByRole('button', { name: /Создать/ }));

      await waitFor(() => {
        expect(createVisitor).toHaveBeenCalledWith({
          client_id: 'c1',
          name: 'Ребёнок',
          age: 5,
        });
      });
    });

    it('hides form when cancel clicked', () => {
      renderClientInfoTab();
      fireEvent.click(screen.getByText(/Добавить посетителя/));
      expect(screen.getByTestId('input-visitor-age')).toBeInTheDocument();

      // The visitor form cancel is the first Отмена button in the DOM
      const cancelButtons = screen.getAllByRole('button', { name: /Отмена/ });
      fireEvent.click(cancelButtons[0]);
      expect(screen.queryByTestId('input-visitor-age')).not.toBeInTheDocument();
    });

    it('refetches visitors after successful creation', async () => {
      renderClientInfoTab();
      await waitFor(() => {
        expect(getClientVisitors).toHaveBeenCalledWith('c1');
      });

      // Reset mock call count after initial fetch
      vi.mocked(getClientVisitors).mockClear();

      fireEvent.click(screen.getByText(/Добавить посетителя/));
      const nameInput = screen.getByTestId('input-visitor-name') as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'Новый Гость' } });
      fireEvent.click(screen.getByRole('button', { name: /Создать/ }));

      await waitFor(() => {
        expect(createVisitor).toHaveBeenCalled();
      });

      // After creation, getClientVisitors should be called again for refetch
      expect(getClientVisitors).toHaveBeenCalled();
    });

    // ─── #324 Task 8: visitor delete on the deferred conveyor ────────────
    //
    // The former INSTANT `await deleteVisitor(visitorId)` is GONE — the ×
    // button now goes through useDeleteVisitor.removeVisitor: clean visitor
    // → dry-run 204 → optimistic row removal + 5s undo ring (enqueue, no
    // instant commit); with visits → dry-run 409 → DeleteDialog
    // «Посещения: N будут удалены» → confirm enqueues the cascade.

    /** The 409 tree of vis1 (Анна) with 2 visits + 1 own tag. */
    const VISITOR_DEPS: DependencyNode[] = [
      {
        entity: 'visits', auto: false, relation: 'Посещение', count: 2,
        allowed_actions: ['cascade'],
        items: [
          { id: 'visit-1', label: 'Гуашь, 3500' },
          { id: 'visit-2', label: 'Гуашь, 3500' },
        ],
      },
      {
        entity: 'visitor_tags', auto: true, relation: 'Тег', count: 1,
        allowed_actions: ['cascade'],
        items: [{ id: 'tag-1', label: 'Гуашь' }],
      },
    ];

    it('× click on a visit-less visitor: dry-run → ring (enqueue); NO instant resolveDeleteVisitor call', async () => {
      renderClientInfoTab();
      const delBtn = await screen.findAllByRole('button', { name: 'Удалить посетителя' });
      fireEvent.click(delBtn[0]);

      await waitFor(() => {
        expect(dryRunDeleteVisitor).toHaveBeenCalledWith('vis1');
      });
      // The deferred action is enqueued (5s ring) — the real DELETE lives
      // in the commit, never at click time.
      expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      expect(resolveDeleteVisitor).not.toHaveBeenCalled();
      // The instant import is no longer used by the component at all.
      expect(deleteVisitor).not.toHaveBeenCalled();
    });

    it('undo restores the VISIBLE row (query render source) — ring #94 semantics', async () => {
      renderClientInfoTab();
      expect(await screen.findAllByTestId('visitor-row')).toHaveLength(2);

      const delBtn = await screen.findAllByRole('button', { name: 'Удалить посетителя' });
      fireEvent.click(delBtn[0]);

      // Optimistic removal — the row disappears from the card immediately.
      await waitFor(() => {
        expect(screen.getAllByTestId('visitor-row')).toHaveLength(1);
      });

      // «Отменить» from the ring: the enqueued action's undo runs (the
      // PendingActions provider calls it when the toast is clicked) — the
      // row must VISIBLY return. The card renders from the
      // ['visitors', clientId] query, so the hook's cache restore IS the
      // visual restore (react-query notifies observers on a microtask —
      // hence waitFor, not a sync assert).
      const action = mockEnqueuePendingAction.mock.calls.at(-1)![0] as {
        undo: () => void;
      };
      act(() => {
        action.undo();
      });

      await waitFor(() => {
        expect(screen.getAllByTestId('visitor-row')).toHaveLength(2);
      });
      // No server calls on the undo path (dry-run preview guarantee).
      expect(resolveDeleteVisitor).not.toHaveBeenCalled();
    });

    it('dry-run 409 → DeleteDialog opens with «Посещения — будут удалены:» and the row stays', async () => {
      vi.mocked(dryRunDeleteVisitor).mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, VISITOR_DEPS),
      );
      renderClientInfoTab();
      const delBtn = await screen.findAllByRole('button', { name: 'Удалить посетителя' });
      fireEvent.click(delBtn[0]);

      await waitFor(() => {
        expect(screen.getByTestId('delete-dialog-title')).toBeInTheDocument();
      });
      expect(screen.getByText(/Удаление «посетителя Анна/)).toBeInTheDocument();
      expect(screen.getByTestId('dep-visits')).toHaveTextContent('Посещения — будут удалены:');
      // Nothing enqueued before confirmation; the row stays visible (the
      // dialog title itself carries the name — check the row testid).
      expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
      expect(await screen.findAllByTestId('visitor-row')).toHaveLength(2);
    });

    it('dialog confirm → cascade enqueued (removeVisitorResolved), dialog closes', async () => {
      vi.mocked(dryRunDeleteVisitor).mockRejectedValue(
        new ApiError(409, 'has_dependencies', undefined, VISITOR_DEPS),
      );
      renderClientInfoTab();
      const delBtn = await screen.findAllByRole('button', { name: 'Удалить посетителя' });
      fireEvent.click(delBtn[0]);

      await waitFor(() => {
        expect(screen.getByTestId('delete-dialog-title')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('delete-dialog-confirm-checkbox'));
      fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

      await waitFor(() => {
        expect(mockEnqueuePendingAction).toHaveBeenCalledTimes(1);
      });
      // Enqueue is synchronous — the dialog closed immediately; the commit
      // (resolveDeleteVisitor with BOTH expected groups) runs after 5s.
      await waitFor(() => {
        expect(screen.queryByTestId('delete-dialog-title')).not.toBeInTheDocument();
      });
      expect(resolveDeleteVisitor).not.toHaveBeenCalled();
    });
  });
});
