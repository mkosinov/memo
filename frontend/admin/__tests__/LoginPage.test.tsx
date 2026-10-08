import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
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

// GH #414: the phone field is the PhoneField widget — the helper types the
// NATIONAL remainder (the calling code lives in the country selector, RU by
// default). The submitted value is the compact the page lifts on submit.
function fillForm(nationalRemainder: string, password: string) {
  fireEventChange(screen.getByLabelText('Телефон'), nationalRemainder);
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

function clickSubmit() {
  act(() => {
    screen.getByRole('button', { name: 'Войти' }).click();
  });
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
    fillForm('9990000001', 'secret123');
    clickSubmit();
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('accepts a same-origin returnTo path (positive sanitization case)', async () => {
    window.history.replaceState(null, '', '/login?returnTo=%2Frecords');
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    fillForm('9990000001', 'secret123');
    clickSubmit();
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
    fillForm('9990000001', 'secret123');
    clickSubmit();
    await waitFor(() => {
      // The typed RU remainder is lifted as the compact «+79990000001».
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
    fillForm('9990000001', 'secret123');
    clickSubmit();
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('shows inline error + toast on invalid credentials and stays on the page', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, 'Invalid phone or password', 'AUTH_INVALID_CREDENTIALS'));
    renderLogin();
    fillForm('9990000001', 'wrong-pass');
    clickSubmit();
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
    fillForm('9990000001', 'secret123');
    clickSubmit();
    await waitFor(() => {
      expect(screen.getByText('Ошибка сети')).toBeInTheDocument();
    });
    expect(screen.getByTestId('auth-probe')).toHaveTextContent('guest');
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe('LoginPage — phone widget (GH #414, spec §Экран входа)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/login');
    mockGetMe.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/login');
  });

  it('renders the PhoneField widget with the RU selector default', () => {
    renderLogin();
    expect(screen.getByTestId('phone-field')).toBeInTheDocument();
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
    // The remainder input keeps the page's label/id anchor (#login-phone).
    expect(screen.getByLabelText('Телефон')).toHaveAttribute('id', 'login-phone');
  });

  it('submits the compact of a bound country (selector pick → compact on the wire)', async () => {
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    // Bind Belarus via the selector, then type the BY remainder.
    act(() => {
      fireEvent.click(screen.getByTestId('phone-country-select'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('phone-country-select-option-BY'));
    });
    fillForm('291234567', 'secret123');
    clickSubmit();
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('+375291234567', 'secret123');
    });
  });

  it('required-empty only: an empty phone blocks submit with no API call', async () => {
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    fireEventChange(screen.getByLabelText('Пароль'), 'secret123');
    clickSubmit();
    // The only login gate (spec §Экран входа): the field's native required —
    // jsdom enforces constraint validation, so the submit event never fires
    // and the empty phone cannot reach the API. No completeness validator.
    await act(async () => { /* drain microtasks */ });
    expect(mockLogin).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-probe')).toHaveTextContent('guest');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('NO completeness gate: an incomplete number still submits its compact', async () => {
    // Spec §Экран входа: no fullness validator on login — legacy partial
    // spellings and out-of-list numbers must physically reach the server.
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    fillForm('999123', 'secret123'); // 6 digits — not a possible RU number
    clickSubmit();
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('+7999123', 'secret123');
    });
  });

  it('«no country» (out-of-list «+1 …» paste) submits digits only', async () => {
    mockLogin.mockResolvedValue(mockAuthMe);
    renderLogin();
    fireEventChange(screen.getByLabelText('Пароль'), 'secret123');
    act(() => {
      fireEvent.paste(screen.getByLabelText('Телефон'), {
        clipboardData: { getData: () => '+1 555 123-45-67' },
      });
    });
    // Unbound field → raw digits, no grouping, no honest template.
    expect(screen.getByLabelText('Телефон')).toHaveValue('15551234567');
    clickSubmit();
    await waitFor(() => {
      // No compact exists while unbound — the typed digits go as entered.
      expect(mockLogin).toHaveBeenCalledWith('15551234567', 'secret123');
    });
  });
});
