import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
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
  };
});

import { getClientVisitors, createVisitor, deleteVisitor } from '@memo/api-client';

// Global ref holder for tests that need to call save()/cancel()
let testRefHandle: ClientInfoTabHandle | null = null;

function RefCapture({ children }: { children: (ref: React.Ref<ClientInfoTabHandle>) => React.ReactNode }) {
  const ref = React.useCallback((instance: ClientInfoTabHandle | null) => {
    testRefHandle = instance;
  }, []) as React.Ref<ClientInfoTabHandle>;
  return <>{children(ref)}</> as React.ReactElement;
}

type RenderResult = ReturnType<typeof render>;

function renderClientInfoTab(overrides?: {
  client?: ClientWithStats;
  onSave?: (data: Partial<ClientWithStats>) => Promise<void>;
  onDelete?: () => void;
  onHasChanges?: (hasChanges: boolean) => void;
}): RenderResult {
  const client = overrides?.client ?? mockClientWithStats;
  const onSave = overrides?.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onDelete = overrides?.onDelete ?? vi.fn();
  const onHasChanges = overrides?.onHasChanges;
  return render(
    <ClientInfoTab client={client} onSave={onSave} onDelete={onDelete} onHasChanges={onHasChanges} />
  );
}

/** Like renderClientInfoTab but exposes a ref for calling save()/cancel() */
function renderClientInfoTabWithRef(overrides?: {
  client?: ClientWithStats;
  onSave?: (data: Partial<ClientWithStats>) => Promise<void>;
  onDelete?: () => void;
  onHasChanges?: (hasChanges: boolean) => void;
}) {
  const client = overrides?.client ?? mockClientWithStats;
  const onSave = overrides?.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onDelete = overrides?.onDelete ?? vi.fn();
  const onHasChanges = overrides?.onHasChanges;
  render(
    <RefCapture>
      {(ref) => (
        <ClientInfoTab client={client} onSave={onSave} onDelete={onDelete} onHasChanges={onHasChanges} ref={ref} />
      )}
    </RefCapture>
  );
  return { client, onSave, onDelete, getRef: () => testRefHandle };
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
    expect(input.value).toBe('+7 (900) 123-45-67');
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
        email: '',
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
        onDelete={vi.fn()}
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
      fireEvent.change(phoneInput, { target: { value: '+7 (999) 111-22-33' } });
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
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 (000) 000-00-00' } });
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
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 (000) 000-00-00' } });
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@test.com' } });
      fireEvent.change(screen.getByLabelText('Канал'), { target: { value: 'whatsapp' } });

      // Save via ref (parent modal calls ref.save())
      await getRef()!.save();

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith({
          name: 'Новое Имя',
          phone: '+7 (000) 000-00-00',
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

  // ─── Visitors section ───────────────────────────────────────────────────

  describe('visitors section', () => {
    const mockVisitors: VisitorResponse[] = [
      { ...mockVisitor, id: 'vis1', name: 'Анна (взр.)', age: 30 },
      { ...mockVisitor, id: 'vis2', name: 'Маша', age: 8 },
    ];

    beforeEach(() => {
      vi.mocked(getClientVisitors).mockResolvedValue(mockVisitors);
      vi.mocked(createVisitor).mockResolvedValue({
        ...mockVisitor,
        id: 'vis_new',
        name: 'Новый Гость',
        age: null,
      });
      vi.mocked(deleteVisitor).mockResolvedValue(undefined);
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
      expect(screen.getByText(/Анна/)).toBeInTheDocument();
      expect(screen.getByText(/Маша/)).toBeInTheDocument();
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
  });
});
