import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ClientInfoTab } from '../app/(main)/clients/components/ClientInfoTab';
import { mockClientWithStats } from './helpers/mockData';
import type { ClientWithStats } from '@memo/api-client';

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
});
