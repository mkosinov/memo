import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ClientInfoTab } from '../app/(main)/clients/components/ClientInfoTab';
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

function renderClientInfoTab(overrides?: {
  client?: ClientWithStats;
  onSave?: (data: Partial<ClientWithStats>) => Promise<void>;
  onDelete?: () => void;
}) {
  const client = overrides?.client ?? mockClientWithStats;
  const onSave = overrides?.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onDelete = overrides?.onDelete ?? vi.fn();
  return { client, onSave, onDelete, ...render(
    <ClientInfoTab client={client} onSave={onSave} onDelete={onDelete} />
  ) };
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

  it('shows metrics: visits, missed, last visit, total paid', () => {
    renderClientInfoTab();
    expect(screen.getByText('Визитов')).toBeInTheDocument();
    expect(screen.getByText('Пропущено')).toBeInTheDocument();
    expect(screen.getByText('Последний')).toBeInTheDocument();
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
    renderClientInfoTab();
    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    expect(saveBtn).toBeDisabled();
  });

  it('enables save button when name changes', () => {
    renderClientInfoTab();
    const input = screen.getByLabelText('Имя');
    fireEvent.change(input, { target: { value: 'Новое Имя' } });
    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    expect(saveBtn).toBeEnabled();
  });

  it('calls onSave with updated data when save clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderClientInfoTab({ onSave });
    const input = screen.getByLabelText('Имя');
    fireEvent.change(input, { target: { value: 'Новое Имя' } });
    const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: 'Новое Имя',
        phone: '+7 (900) 123-45-67',
        email: '',
        channel: 'telegram',
      });
    });
  });

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn();
    renderClientInfoTab({ onDelete });
    const deleteBtn = screen.getByRole('button', { name: /Удалить клиента/i });
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalled();
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
    it('save button stays disabled after save completes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      renderClientInfoTab({ onSave });

      // Change name to enable save
      const input = screen.getByLabelText('Имя');
      fireEvent.change(input, { target: { value: 'Новое Имя' } });
      const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
      expect(saveBtn).toBeEnabled();

      // Click save
      fireEvent.click(saveBtn);

      // After save, button should be disabled again (hasChanges reset)
      await waitFor(() => {
        expect(saveBtn).toBeDisabled();
      });
    });

    it('save button enables when phone is changed', () => {
      renderClientInfoTab();
      const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
      expect(saveBtn).toBeDisabled();

      const phoneInput = screen.getByLabelText('Телефон');
      fireEvent.change(phoneInput, { target: { value: '+7 (999) 111-22-33' } });
      expect(saveBtn).toBeEnabled();
    });

    it('save button enables when email is changed', () => {
      renderClientInfoTab();
      const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
      expect(saveBtn).toBeDisabled();

      const emailInput = screen.getByLabelText('Email');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      expect(saveBtn).toBeEnabled();
    });

    it('save button enables when channel is changed', () => {
      renderClientInfoTab();
      const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
      expect(saveBtn).toBeDisabled();

      const channelSelect = screen.getByLabelText('Канал');
      fireEvent.change(channelSelect, { target: { value: 'whatsapp' } });
      expect(saveBtn).toBeEnabled();
    });

    it('save button stays enabled after multiple changes', () => {
      renderClientInfoTab();
      const saveBtn = screen.getByRole('button', { name: /Сохранить/i });

      fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'A' } });
      expect(saveBtn).toBeEnabled();

      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 (000) 000-00-00' } });
      expect(saveBtn).toBeEnabled();

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
      expect(saveBtn).toBeEnabled();
    });

    it('save button resets disabled after saving even with new changes pending', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      renderClientInfoTab({ onSave });

      const input = screen.getByLabelText('Имя');
      fireEvent.change(input, { target: { value: 'New' } });
      const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
      expect(saveBtn).toBeEnabled();

      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(saveBtn).toBeDisabled();
      });

      // Making a new change should re-enable the button
      fireEvent.change(input, { target: { value: 'New Again' } });
      expect(saveBtn).toBeEnabled();
    });

    it('delete button is always enabled regardless of hasChanges', () => {
      renderClientInfoTab();
      const deleteBtn = screen.getByRole('button', { name: /Удалить клиента/i });
      expect(deleteBtn).toBeEnabled();
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
      renderClientInfoTab({ onSave });

      fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Новое Имя' } });
      fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 (000) 000-00-00' } });
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@test.com' } });
      fireEvent.change(screen.getByLabelText('Канал'), { target: { value: 'whatsapp' } });

      fireEvent.click(screen.getByRole('button', { name: /Сохранить/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith({
          name: 'Новое Имя',
          phone: '+7 (000) 000-00-00',
          email: 'new@test.com',
          channel: 'whatsapp',
        });
      });
    });

    it('shows "—" for client with null last_visit', () => {
      const clientNoVisit = { ...mockClientWithStats, last_visit: null as string | null };
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
