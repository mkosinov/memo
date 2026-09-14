/**
 * PasswordModal — GH #262 T7 (spec §5.3, D6/D12).
 *
 * Small modal: Старый пароль, Новый пароль, Повторите новый + the shared
 * PASSWORD_POLICY_HINT_RU hint. Wrong current password (401
 * AUTH_INVALID_CREDENTIALS) → inline «Неверный пароль» on the current field;
 * success → toast «Пароль изменён» + close, NO redirect (the current session
 * stays alive — D6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockChangePassword = vi.fn();
const mockShowToast = vi.fn();

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    changePassword: (...args: unknown[]) => mockChangePassword(...args),
  };
});

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import { PasswordModal } from '@/app/components/modal/PasswordModal';
import { PASSWORD_POLICY_HINT_RU } from '@/lib/constants';
import { ApiError } from '@memo/api-client';

function renderModal(overrides: Partial<React.ComponentProps<typeof PasswordModal>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = overrides.onClose ?? vi.fn();
  return render(
    <QueryClientProvider client={queryClient}>
      <PasswordModal onClose={onClose} {...overrides} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChangePassword.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('PasswordModal — fields + hint', () => {
  it('renders three password inputs', () => {
    renderModal();
    expect(screen.getByTestId('password-current')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('password-new')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('password-repeat')).toHaveAttribute('type', 'password');
  });

  it('shows the shared PASSWORD_POLICY_HINT_RU hint', () => {
    renderModal();
    expect(screen.getByTestId('password-hint')).toHaveTextContent(PASSWORD_POLICY_HINT_RU);
    expect(PASSWORD_POLICY_HINT_RU).toBe('Пароль: от 8 до 64 символов, пробелы по краям обрезаются');
  });

  it('does not submit while any field is empty (client guard, no API call)', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'old12345' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'new12345' } });
    fireEvent.click(screen.getByTestId('password-submit'));
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('a repeat mismatch shows an inline error and does not call the API', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'old12345' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'new12345' } });
    fireEvent.change(screen.getByTestId('password-repeat'), { target: { value: 'other12345' } });
    fireEvent.click(screen.getByTestId('password-submit'));
    expect(screen.getByTestId('password-repeat-error')).toHaveTextContent('Пароли не совпадают');
    expect(mockChangePassword).not.toHaveBeenCalled();
  });
});

describe('PasswordModal — wrong current password', () => {
  it('401 AUTH_INVALID_CREDENTIALS → inline «Неверный пароль», modal stays open', async () => {
    const onClose = vi.fn();
    mockChangePassword.mockRejectedValue(
      new ApiError(401, 'Invalid credentials', 'AUTH_INVALID_CREDENTIALS'),
    );
    renderModal({ onClose });

    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'wrong123' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'new12345' } });
    fireEvent.change(screen.getByTestId('password-repeat'), { target: { value: 'new12345' } });
    fireEvent.click(screen.getByTestId('password-submit'));

    expect(await screen.findByTestId('password-current-error')).toHaveTextContent(
      'Неверный пароль',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('a policy breach (422 PASSWORD_POLICY) surfaces as a toast', async () => {
    mockChangePassword.mockRejectedValue(
      new ApiError(422, PASSWORD_POLICY_HINT_RU, 'PASSWORD_POLICY'),
    );
    renderModal();

    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'old12345' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'short' } });
    fireEvent.change(screen.getByTestId('password-repeat'), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('password-submit'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error'),
    );
  });
});

describe('PasswordModal — success', () => {
  it('toasts «Пароль изменён», closes, and does NOT redirect', async () => {
    const onClose = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderModal({ onClose });

    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'old12345' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'new12345' } });
    fireEvent.change(screen.getByTestId('password-repeat'), { target: { value: 'new12345' } });
    fireEvent.click(screen.getByTestId('password-submit'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockChangePassword).toHaveBeenCalledWith({
      current_password: 'old12345',
      new_password: 'new12345',
    });
    expect(mockShowToast).toHaveBeenCalledWith('Пароль изменён', 'success');
    expect(assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('the close button closes without confirmation (no dirty guard on a password form)', () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderModal({ onClose });
    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('modal-close-btn'));
    expect(onClose).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
