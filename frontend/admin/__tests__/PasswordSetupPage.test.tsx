/**
 * Public password-setup page (GH #348 Task 8, spec §6, S2/S4).
 *
 * Three screens: checking (validate in flight) → form («Придумайте пароль»
 * + confirmation) or invalid («Ссылка недействительна или истекла»).
 * The token rides in the URL fragment and is STRIPPED right after reading;
 * policy breach → the single inline message; success → route to the static
 * /password-setup/success page (a refresh can never re-issue the request —
 * the fragment is gone and the token is consumed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import React from 'react';
import { ApiError } from '@memo/api-client';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    validatePasswordSetup: vi.fn(),
    passwordSetup: vi.fn(),
  };
});

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

import { validatePasswordSetup, passwordSetup } from '@memo/api-client';
import PasswordSetupPage from '../app/password-setup/page';
import { PASSWORD_POLICY_HINT_RU } from '../lib/constants';

const mockValidate = vi.mocked(validatePasswordSetup);
const mockSetup = vi.mocked(passwordSetup);

const POLICY_ERROR = () =>
  new ApiError(422, PASSWORD_POLICY_HINT_RU, 'PASSWORD_POLICY');
const LINK_INVALID_ERROR = () =>
  new ApiError(
    422,
    'Ссылка недействительна или истекла',
    'PASSWORD_LINK_INVALID',
  );

function setUrl(url: string): void {
  window.history.replaceState(null, '', url);
}

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('PasswordSetupPage', () => {
  beforeEach(() => {
    setUrl('/password-setup');
    mockValidate.mockResolvedValue({ ok: true });
    mockSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setUrl('/password-setup');
  });

  describe('screen chooser (validate on open)', () => {
    it('valid token: validates, strips the fragment, shows the password form', async () => {
      setUrl('/password-setup#token=raw-token-abc');
      render(<PasswordSetupPage />);

      await waitFor(() => {
        expect(screen.getByText('Придумайте пароль')).toBeInTheDocument();
      });
      expect(mockValidate).toHaveBeenCalledWith('raw-token-abc');
      // The token never lingers in the address bar (spec §6).
      expect(window.location.hash).toBe('');
      expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
      expect(screen.getByLabelText('Повторите пароль')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Установить пароль' }),
      ).toBeInTheDocument();
    });

    it('StrictMode double-mount: the form still appears (hash re-read after strip must not flip to invalid)', async () => {
      setUrl('/password-setup#token=strict-mode-token');
      render(
        <React.StrictMode>
          <PasswordSetupPage />
        </React.StrictMode>,
      );

      await waitFor(() => {
        expect(screen.getByText('Придумайте пароль')).toBeInTheDocument();
      });
      expect(
        screen.queryByText('Ссылка недействительна или истекла'),
      ).not.toBeInTheDocument();
    });

    it('invalid token (422 PASSWORD_LINK_INVALID): the invalid screen, no form', async () => {
      setUrl('/password-setup#token=stale');
      mockValidate.mockRejectedValue(LINK_INVALID_ERROR());
      render(<PasswordSetupPage />);

      await waitFor(() => {
        expect(
          screen.getByText('Ссылка недействительна или истекла'),
        ).toBeInTheDocument();
      });
      expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Установить пароль' }),
      ).not.toBeInTheDocument();
    });

    it('no token in the fragment: invalid screen, validate never called', async () => {
      render(<PasswordSetupPage />);

      await waitFor(() => {
        expect(
          screen.getByText('Ссылка недействительна или истекла'),
        ).toBeInTheDocument();
      });
      expect(mockValidate).not.toHaveBeenCalled();
    });

    it('shows a checking screen while validate is in flight', async () => {
      let resolveValidate!: (v: { ok: boolean }) => void;
      mockValidate.mockReturnValue(
        new Promise<{ ok: boolean }>((res) => {
          resolveValidate = res;
        }),
      );
      setUrl('/password-setup#token=pending');
      render(<PasswordSetupPage />);

      expect(screen.getByTestId('password-setup-checking')).toBeInTheDocument();
      expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();

      // The pending answer still flips the screen when it lands.
      await act(async () => {
        resolveValidate({ ok: true });
      });
      await waitFor(() => {
        expect(screen.getByText('Придумайте пароль')).toBeInTheDocument();
      });
    });
  });

  describe('form submit', () => {
    async function renderForm(token = 'raw-token-abc'): Promise<void> {
      setUrl(`/password-setup#token=${token}`);
      render(<PasswordSetupPage />);
      await waitFor(() => {
        expect(screen.getByText('Придумайте пароль')).toBeInTheDocument();
      });
    }

    it('mismatched confirmation: inline «Пароли не совпадают», no API call', async () => {
      await renderForm();
      fill('Пароль', 'new-strong-pass');
      fill('Повторите пароль', 'different-pass');
      act(() => {
        screen.getByRole('button', { name: 'Установить пароль' }).click();
      });
      await waitFor(() => {
        expect(screen.getByTestId('password-setup-error')).toHaveTextContent(
          'Пароли не совпадают',
        );
      });
      expect(mockSetup).not.toHaveBeenCalled();
      expect(replaceMock).not.toHaveBeenCalled();
    });

    it('422 PASSWORD_POLICY: the single inline policy message, form stays', async () => {
      await renderForm();
      mockSetup.mockRejectedValue(POLICY_ERROR());
      fill('Пароль', 'short');
      fill('Повторите пароль', 'short');
      act(() => {
        screen.getByRole('button', { name: 'Установить пароль' }).click();
      });
      await waitFor(() => {
        expect(screen.getByTestId('password-setup-error')).toHaveTextContent(
          PASSWORD_POLICY_HINT_RU,
        );
      });
      // Still on the form — a policy failure never consumes the link.
      expect(screen.getByText('Придумайте пароль')).toBeInTheDocument();
      expect(replaceMock).not.toHaveBeenCalled();
    });

    it('success: calls passwordSetup(token, password) and routes to /password-setup/success', async () => {
      await renderForm('raw-token-xyz');
      fill('Пароль', 'new-strong-pass');
      fill('Повторите пароль', 'new-strong-pass');
      act(() => {
        screen.getByRole('button', { name: 'Установить пароль' }).click();
      });
      await waitFor(() => {
        expect(mockSetup).toHaveBeenCalledWith(
          'raw-token-xyz',
          'new-strong-pass',
        );
      });
      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith('/password-setup/success');
      });
    });

    it('422 PASSWORD_LINK_INVALID on submit: switches to the invalid screen', async () => {
      await renderForm();
      mockSetup.mockRejectedValue(LINK_INVALID_ERROR());
      fill('Пароль', 'new-strong-pass');
      fill('Повторите пароль', 'new-strong-pass');
      act(() => {
        screen.getByRole('button', { name: 'Установить пароль' }).click();
      });
      await waitFor(() => {
        expect(
          screen.getByText('Ссылка недействительна или истекла'),
        ).toBeInTheDocument();
      });
      expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
    });

    it('network failure: inline generic message, form stays retryable', async () => {
      await renderForm();
      mockSetup.mockRejectedValue(new TypeError('Failed to fetch'));
      fill('Пароль', 'new-strong-pass');
      fill('Повторите пароль', 'new-strong-pass');
      act(() => {
        screen.getByRole('button', { name: 'Установить пароль' }).click();
      });
      await waitFor(() => {
        expect(screen.getByTestId('password-setup-error')).toHaveTextContent(
          'Ошибка сети',
        );
      });
      expect(screen.getByText('Придумайте пароль')).toBeInTheDocument();
    });
  });
});
