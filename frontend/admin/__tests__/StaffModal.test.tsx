/**
 * StaffModal — GH #263 D10 frontend half: the role field auto-fills from the
 * anchored positions (admin > master > untouched), a manual edit wins for the
 * rest of the dialog session, and the chosen role is submitted explicitly
 * (create_user.role on create, role on edit).
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

/** Enable the create-user checkbox + fill phone/password (create mode). */
function enableAccount() {
  fireEvent.click(screen.getByTestId('create-user-checkbox'));
  fireEvent.change(screen.getByLabelText('Телефон *'), { target: { value: '+79990000000' } });
  fireEvent.change(screen.getByLabelText('Пароль *'), { target: { value: 'secret123' } });
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
