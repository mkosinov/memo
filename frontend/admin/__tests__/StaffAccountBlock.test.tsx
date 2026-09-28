/**
 * StaffModal «Учётка» block + link dialog (GH #348 Task 7, spec §6).
 *
 * S1: create — the block is phone + role (D10 template/manual) and NO
 *     password field; the payload carries create_user {phone, role?} only.
 * S5: edit — the phone is editable (saved via a separate patchUser call),
 *     PHONE_TAKEN → inline «Этот телефон уже занят».
 * S6: block states — active (buttons + live-link status), archived
 *     (read-only «Учётка архивирована»), absent (block hidden).
 * S3: «Сбросить пароль»/«Выдать ссылку» by password_is_set; disabled while
 *     issuing; the link dialog shows the assembled URL + expiry + hint,
 *     with error/retry when issuance fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { StaffResponse } from '@memo/api-client';
import {
  mockPositionMaster,
  createMockStaffResponse,
} from './helpers/mockData';

import { StaffModal, type StaffFormData } from '@/app/(main)/staff/components/StaffModal';

const POSITIONS = [mockPositionMaster];

/** An active account with a password — «Сбросить пароль» state. */
function staffWithAccount(overrides: Record<string, unknown> = {}): StaffResponse {
  return createMockStaffResponse({
    has_user: true,
    account: {
      id: 'u-1',
      phone: '+79990001122',
      role: 'master',
      password_is_set: true,
      is_active: true,
      link_expires_at: null,
      ...overrides,
    },
  });
}

function setupEdit(staff: StaffResponse) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onPatchPhone = vi.fn().mockResolvedValue(undefined);
  const onIssueLink = vi.fn().mockResolvedValue({ token: 'raw-token-abc', expires_at: '2026-09-29T10:00:00Z' });
  render(
    <StaffModal
      mode="edit"
      staff={staff}
      positions={POSITIONS}
      onSubmit={onSubmit}
      onPatchPhone={onPatchPhone}
      onIssueLink={onIssueLink}
      onClose={vi.fn()}
      title="Редактирование сотрудника"
    />,
  );
  return { onSubmit, onPatchPhone, onIssueLink };
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe('edit: «Учётка» block states (S6)', () => {
  it('active account: shows the block with the phone and the reset button', () => {
    setupEdit(staffWithAccount());
    expect(screen.getByText('Учётка')).toBeInTheDocument();
    expect((screen.getByLabelText('Телефон *') as HTMLInputElement).value).toBe('+79990001122');
    expect(screen.getByTestId('issue-link-btn')).toHaveTextContent('Сбросить пароль');
  });

  it('passwordless account: the button says «Выдать ссылку», hint «Пароль ещё не установлен»', () => {
    setupEdit(staffWithAccount({ password_is_set: false }));
    expect(screen.getByTestId('issue-link-btn')).toHaveTextContent('Выдать ссылку');
    expect(screen.getByText('Пароль ещё не установлен')).toBeInTheDocument();
  });

  it('archived account (is_active=false): read-only — «Учётка архивирована», no edit/no buttons', () => {
    setupEdit(staffWithAccount({ is_active: false }));
    expect(screen.getByText('Учётка архивирована')).toBeInTheDocument();
    expect(screen.queryByLabelText('Телефон *')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-link-btn')).not.toBeInTheDocument();
    // The phone is still VISIBLE (read-only projection), just not editable.
    expect(screen.getByText('+79990001122')).toBeInTheDocument();
  });

  it('no account (account=null): the block is hidden entirely', () => {
    setupEdit(createMockStaffResponse({ has_user: false, account: null }));
    expect(screen.queryByText('Учётка')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-link-btn')).not.toBeInTheDocument();
  });

  it('live link: status line «Ссылка выдана, действует до …» with local time', () => {
    setupEdit(staffWithAccount({ link_expires_at: '2026-09-29T10:00:00Z' }));
    const line = screen.getByTestId('live-link-status');
    expect(line.textContent).toMatch(/^Ссылка выдана, действует до /);
    // Local time of the ISO instant — the exact text depends on the TZ, so
    // assert the parsed date renders (digits + time separators).
    expect(line.textContent).toMatch(/\d/);
  });
});

describe('edit: phone save via patchUser (S5)', () => {
  it('submitting a changed phone calls onPatchPhone with the account id and the phone', async () => {
    const { onPatchPhone, onSubmit } = setupEdit(staffWithAccount());
    fireEvent.change(screen.getByLabelText('Телефон *'), { target: { value: '+79990003344' } });
    fireEvent.click(screen.getByTestId('staff-modal-save-btn'));
    await waitFor(() => expect(onPatchPhone).toHaveBeenCalledWith('u-1', '+79990003344'));
    // The card itself is saved through onSubmit as before.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it('unchanged phone: no separate patch call', async () => {
    const { onPatchPhone } = setupEdit(staffWithAccount());
    fireEvent.click(screen.getByTestId('staff-modal-save-btn'));
    await waitFor(() => expect(onPatchPhone).not.toHaveBeenCalled());
  });

  it('PHONE_TAKEN rejection renders the inline error and keeps the modal open', async () => {
    const onClose = vi.fn();
    const onPatchPhone = vi.fn().mockRejectedValue(
      Object.assign(new Error('taken'), { code: 'PHONE_TAKEN' }),
    );
    render(
      <StaffModal
        mode="edit"
        staff={staffWithAccount()}
        positions={POSITIONS}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onPatchPhone={onPatchPhone}
        onIssueLink={vi.fn()}
        onClose={onClose}
        title="Ред."
      />,
    );
    fireEvent.change(screen.getByLabelText('Телефон *'), { target: { value: '+79990009999' } });
    fireEvent.click(screen.getByTestId('staff-modal-save-btn'));
    await waitFor(() => expect(screen.getByText('Этот телефон уже занят')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('PHONE_INVALID renders inline too (same §5 domain class), modal open', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onPatchPhone = vi.fn().mockRejectedValue(
      Object.assign(new Error('invalid'), { code: 'PHONE_INVALID' }),
    );
    render(
      <StaffModal
        mode="edit"
        staff={staffWithAccount()}
        positions={POSITIONS}
        onSubmit={onSubmit}
        onPatchPhone={onPatchPhone}
        onIssueLink={vi.fn()}
        onClose={vi.fn()}
        title="Ред."
      />,
    );
    fireEvent.change(screen.getByLabelText('Телефон *'), { target: { value: '123' } });
    fireEvent.click(screen.getByTestId('staff-modal-save-btn'));
    await waitFor(() => expect(screen.getByText('Некорректный номер телефона')).toBeInTheDocument());
    // The card save never ran — the phone must be fixed first.
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('edit: issue link button (S3)', () => {
  it('calls onIssueLink with the account id and opens the dialog with the assembled URL', async () => {
    const { onIssueLink } = setupEdit(staffWithAccount());
    fireEvent.click(screen.getByTestId('issue-link-btn'));
    await waitFor(() => expect(onIssueLink).toHaveBeenCalledWith('u-1'));
    const input = await screen.findByTestId('link-url-field');
    expect((input as HTMLInputElement).value).toBe(
      `${window.location.origin}/password-setup#token=raw-token-abc`,
    );
  });

  it('the button is disabled while the request is in flight', async () => {
    let resolveIssue: (v: { token: string; expires_at: string }) => void = () => {};
    const onIssueLink = vi.fn().mockReturnValue(
      new Promise((res) => { resolveIssue = res; }),
    );
    render(
      <StaffModal
        mode="edit"
        staff={staffWithAccount()}
        positions={POSITIONS}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onIssueLink={onIssueLink}
        onClose={vi.fn()}
        title="Ред."
      />,
    );
    const btn = screen.getByTestId('issue-link-btn');
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    resolveIssue({ token: 'tok', expires_at: '2026-09-29T10:00:00Z' });
    await waitFor(() => expect(screen.getByTestId('link-url-field')).toBeInTheDocument());
  });

  it('failed issuance: the dialog shows the error and «Повторить»', async () => {
    const onIssueLink = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
      token: 'tok-2',
      expires_at: '2026-09-29T10:00:00Z',
    });
    render(
      <StaffModal
        mode="edit"
        staff={staffWithAccount()}
        positions={POSITIONS}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onIssueLink={onIssueLink}
        onClose={vi.fn()}
        title="Ред."
      />,
    );
    fireEvent.click(screen.getByTestId('issue-link-btn'));
    await waitFor(() => expect(screen.getByTestId('link-dialog-error')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('link-dialog-retry-btn'));
    await waitFor(() => expect(screen.getByTestId('link-url-field')).toBeInTheDocument());
    expect(onIssueLink).toHaveBeenCalledTimes(2);
  });

  // Stacked layers (review): ONE Escape press must close the TOPMOST layer
  // alone — the link dialog consumes the keystroke, the modal stays put.
  it('Escape closes only the link dialog — the modal underneath stays open', async () => {
    const onClose = vi.fn();
    const onIssueLink = vi.fn().mockResolvedValue({
      token: 'raw-token-abc',
      expires_at: '2026-09-29T10:00:00Z',
    });
    render(
      <StaffModal
        mode="edit"
        staff={staffWithAccount()}
        positions={POSITIONS}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onIssueLink={onIssueLink}
        onClose={onClose}
        title="Ред."
      />,
    );
    fireEvent.click(screen.getByTestId('issue-link-btn'));
    await screen.findByTestId('link-url-field');

    fireEvent.keyDown(window, { key: 'Escape' });

    // The dialog consumed the keystroke; the modal's close was NOT invoked.
    expect(screen.queryByTestId('link-url-field')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('create: passwordless account block (S1)', () => {
  function setupCreate() {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onIssueLink = vi.fn().mockResolvedValue({ token: 'tok', expires_at: '2026-09-29T10:00:00Z' });
    render(
      <StaffModal
        mode="create"
        staff={null}
        positions={POSITIONS}
        onSubmit={onSubmit}
        onIssueLink={onIssueLink}
        onClose={vi.fn()}
        title="Новый сотрудник"
      />,
    );
    return { onSubmit, onIssueLink };
  }

  it('NO password field; create_user carries {phone, role?} only', async () => {
    const { onSubmit } = setupCreate();
    fireEvent.click(screen.getByTestId('create-user-checkbox'));
    expect(screen.queryByLabelText('Пароль *')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Имя *'), { target: { value: 'Иван' } });
    fireEvent.change(screen.getByLabelText('Фамилия *'), { target: { value: 'Петров' } });
    fireEvent.change(screen.getByLabelText('Телефон *'), { target: { value: '+79990007788' } });
    fireEvent.click(screen.getByTestId('staff-modal-save-btn'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const data = onSubmit.mock.calls[0][0] as StaffFormData;
    expect(data.create_user).toEqual({ phone: '+79990007788' });
    expect(data.create_user).not.toHaveProperty('password');
  });

  it('the checkbox label no longer mentions a password', () => {
    setupCreate();
    fireEvent.click(screen.getByTestId('create-user-checkbox'));
    expect(screen.getByTestId('create-user-checkbox-label')).toHaveTextContent('Создать учётку');
    // The whole create block carries NO password field label (#348 §6):
    // neither the checkbox nor any input under it.
    expect(screen.getByTestId('create-user-checkbox-label').textContent).not.toContain('Пароль');
    expect(screen.queryByLabelText(/^Пароль/)).not.toBeInTheDocument();
  });
});
