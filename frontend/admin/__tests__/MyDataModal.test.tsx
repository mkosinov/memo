/**
 * MyDataModal — GH #262 T7 (spec §5.2, D2/D4/D7/D12).
 *
 * Field-config pattern of PhotoModal: per-field errors, dirty-guard confirm
 * on close, Escape. Public half (names) is hidden ENTIRELY when
 * has_staff=false; «Специализация» is a read-only string (array joined)
 * visible only when has_master=true and is NEVER sent by PUT; the portrait
 * block uploads via uploadPortrait + refreshes the AuthContext plate and
 * clears via avatar_url: null; «Паспорт» carries the disabled placeholder
 * row «Фото первой страницы паспорта — появится позже».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetMyProfile = vi.fn();
const mockUpdateMyProfile = vi.fn();
const mockUploadPortrait = vi.fn();
const mockRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock('@memo/api-client', () => ({
  getMyProfile: (...args: unknown[]) => mockGetMyProfile(...args),
  updateMyProfile: (...args: unknown[]) => mockUpdateMyProfile(...args),
  uploadPortrait: (...args: unknown[]) => mockUploadPortrait(...args),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ refresh: mockRefresh }),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));
const mockShowToast = vi.fn();

import { MyDataModal } from '@/app/components/modal/MyDataModal';
import type { MyProfile } from '@memo/api-client';
import {
  mockMyProfileMaster,
  mockMyProfileStaffNoMaster,
  mockMyProfileNoCard,
  createMockMyProfile,
} from './helpers/mockData';

const PASSPORT_PHOTO_PLACEHOLDER = 'Фото первой страницы паспорта — появится позже';

function renderModal(profile: MyProfile = mockMyProfileMaster, overrides: Partial<React.ComponentProps<typeof MyDataModal>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockGetMyProfile.mockResolvedValue(profile);
  const onClose = overrides.onClose ?? vi.fn();
  return render(
    <QueryClientProvider client={queryClient}>
      <MyDataModal onClose={onClose} {...overrides} />
    </QueryClientProvider>,
  );
}

/** Wait until GET /my resolved and the form fields rendered. */
async function waitForForm() {
  await waitFor(() => expect(mockGetMyProfile).toHaveBeenCalled());
  await screen.findByTestId('mydata-form');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMyProfile.mockResolvedValue(mockMyProfileMaster);
  mockUploadPortrait.mockResolvedValue({ avatar_url: '/api/v1/files/avatar/n.png' });
});
afterEach(() => vi.restoreAllMocks());

describe('MyDataModal — role + names', () => {
  it('renders Роль read-only (disabled input, not editable)', async () => {
    renderModal();
    await waitForForm();
    const role = screen.getByTestId('mydata-role');
    expect(role).toHaveValue('master');
    expect(role).toBeDisabled();
  });

  it('renders Имя* and Фамилия* as required text inputs', async () => {
    renderModal();
    await waitForForm();
    expect(screen.getByTestId('mydata-first_name')).toHaveValue('Ольга');
    expect(screen.getByTestId('mydata-last_name')).toHaveValue('Середа');
    // Both required → two asterisks at minimum.
    expect(screen.getByText('Имя')).toBeInTheDocument();
    expect(screen.getByText('Фамилия')).toBeInTheDocument();
  });

  it('hides Имя/Фамилия ENTIRELY when has_staff=false (S6)', async () => {
    renderModal(mockMyProfileNoCard);
    await waitForForm();
    expect(screen.queryByTestId('mydata-first_name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mydata-last_name')).not.toBeInTheDocument();
    expect(screen.queryByText('Имя')).not.toBeInTheDocument();
    expect(screen.queryByText('Фамилия')).not.toBeInTheDocument();
  });
});

describe('MyDataModal — specialization (read-only, D4)', () => {
  it('joins the specialties array with a comma and renders it read-only', async () => {
    renderModal();
    await waitForForm();
    const spec = screen.getByTestId('mydata-specialties');
    expect(spec).toHaveValue('живопись, графика');
    expect(spec).toBeDisabled();
  });

  it('hides the specialization row when has_master=false', async () => {
    renderModal(mockMyProfileStaffNoMaster);
    await waitForForm();
    expect(screen.queryByTestId('mydata-specialties')).not.toBeInTheDocument();
    expect(screen.queryByText('Специализация')).not.toBeInTheDocument();
  });

  it('does NOT send specialties in the PUT payload', async () => {
    renderModal();
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: 'Новое' },
    });
    fireEvent.click(screen.getByTestId('mydata-submit'));
    await waitFor(() => expect(mockUpdateMyProfile).toHaveBeenCalled());
    const payload = mockUpdateMyProfile.mock.calls[0][0];
    expect(payload).not.toHaveProperty('specialties');
  });
});

describe('MyDataModal — private fields', () => {
  it('renders patronymic / birth date / residence address', async () => {
    renderModal();
    await waitForForm();
    expect(screen.getByTestId('mydata-patronymic')).toHaveValue('Ивановна');
    expect(screen.getByTestId('mydata-birth_date')).toHaveValue('1990-05-13');
    expect(screen.getByTestId('mydata-residence_address')).toHaveValue('Невский пр. 28');
  });

  it('birth date opens the CalendarPopover', async () => {
    renderModal();
    await waitForForm();
    fireEvent.click(screen.getByTestId('mydata-birth_date-toggle'));
    expect(await screen.findByTestId('calendar-popover')).toBeInTheDocument();
  });
});

describe('MyDataModal — Паспорт section', () => {
  it('renders the «Паспорт» heading and its five fields', async () => {
    renderModal();
    await waitForForm();
    expect(screen.getByText('Паспорт')).toBeInTheDocument();
    expect(screen.getByTestId('mydata-birth_place')).toHaveValue('Ленинград');
    expect(screen.getByTestId('mydata-passport_series_number')).toHaveValue('40 123456');
    expect(screen.getByTestId('mydata-passport_issued_date')).toHaveValue('2010-06-01');
    expect(screen.getByTestId('mydata-passport_issued_by')).toHaveValue('УФМС по СПб');
    expect(screen.getByTestId('mydata-registration_address')).toHaveValue('ул. Рубинштейна 1');
  });

  it('renders the EXACT disabled passport-photo placeholder row (no interactivity)', async () => {
    renderModal();
    await waitForForm();
    const row = screen.getByTestId('mydata-passport-photo-placeholder');
    expect(row).toHaveTextContent(PASSPORT_PHOTO_PLACEHOLDER);
    expect(row).not.toHaveAttribute('onclick');
    // No button/input inside the placeholder row.
    expect(row.querySelector('button')).toBeNull();
    expect(row.querySelector('input')).toBeNull();
  });
});

describe('MyDataModal — portrait block', () => {
  it('previews the current avatar', async () => {
    renderModal();
    await waitForForm();
    expect(screen.getByTestId('mydata-avatar-preview')).toHaveAttribute(
      'src',
      '/api/v1/files/avatar/o.png',
    );
  });

  it('«Загрузить фото» → uploadPortrait → AuthContext.refresh()', async () => {
    renderModal();
    await waitForForm();
    const input = screen.getByTestId('mydata-portrait-file');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockUploadPortrait).toHaveBeenCalledWith(file));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('«Удалить» → updateMyProfile with avatar_url: null + refresh()', async () => {
    renderModal();
    await waitForForm();
    fireEvent.click(screen.getByTestId('mydata-portrait-delete'));

    await waitFor(() => expect(mockUpdateMyProfile).toHaveBeenCalled());
    expect(mockUpdateMyProfile.mock.calls[0][0]).toEqual(
      expect.objectContaining({ avatar_url: null }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('hides the portrait block when has_staff=false (D7)', async () => {
    renderModal(mockMyProfileNoCard);
    await waitForForm();
    expect(screen.queryByTestId('mydata-portrait-file')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mydata-avatar-preview')).not.toBeInTheDocument();
  });
});

describe('MyDataModal — submit + dirty guard', () => {
  it('submit sends only the edited private keys (omitted = keep)', async () => {
    renderModal();
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: 'Петровна' },
    });
    fireEvent.click(screen.getByTestId('mydata-submit'));

    await waitFor(() => expect(mockUpdateMyProfile).toHaveBeenCalled());
    const payload = mockUpdateMyProfile.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({ patronymic: 'Петровна' }));
    // Untouched keys are omitted, not sent as their old values.
    expect(payload).not.toHaveProperty('birth_place');
  });

  it('clearing a text field sends null (explicit clear)', async () => {
    renderModal();
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('mydata-submit'));

    await waitFor(() => expect(mockUpdateMyProfile).toHaveBeenCalled());
    expect(mockUpdateMyProfile.mock.calls[0][0]).toEqual(
      expect.objectContaining({ patronymic: null }),
    );
  });

  it('submit refreshes the AuthContext plate snapshot', async () => {
    renderModal();
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByTestId('mydata-submit'));
    await waitFor(() => expect(mockUpdateMyProfile).toHaveBeenCalled());
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('successful submit closes the modal and toasts «Данные сохранены»', async () => {
    const onClose = vi.fn();
    renderModal(mockMyProfileMaster, { onClose });
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByTestId('mydata-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith('Данные сохранены', 'success');
  });

  it('blocks required names: empty first_name → inline error, no PUT', async () => {
    renderModal(createMockMyProfile({ first_name: '', last_name: 'Середа' }));
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByTestId('mydata-submit'));
    expect(await screen.findByText('Обязательное поле')).toBeInTheDocument();
    expect(mockUpdateMyProfile).not.toHaveBeenCalled();
  });

  it('dirty close asks for confirmation; cancel keeps the modal open', async () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderModal(mockMyProfileMaster, { onClose });
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByTestId('modal-close-btn'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clean close does NOT ask for confirmation', async () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderModal(mockMyProfileMaster, { onClose });
    await waitForForm();
    fireEvent.click(screen.getByTestId('modal-close-btn'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('a failed PUT keeps the modal open and toasts the error', async () => {
    const onClose = vi.fn();
    mockUpdateMyProfile.mockRejectedValue(new Error('boom'));
    renderModal(mockMyProfileMaster, { onClose });
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByTestId('mydata-submit'));
    await waitFor(() => expect(mockUpdateMyProfile).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
  });
});

describe('MyDataModal — no-card mode (S6)', () => {
  it('shows role + private fields, hides names and specialization', async () => {
    renderModal(mockMyProfileNoCard);
    await waitForForm();
    expect(screen.getByTestId('mydata-role')).toHaveValue('admin');
    expect(screen.getByTestId('mydata-patronymic')).toBeInTheDocument();
    expect(screen.queryByTestId('mydata-first_name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mydata-specialties')).not.toBeInTheDocument();
  });

  it('private fields save normally without a card', async () => {
    renderModal(mockMyProfileNoCard);
    await waitForForm();
    fireEvent.change(screen.getByTestId('mydata-patronymic'), {
      target: { value: 'Без Карточки' },
    });
    fireEvent.click(screen.getByTestId('mydata-submit'));
    await waitFor(() => expect(mockUpdateMyProfile).toHaveBeenCalled());
    expect(mockUpdateMyProfile.mock.calls[0][0]).toEqual(
      expect.objectContaining({ patronymic: 'Без Карточки' }),
    );
    // Card names never travel in no-card mode.
    expect(mockUpdateMyProfile.mock.calls[0][0]).not.toHaveProperty('first_name');
  });
});
