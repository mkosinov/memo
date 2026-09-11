import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ApiError } from '@memo/api-client';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getMe: vi.fn(),
    login: vi.fn(),
  };
});

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

import { getMe, login } from '@memo/api-client';
import LoginPage from '../app/login/page';
import { UIProvider } from '../contexts/UIContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

const mockGetMe = vi.mocked(getMe);
const mockLogin = vi.mocked(login);

const mockAuthMe = {
  user: {
    id: 'user-uuid-1',
    phone: '+79990000001',
    role: 'admin',
    master_id: null,
    email: null,
  },
  permissions: ['*'],
  master: null,
};

function fillForm(phone: string, password: string) {
  fireEventChange(screen.getByLabelText('Телефон'), phone);
  fireEventChange(screen.getByLabelText('Пароль'), password);
}

function fireEventChange(el: HTMLElement, value: string) {
  act(() => {
    // React controlled inputs read from the value setter
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    setter!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Auth-state probe: reflects the SHARED AuthContext state the page mutates. */
function AuthStateProbe() {
  const { status, user } = useAuth();
  return (
    <span data-testid="auth-probe">
      {status}
      {status === 'authenticated' ? `:${user?.id}` : ''}
    </span>
  );
}

function renderLogin() {
  return render(
    <UIProvider>
      {/* Real AuthProvider: the page's submit must drive THIS context's state.
          Regression guard (GH #247 review): if the page called the api-client
          directly, the probe would stay "guest" after a successful login. */}
      <AuthProvider>
        <AuthStateProbe />
        <LoginPage />
      </AuthProvider>
    </UIProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/login');
    mockGetMe.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/login');
  });

  it('renders phone and password inputs with a submit button', () => {
    renderLogin();
    expect(screen.getByLabelText('Телефон')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
  });

  it('redirects to / when already authenticated', async () => {
    mockGetMe.mockResolvedValue(mockAuthMe);
    renderLogin();
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('derives already-authenticated redirect from AuthContext (no second /me call)', async () => {
    // The page itself never calls getMe: only the AuthProvider bootstrap does
    // (review #2 — one /me per load, not two).
    mockGetMe.mockResolvedValue(mockAuthMe);
    renderLogin();
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
    expect(mockGetMe).toHaveBeenCalledTimes(1);
  });

  it('rejects an off-site returnTo (open-redirect hardening) and falls back to /', async () => {
    // Review #3: only same-origin absolute paths pass sanitization.
    window.history.replaceState(null, '', '/login?returnTo=%2F%2Fevil.example.com%2Fphish');
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    fillForm('+79990000001', 'secret123');
    act(() => {
      screen.getByRole('button', { name: 'Войти' }).click();
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('accepts a same-origin returnTo path (positive sanitization case)', async () => {
    window.history.replaceState(null, '', '/login?returnTo=%2Frecords');
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    fillForm('+79990000001', 'secret123');
    act(() => {
      screen.getByRole('button', { name: 'Войти' }).click();
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/records');
    });
  });

  it('submits via AuthContext login: context flips to authenticated and routes to returnTo', async () => {
    window.history.replaceState(null, '', '/login?returnTo=%2Fclients');
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    await waitFor(() => {
      expect(screen.getByTestId('auth-probe')).toHaveTextContent('guest');
    });
    fillForm('+79990000001', 'secret123');
    act(() => {
      screen.getByRole('button', { name: 'Войти' }).click();
    });
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('+79990000001', 'secret123');
      // THE regression assertion: the AuthContext instance shared with the
      // probe is authenticated — the page updated context state, not just
      // fired an API call.
      expect(screen.getByTestId('auth-probe')).toHaveTextContent('authenticated:user-uuid-1');
      expect(replaceMock).toHaveBeenCalledWith('/clients');
    });
  });

  it('routes to / on success without returnTo', async () => {
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    fillForm('+79990000001', 'secret123');
    act(() => {
      screen.getByRole('button', { name: 'Войти' }).click();
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('shows inline error + toast on invalid credentials and stays on the page', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, 'Invalid phone or password', 'AUTH_INVALID_CREDENTIALS'));
    renderLogin();
    fillForm('+79990000001', 'wrong-pass');
    act(() => {
      screen.getByRole('button', { name: 'Войти' }).click();
    });
    await waitFor(() => {
      // Inline error visible (spec §6 scenario 3)
      expect(screen.getByText('Неверный телефон или пароль')).toBeInTheDocument();
    });
    // Toast also shown (repo style: parseApiError + showToast)
    await waitFor(() => {
      expect(screen.getAllByText('Неверный телефон или пароль').length).toBeGreaterThanOrEqual(1);
    });
    // Context stayed guest — failed login must not flip state
    expect(screen.getByTestId('auth-probe')).toHaveTextContent('guest');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows generic network error message when fetch fails', async () => {
    mockLogin.mockRejectedValue(new TypeError('Failed to fetch'));
    renderLogin();
    fillForm('+79990000001', 'secret123');
    act(() => {
      screen.getByRole('button', { name: 'Войти' }).click();
    });
    await waitFor(() => {
      expect(screen.getByText('Ошибка сети')).toBeInTheDocument();
    });
    expect(screen.getByTestId('auth-probe')).toHaveTextContent('guest');
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
