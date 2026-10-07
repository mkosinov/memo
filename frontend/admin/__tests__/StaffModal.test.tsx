/**
 * StaffModal — GH #263 D10 frontend half: the role field auto-fills from the
 * anchored positions (admin > master > untouched), a manual edit wins for
 * the rest of the dialog session, and the chosen role is submitted explicitly
 * (create_user.role on create, role on edit).
 *
 * #348: the create account block is PASSWORDLESS — phone + role only.
 *
 * #414: both phone fields are the PhoneField widget; the completeness
 * validator rides the shared validate() — an incomplete CHANGED account
 * phone blocks the PATCH /users/:id BEFORE any network call (spec
 * §Форматирование, the #348 bullet), and what goes to the DB is the compact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  mockPositionMaster,
  mockPositionAdmin,
  mockPositionSmm,
  createMockStaffResponse,
} from './helpers/mockData';
import type { StaffResponse } from '@memo/api-client';

import { StaffModal, type StaffFormData } from '@/app/(main)/staff/components/StaffModal';

const POSITIONS = [mockPositionMaster, mockPositionAdmin, mockPositionSmm];

function setup(overrides: { staff?: StaffResponse | null; mode?: 'create' | 'edit' } = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <StaffModal
      mode={overrides.mode ?? 'create'}
      staff={overrides.staff ?? null}
      positions={POSITIONS}
      onSubmit={onSubmit}
      onClose={vi.fn()}
      title="Новый сотрудник"
    />,
  );
  return { onSubmit };
}

async function submit() {
  fireEvent.click(screen.getByTestId('staff-modal-save-btn'));
  await waitFor(() => expect(screen.getByTestId('staff-modal-save-btn')).toBeEnabled());
}

function roleSelect(): HTMLSelectElement {
  return screen.getByTestId('staff-role-field') as HTMLSelectElement;
}

/** Fill the mandatory person fields and submit. */
async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Имя *'), { target: { value: 'Иван' } });
  fireEvent.change(screen.getByLabelText('Фамилия *'), { target: { value: 'Петров' } });
  await submit();
}

/** Enable the create-user checkbox + fill the phone (create mode, #348:
 *  the block is passwordless — there is no password field to fill).
 *  GH #414: the field is the PhoneField widget — the RU remainder is typed
 *  as national digits; the compact '+7…' is assembled by the modal. */
function enableAccount() {
  fireEvent.click(screen.getByTestId('create-user-checkbox'));
  fireEvent.change(screen.getByLabelText('Телефон *'), { target: { value: '9990000000' } });
}

beforeEach(() => {
  // window.confirm guard — the dirty-close prompt must not block tests.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe('StaffModal role field (GH #263 D10)', () => {
  // Edit pre-fill: the select seeds from the template of the card's CURRENT
  // positions — anchored → the senior anchor; none → «— не выбрана —» (the
  // backend template decides).
  it('edit mode: select pre-fills from the card positions (master → master)', () => {
    setup({ mode: 'edit', staff: createMockStaffResponse({ position_ids: ['master'], has_user: true }) });
    expect(roleSelect().value).toBe('master');
  });

  it('edit mode: no anchored positions → empty («— не выбрана —», template decides)', () => {
    setup({ mode: 'edit', staff: createMockStaffResponse({ position_ids: ['smm'], has_user: true }) });
    expect(roleSelect().value).toBe('');
  });

  it('create mode: field appears with the account block, auto-filled by positions', () => {
    setup();
    expect(screen.queryByTestId('staff-role-field')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('position-checkbox-master'));
    enableAccount();
    expect(roleSelect().value).toBe('master');
  });

  it('senior anchor wins: master + admin → admin (create)', () => {
    setup();
    fireEvent.click(screen.getByTestId('position-checkbox-master'));
    fireEvent.click(screen.getByTestId('position-checkbox-admin'));
    enableAccount();
    expect(roleSelect().value).toBe('admin');
  });

  it('unanchored positions (СММ) do NOT touch the role (create)', () => {
    setup();
    enableAccount();
    fireEvent.click(screen.getByTestId('position-checkbox-smm'));
    expect(roleSelect().value).toBe('');
  });

  it('a manual role edit survives subsequent position toggles (dirty override, edit)', () => {
    setup({ mode: 'edit', staff: createMockStaffResponse({ position_ids: ['master'], has_user: true }) });
    expect(roleSelect().value).toBe('master');
    // Manual: admin while «мастер» is anchored.
    fireEvent.change(roleSelect(), { target: { value: 'admin' } });
    // Unanchoring the last anchor (template → none) does NOT overwrite the
    // manual choice («прочие должности роль не трогают»)…
    fireEvent.click(screen.getByTestId('position-checkbox-master'));
    expect(roleSelect().value).toBe('admin');
    // …and neither does the next ANCHORED change: the manual choice is
    // tracked (`roleDirty`) and wins for the rest of the dialog session
    // («ручная правка остаётся»). The flag resets only on open/submit.
    fireEvent.click(screen.getByTestId('position-checkbox-master'));
    expect(roleSelect().value).toBe('admin');
  });

  it('create: role submits inside create_user — and NEVER at the top level', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByTestId('position-checkbox-master'));
    enableAccount();
    await fillAndSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const data = onSubmit.mock.calls[0][0] as StaffFormData;
    expect(data.create_user).toMatchObject({ phone: '+79990000000', role: 'master' });
    expect(data.role).toBeUndefined();
  });

  it('create: no account → create_user stays false, role is not sent', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByTestId('position-checkbox-master'));
    await fillAndSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const data = onSubmit.mock.calls[0][0] as StaffFormData;
    expect(data.create_user).toBe(false);
    expect(data.role).toBeUndefined();
  });

  it('edit: template-init role submits explicitly at the top level of StaffFormData', async () => {
    const staff = createMockStaffResponse({ position_ids: ['master'], has_user: true });
    const { onSubmit } = setup({ mode: 'edit', staff });
    await fillAndSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const data = onSubmit.mock.calls[0][0] as StaffFormData;
    expect(data.role).toBe('master');
  });

  it('edit: manual override rides into the payload (ручная правка остаётся)', async () => {
    const staff = createMockStaffResponse({ position_ids: ['master'], has_user: true });
    const { onSubmit } = setup({ mode: 'edit', staff });
    fireEvent.change(roleSelect(), { target: { value: 'admin' } });
    await fillAndSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const data = onSubmit.mock.calls[0][0] as StaffFormData;
    expect(data.role).toBe('admin');
  });
});

// ─── GH #414: PhoneField in both phone fields (spec §Форматирование, #348) ──

describe('StaffModal phone fields (GH #414)', () => {
  const INCOMPLETE_MSG = 'Проверьте номер телефона — возможно, он введён не полностью';
  const NO_COUNTRY_MSG = 'Выберите страну из списка';
  const REQUIRED_MSG = 'Обязательное поле';

  /** An ACTIVE account on the edit card — the #348 PATCH-gate target. */
  const ACCOUNTED = createMockStaffResponse({
    position_ids: ['master'],
    has_user: true,
    account: {
      id: 'u-1',
      phone: '+79991234567',
      role: 'master',
      password_is_set: true,
      is_active: true,
      link_expires_at: null,
    },
  });

  function setupAccounted() {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onPatchPhone = vi.fn().mockResolvedValue(undefined);
    render(
      <StaffModal
        mode="edit"
        staff={ACCOUNTED}
        positions={POSITIONS}
        onSubmit={onSubmit}
        onPatchPhone={onPatchPhone}
        onClose={vi.fn()}
        title="Редактирование сотрудника"
      />,
    );
    return { onSubmit, onPatchPhone };
  }

  /** The edit-mode account phone widget input. */
  function accountPhoneInput(): HTMLInputElement {
    return screen.getByTestId('staff-account-phone-input') as HTMLInputElement;
  }

  /** The create-mode account phone widget input. */
  function createPhoneInput(): HTMLInputElement {
    return screen.getByTestId('staff-phone-input') as HTMLInputElement;
  }

  it('edit: the account phone is the widget, initialized from the stored compact (RU, grouped)', () => {
    setupAccounted();
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
    expect(accountPhoneInput().value).toBe('999 123-45-67');
  });

  it('edit: a CHANGED incomplete account phone blocks the PATCH BEFORE it is sent (#348 gate)', async () => {
    const { onSubmit, onPatchPhone } = setupAccounted();
    fireEvent.change(accountPhoneInput(), { target: { value: '9991234' } });
    await submit();
    expect(screen.getByText(INCOMPLETE_MSG)).toBeInTheDocument();
    // validate() runs first — NEITHER the account PATCH nor the card PUT left.
    expect(onPatchPhone).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('edit: a CHANGED out-of-list account phone blocks with «Выберите страну из списка»', async () => {
    const { onSubmit, onPatchPhone } = setupAccounted();
    fireEvent.paste(accountPhoneInput(), {
      clipboardData: { getData: () => '+1 555 123 45 67' },
    });
    await submit();
    expect(screen.getByText(NO_COUNTRY_MSG)).toBeInTheDocument();
    expect(onPatchPhone).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('edit: a CLEARED account phone blocks with the required error (staff phone is mandatory)', async () => {
    const { onSubmit, onPatchPhone } = setupAccounted();
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    await submit();
    expect(screen.getAllByText(REQUIRED_MSG).length).toBeGreaterThan(0);
    expect(onPatchPhone).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('edit: a CHANGED COMPLETE account phone PATCHes the compact, then saves the card', async () => {
    const { onSubmit, onPatchPhone } = setupAccounted();
    fireEvent.change(accountPhoneInput(), { target: { value: '9990003344' } });
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onPatchPhone).toHaveBeenCalledTimes(1);
    // The compact goes to PATCH /users/:id — and it fires BEFORE the card PUT.
    expect(onPatchPhone).toHaveBeenCalledWith('u-1', '+79990003344');
    expect(onPatchPhone.mock.invocationCallOrder[0]).toBeLessThan(onSubmit.mock.invocationCallOrder[0]);
  });

  it('edit: a PRISTINE account phone sends no PATCH (the stored value stays as is)', async () => {
    const { onSubmit, onPatchPhone } = setupAccounted();
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onPatchPhone).not.toHaveBeenCalled();
  });

  it('create: an incomplete account phone blocks the account creation (and the card save)', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByTestId('create-user-checkbox'));
    fireEvent.change(createPhoneInput(), { target: { value: '9991234' } });
    await fillAndSubmit();
    expect(screen.getByText(INCOMPLETE_MSG)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('create: an out-of-list pasted number blocks with «Выберите страну из списка»', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByTestId('create-user-checkbox'));
    fireEvent.paste(createPhoneInput(), {
      clipboardData: { getData: () => '+1 555 123 45 67' },
    });
    await fillAndSubmit();
    expect(screen.getByText(NO_COUNTRY_MSG)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('create: an EMPTY account phone keeps the plain required error (not the completeness one)', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByTestId('create-user-checkbox'));
    await fillAndSubmit();
    expect(screen.getByText(REQUIRED_MSG)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('create: a COMPLETE account phone is submitted as the compact in create_user', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByTestId('create-user-checkbox'));
    fireEvent.change(createPhoneInput(), { target: { value: '9990003344' } });
    await fillAndSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const data = onSubmit.mock.calls[0][0] as StaffFormData;
    expect(data.create_user).toMatchObject({ phone: '+79990003344' });
  });
});
