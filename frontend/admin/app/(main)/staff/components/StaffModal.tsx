'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import type { StaffResponse, PositionResponse } from '@memo/api-client';
import { Modal } from '@/app/components/shared/modal/Modal';
import {
  PhoneField,
  phoneCompact,
  phoneIsComplete,
  type PhoneFieldValue,
} from '@/app/components/shared/phone/PhoneField';
import { parseStoredPhone } from '@/app/components/shared/phone/format';
import {
  PasswordLinkDialog,
  formatLinkExpiry,
  type IssuedPasswordLink,
} from './PasswordLinkDialog';

/**
 * Structured form payload the StaffModal hands to its parent (StaffTable),
 * which maps it onto the typed wire schemas (StaffCreate / StaffUpdate).
 *
 * - `master`: null = no section (create) / remove section (edit, D7 — blocked
 *   by activities server-side); a payload = upsert. `archived` is the schedule
 *   flag (D3/Gap A) — sent in edit to toggle the section's archive without
 *   deleting the row; omitted in create (a fresh section is born active).
 * - `create_user`: create-only (D6) — `{phone, role?}` or false. NO PASSWORD
 *   since #348 (spec §6): the account is born passwordless; the owner sets
 *   the password via the one-time link the admin hands over.
 *   `role` (GH #263 D10) is the manual override for the linked account.
 * - `role`: edit-only top-level override (StaffUpdate.role) — sent only when
 *   the field has a value; absent → the backend position template decides.
 */
export interface StaffFormData {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  sort_order: number;
  position_ids: string[];
  master: { specialty: string; color: string; archived?: boolean } | null;
  create_user: { phone: string; role?: 'admin' | 'master' } | false;
  role?: 'admin' | 'master';
}

export interface StaffModalProps {
  mode: 'create' | 'edit';
  /** The card being edited (edit mode); null in create mode. */
  staff: StaffResponse | null;
  /** Positions dictionary (D4) — checkbox list. */
  positions: PositionResponse[];
  onSubmit: (data: StaffFormData) => Promise<void>;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /**
   * #348 (edit, S5): save the account's phone as a SEPARATE request via
   * `patchUser(account.id, {phone})` — distinct from the card's own PUT.
   * The modal calls it (only when the phone changed) BEFORE onSubmit; a
   * PHONE_TAKEN / PHONE_INVALID rejections render inline and keep the
   * modal open (§5 phone-edit domain codes).
   */
  onPatchPhone?: (userId: string, phone: string) => Promise<void>;
  /**
   * #348 (S1/S3): issue a one-time password-setup link via
   * `issuePasswordLink(account.id)` → `{token, expires_at}`. Also used by
   * the post-create handover (the retry of a failed first issuance).
   */
  onIssueLink?: (userId: string) => Promise<IssuedPasswordLink>;
}

const TEXT_INPUT =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors';

// GH #414 (spec §Форматирование, валидация, хранение): the two messages of
// the completeness validator — applied to a CHANGED number only. Here they
// ride the shared validate() (the #348 bullet): validate() runs FIRST in
// handleSubmit, so an invalid account phone gates the PATCH /users/:id, the
// account creation and the card PUT alike — no network call ever leaves.
const PHONE_NO_COUNTRY_ERROR = 'Выберите страну из списка';
const PHONE_INCOMPLETE_ERROR = 'Проверьте номер телефона — возможно, он введён не полностью';

/** Widget state from a stored string — pristine until the user edits it
 *  (spec §Инициализация существующих значений; the untouched value never
 *  re-canonicalizes and never hits the completeness validator). */
function storedToPhoneValue(stored: string | null | undefined): PhoneFieldValue {
  return { ...parseStoredPhone(stored), pristine: true };
}

/** Fixed position-id anchors (D4 #266) → role (GH #263 D10). */
const POSITION_ROLE_TEMPLATE: Record<string, 'admin' | 'master'> = {
  admin: 'admin',
  master: 'master',
};

/** Highest template role among position ids (admin > master) — mirrors the
 *  backend `_template_role`; null = no anchor present (keep current role). */
function templateRoleOf(positionIds: string[]): 'admin' | 'master' | null {
  if (positionIds.some((id) => POSITION_ROLE_TEMPLATE[id] === 'admin')) return 'admin';
  if (positionIds.some((id) => POSITION_ROLE_TEMPLATE[id] === 'master')) return 'master';
  return null;
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
      {children}
    </label>
  );
}

/**
 * Role select (GH #263 D10) — auto-filled from the position template,
 * manually editable. Empty value = «не выбрано» → no explicit role in the
 * payload and the backend template decides.
 */
function RoleField({
  baseId,
  role,
  onChange,
}: {
  baseId: string;
  role: 'admin' | 'master' | '';
  onChange: (role: 'admin' | 'master' | '') => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${baseId}-role`}>Роль учётки</Label>
      <select
        id={`${baseId}-role`}
        data-testid="staff-role-field"
        value={role}
        onChange={(e) => onChange(e.target.value as 'admin' | 'master' | '')}
        className={TEXT_INPUT}
        style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
      >
        <option value="">— не выбрана —</option>
        <option value="admin">Администратор</option>
        <option value="master">Мастер</option>
      </select>
      <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
        Подставляется по должностям (админ &gt; мастер); можно изменить вручную.
      </span>
    </div>
  );
}

export function StaffModal({
  mode,
  staff,
  positions,
  onSubmit,
  onPatchPhone,
  onIssueLink,
  onClose,
  title,
  subtitle,
}: StaffModalProps) {
  const baseId = useId();

  // ─── Person fields ──────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState(staff?.first_name ?? '');
  const [lastName, setLastName] = useState(staff?.last_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(staff?.avatar_url ?? '');

  // ─── Positions (M2M checkboxes, D4) ─────────────────────────────────────
  const [positionIds, setPositionIds] = useState<string[]>(staff?.position_ids ?? []);

  // ─── Role (GH #263 D10) ──────────────────────────────────────────────────
  // Manual override for the linked account. Auto-filled from the position
  // template (admin > master — mirrors the backend `_template_role`); a
  // MANUAL choice (`roleDirty`) is never stomped by later template runs
  // within this dialog session («ручная правка остаётся»); the flag resets
  // on open (fresh mount) and on successful submit. Empty string = no
  // explicit role → the backend template decides.
  const [role, setRole] = useState<'admin' | 'master' | ''>(
    () => templateRoleOf(staff?.position_ids ?? []) ?? '',
  );
  const [roleDirty, setRoleDirty] = useState(false);

  // ─── Master section (D5) ────────────────────────────────────────────────
  // `masterEnabled` = the section is present. Edit pre-fills from staff.master;
  // create starts off (toggled by «Сделать мастером»).
  const [masterEnabled, setMasterEnabled] = useState<boolean>(
    mode === 'edit' ? staff?.master != null : false,
  );
  const [specialty, setSpecialty] = useState(staff?.master?.specialty ?? '');
  const [color, setColor] = useState(staff?.master?.color ?? '#5B8C7A');
  // Schedule flag of an EXISTING section (D3). Edit-only; create defaults active.
  const [masterArchived, setMasterArchived] = useState<boolean>(staff?.master?.archived ?? false);

  // ─── Account (D6 create / #348 edit block) ──────────────────────────────
  // create: the passwordless checkbox section — phone + role, NO password
  // (#348 spec §6). edit: the «Учётка» block over staff.account —
  // null = hidden; is_active=false = read-only («Учётка архивирована»).
  // GH #414: BOTH phone fields are the PhoneField widget `{country, national,
  // pristine}` — parsed from the stored string on open; a pristine value
  // saves verbatim (no PATCH), a CHANGED value is validated for completeness
  // and stored as the compact «+<код><нац.>».
  const account = mode === 'edit' ? staff?.account ?? null : null;
  const [createUserEnabled, setCreateUserEnabled] = useState(false);
  const [phone, setPhone] = useState<PhoneFieldValue>(() => storedToPhoneValue(''));
  const [accountPhone, setAccountPhone] = useState<PhoneFieldValue>(
    () => storedToPhoneValue(account?.phone),
  );
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [issuingLink, setIssuingLink] = useState(false);

  // The one-time link dialog state (#348 spec §6): a live issue response,
  // or an issuance error with «Повторить» (the account keeps waiting).
  const [linkDialog, setLinkDialog] = useState<{
    link: IssuedPasswordLink | null;
    error: string | null;
  } | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const markDirty = useCallback(() => setIsDirty(true), []);

  // Every widget edit flips the dirty flag; the account field also drops a
  // stale inline (server) error — re-validation happens in validate().
  const handlePhoneChange = useCallback(
    (value: PhoneFieldValue) => {
      setPhone(value);
      markDirty();
    },
    [markDirty],
  );

  const handleAccountPhoneChange = useCallback(
    (value: PhoneFieldValue) => {
      setAccountPhone(value);
      setPhoneError(null);
      markDirty();
    },
    [markDirty],
  );

  const handleRoleChange = useCallback(
    (next: 'admin' | 'master' | '') => {
      setRole(next);
      setRoleDirty(true);
      markDirty();
    },
    [markDirty],
  );

  const togglePosition = useCallback((id: string) => {
    markDirty();
    const next = positionIds.includes(id)
      ? positionIds.filter((p) => p !== id)
      : [...positionIds, id];
    setPositionIds(next);
    // D10: re-run the template on every anchored set change — but a MANUAL
    // role choice wins for the rest of the dialog session («ручная правка
    // остаётся»). No anchor → keep the current value («прочие должности
    // роль не трогают»).
    const suggested = templateRoleOf(next);
    if (suggested && !roleDirty) setRole(suggested);
  }, [markDirty, positionIds, roleDirty]);

  // ─── Link issuance (S3 button / S1 retry) ───────────────────────────────
  const issueFor = useCallback(
    async (userId: string) => {
      if (!onIssueLink) return;
      setIssuingLink(true);
      try {
        const link = await onIssueLink(userId);
        setLinkDialog({ link, error: null });
      } catch (err) {
        setLinkDialog({
          link: null,
          error:
            err instanceof Error && err.message
              ? err.message
              : 'Не удалось выдать ссылку',
        });
      } finally {
        setIssuingLink(false);
      }
    },
    [onIssueLink],
  );

  const handleIssueLink = useCallback(() => {
    if (!account) return;
    void issueFor(account.id);
  }, [account, issueFor]);

  const validate = useCallback((): boolean => {
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.first_name = 'Обязательное поле';
    if (!lastName.trim()) next.last_name = 'Обязательное поле';
    if (masterEnabled) {
      // D5: specialty + color required for a master.
      if (!specialty.trim()) next.specialty = 'Обязательное поле';
      if (!color.trim()) next.color = 'Обязательное поле';
    }
    // GH #414 (spec §Форматирование — the #348 bullet): the completeness
    // validator of BOTH phone fields rides the shared validate() — it runs
    // before any network call and thereby gates the account PATCH, the
    // account creation and the card PUT. Empty stays the screen's own
    // required logic (the staff phone is mandatory); completeness applies
    // to a CHANGED number only (pristine values are never re-validated).
    if (mode === 'create' && createUserEnabled) {
      if (phone.national === '') next.phone = 'Обязательное поле';
      else if (phone.country === null) next.phone = PHONE_NO_COUNTRY_ERROR;
      else if (!phoneIsComplete(phone)) next.phone = PHONE_INCOMPLETE_ERROR;
    }
    if (mode === 'edit' && account !== null && account.is_active && !accountPhone.pristine) {
      if (accountPhone.national === '') next.account_phone = 'Обязательное поле';
      else if (accountPhone.country === null) next.account_phone = PHONE_NO_COUNTRY_ERROR;
      else if (!phoneIsComplete(accountPhone)) next.account_phone = PHONE_INCOMPLETE_ERROR;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [
    firstName,
    lastName,
    masterEnabled,
    specialty,
    color,
    mode,
    createUserEnabled,
    phone,
    account,
    accountPhone,
  ]);

  const handleSubmit = async () => {
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      // #348 (S5): the account phone is a SEPARATE write — PATCH /users/:id,
      // distinct from the card's own PUT. Only when the CHANGED number's
      // compact actually differs from the stored string (a pristine field,
      // or an edit that lands back on the stored compact, sends nothing);
      // the compact «+<код><нац.>» is what goes to the DB (GH #414). The
      // §5 domain codes (PHONE_TAKEN / PHONE_INVALID) render inline
      // and abort the save.
      const accountCompact = accountPhone.pristine ? null : phoneCompact(accountPhone);
      if (
        mode === 'edit' &&
        account !== null &&
        account.is_active &&
        onPatchPhone &&
        accountCompact !== null &&
        accountCompact !== account.phone
      ) {
        try {
          await onPatchPhone(account.id, accountCompact);
          setPhoneError(null);
        } catch (err) {
          // §5 phone-edit domain codes render INLINE (the admin fixes the
          // field right there); anything else rethrows to the caller's toast.
          const code = (err as { code?: string }).code;
          if (code === 'PHONE_TAKEN') {
            setPhoneError('Этот телефон уже занят');
            return; // modal stays open, inline error
          }
          if (code === 'PHONE_INVALID') {
            setPhoneError('Некорректный номер телефона');
            return;
          }
          setPhoneError(null);
          throw err;
        }
      }
      const master = masterEnabled
        ? {
            specialty: specialty.trim(),
            color: color.trim(),
            // Edit toggles the schedule flag explicitly; create omits it (born active).
            ...(mode === 'edit' ? { archived: masterArchived } : {}),
          }
        : null;
      const data: StaffFormData = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        avatar_url: avatarUrl.trim() === '' ? null : avatarUrl.trim(),
        sort_order: staff?.sort_order ?? 0,
        position_ids: positionIds,
        master,
        create_user:
          mode === 'create' && createUserEnabled
            ? {
                // GH #414: the compact «+<код><нац.>» — validate() above
                // guarantees a complete bound number here.
                // #348: passwordless — {phone, role?} only.
                // D10: explicit role only when set — absent lets the backend
                // template decide.
                phone: phoneCompact(phone),
                ...(role !== '' ? { role } : {}),
              }
            : false,
        // Edit-only top-level override (StaffUpdate.role); same rule.
        ...(mode === 'edit' && role !== '' ? { role } : {}),
      };
      await onSubmit(data);
      onClose();
    } catch {
      // Toast handled by the caller.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = useCallback(() => {
    if (isDirty && !window.confirm('Есть несохранённые изменения. Закрыть?')) return;
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  const errorEl = (key: string) =>
    errors[key] ? (
      <span className="text-xs" style={{ color: 'var(--danger)' }}>
        {errors[key]}
      </span>
    ) : null;

  return (
    <div className="fixed inset-0 z-[var(--z-popover)] flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <Modal
        title={title}
        context={subtitle}
        onClose={handleClose}
        footer={
          <div className="flex justify-end gap-2">
            <button
              data-testid="staff-modal-cancel-btn"
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg border transition-colors"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              Отмена
            </button>
            <button
              data-testid="staff-modal-save-btn"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {isSubmitting ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        }
      >
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-5">
          {/* ── Основные данные ── */}
          <section className="space-y-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${baseId}-first_name`}>Имя *</Label>
              <input
                id={`${baseId}-first_name`}
                type="text"
                value={firstName}
                onChange={(e) => { setFirstName(e.target.value); markDirty(); }}
                placeholder="Иван"
                className={TEXT_INPUT}
                style={{ borderColor: errors.first_name ? 'var(--danger)' : 'var(--line)', color: 'var(--ink)' }}
              />
              {errorEl('first_name')}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${baseId}-last_name`}>Фамилия *</Label>
              <input
                id={`${baseId}-last_name`}
                type="text"
                value={lastName}
                onChange={(e) => { setLastName(e.target.value); markDirty(); }}
                placeholder="Иванов"
                className={TEXT_INPUT}
                style={{ borderColor: errors.last_name ? 'var(--danger)' : 'var(--line)', color: 'var(--ink)' }}
              />
              {errorEl('last_name')}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${baseId}-avatar_url`}>Аватар URL</Label>
              <input
                id={`${baseId}-avatar_url`}
                type="text"
                value={avatarUrl ?? ''}
                onChange={(e) => { setAvatarUrl(e.target.value); markDirty(); }}
                placeholder="https://..."
                className={TEXT_INPUT}
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              />
            </div>
          </section>

          {/* ── Должности (D4) ── */}
          <section>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--ink-light)' }}>
              Должности
            </div>
            {positions.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--ink-light)' }}>Словарь должностей пуст.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {positions.map((p) => {
                  const cbId = `${baseId}-pos-${p.id}`;
                  const checked = positionIds.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        id={cbId}
                        type="checkbox"
                        data-testid={`position-checkbox-${p.id}`}
                        checked={checked}
                        onChange={() => togglePosition(p.id)}
                        className="w-4 h-4 rounded border-gray-300 accent-[var(--brand)] cursor-pointer"
                      />
                      <span className="text-sm" style={{ color: 'var(--ink)' }}>{p.title}</span>
                      {p.is_system && (
                        <span className="text-xs" style={{ color: 'var(--ink-light)' }}>(встроенная)</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Роль учётки (GH #263 D10, edit) ── */}
          {/* Edit mode: the account block is create-only (D6), but the role
              override still applies — PUT carries `role` and the backend
              templates the linked account. Sits next to the positions it
              derives from. */}
          {mode === 'edit' && (
            <section className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
              <RoleField baseId={baseId} role={role} onChange={handleRoleChange} />
            </section>
          )}

          {/* ── Мастер-секция (D5) ── */}
          <section className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                id={`${baseId}-master-toggle`}
                type="checkbox"
                data-testid="master-section-checkbox"
                checked={masterEnabled}
                onChange={(e) => { setMasterEnabled(e.target.checked); markDirty(); }}
                className="w-4 h-4 rounded border-gray-300 accent-[var(--brand)] cursor-pointer"
              />
              <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                {mode === 'create' ? 'Сделать мастером (специальность + цвет)' : 'Мастер (расписание)'}
              </span>
            </label>

            {masterEnabled && (
              <div className="mt-3 space-y-3 pl-6">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${baseId}-specialty`}>Специальность *</Label>
                  <input
                    id={`${baseId}-specialty`}
                    type="text"
                    value={specialty}
                    onChange={(e) => { setSpecialty(e.target.value); markDirty(); }}
                    placeholder="живопись, керамика"
                    className={TEXT_INPUT}
                    style={{ borderColor: errors.specialty ? 'var(--danger)' : 'var(--line)', color: 'var(--ink)' }}
                  />
                  {errorEl('specialty')}
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${baseId}-color`}>Цвет *</Label>
                  <input
                    id={`${baseId}-color`}
                    type="text"
                    value={color}
                    onChange={(e) => { setColor(e.target.value); markDirty(); }}
                    placeholder="#5B8C7A"
                    className={TEXT_INPUT}
                    style={{ borderColor: errors.color ? 'var(--danger)' : 'var(--line)', color: 'var(--ink)' }}
                  />
                  {errorEl('color')}
                </div>
                {/* Edit-only: toggle the schedule archive of an existing section
                    (Gap A — archives WITHOUT deleting the row, so history keeps
                    specialty/color, D7). */}
                {mode === 'edit' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      id={`${baseId}-master-archived`}
                      type="checkbox"
                      data-testid="master-archived-checkbox"
                      checked={masterArchived}
                      onChange={(e) => { setMasterArchived(e.target.checked); markDirty(); }}
                      className="w-4 h-4 rounded border-gray-300 accent-[var(--brand)] cursor-pointer"
                    />
                    <span className="text-sm" style={{ color: 'var(--ink)' }}>
                      Архивировать мастера (убрать из расписания)
                    </span>
                  </label>
                )}
              </div>
            )}
          </section>

          {/* ── Учётка (D6, create — passwordless #348) ── */}
          {mode === 'create' && (
            <section className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  id={`${baseId}-create-user`}
                  type="checkbox"
                  data-testid="create-user-checkbox"
                  checked={createUserEnabled}
                  onChange={(e) => { setCreateUserEnabled(e.target.checked); markDirty(); }}
                  className="w-4 h-4 rounded border-gray-300 accent-[var(--brand)] cursor-pointer"
                />
                <span
                  className="text-sm font-medium"
                  data-testid="create-user-checkbox-label"
                  style={{ color: 'var(--ink)' }}
                >
                  Создать учётку (телефон, пароль задаст сотрудник)
                </span>
              </label>
              {createUserEnabled && (
                <div className="mt-3 space-y-3 pl-6">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${baseId}-phone`}>Телефон *</Label>
                    {/* GH #414: PhoneField composite — country selector +
                        grouped national remainder; the completeness error
                        rides the modal's shared validate() (inline under the
                        field, the screen's error pattern). */}
                    <PhoneField
                      id={`${baseId}-phone`}
                      value={phone}
                      onChange={handlePhoneChange}
                      inputTestId="staff-phone-input"
                    />
                    {errorEl('phone')}
                  </div>
                  {/* #348: NO password field — the account is born passwordless;
                      the one-time setup link is issued after saving. */}
                  <RoleField baseId={baseId} role={role} onChange={handleRoleChange} />
                </div>
              )}
            </section>
          )}

          {/* ── Учётка (edit, #348 spec §6) ── */}
          {mode === 'edit' && account !== null && (
            <section className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--ink-light)' }}>
                Учётка
              </div>

              {account.is_active ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${baseId}-account-phone`}>Телефон *</Label>
                    {/* GH #414: PhoneField widget; ONE inline error slot —
                        the completeness message from validate() or the §5
                        server codes (PHONE_TAKEN / PHONE_INVALID) — at most
                        one is live at a time (the server path only runs
                        after validate() passed). */}
                    <PhoneField
                      id={`${baseId}-account-phone`}
                      value={accountPhone}
                      onChange={handleAccountPhoneChange}
                      inputTestId="staff-account-phone-input"
                    />
                    {(phoneError ?? errors.account_phone) && (
                      <span className="text-xs" role="alert" style={{ color: 'var(--danger)' }}>
                        {phoneError ?? errors.account_phone}
                      </span>
                    )}
                  </div>

                  {!account.password_is_set && (
                    <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
                      Пароль ещё не установлен
                    </p>
                  )}

                  {onIssueLink && (
                    <>
                      <button
                        type="button"
                        data-testid="issue-link-btn"
                        onClick={handleIssueLink}
                        disabled={issuingLink}
                        className="px-4 py-2 text-sm rounded-lg border transition-colors disabled:opacity-50"
                        style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                      >
                        {issuingLink ? 'Выдача…' : account.password_is_set ? 'Сбросить пароль' : 'Выдать ссылку'}
                      </button>
                      {account.link_expires_at && (
                        <p className="text-xs" data-testid="live-link-status" style={{ color: 'var(--ink-light)' }}>
                          Ссылка выдана, действует до {formatLinkExpiry(account.link_expires_at)}
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                // Archived account (#348 §6): the block stays, READ-ONLY —
                // no edits, no link issuance («Учётка архивирована»).
                <div className="space-y-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    Учётка архивирована
                  </p>
                  <p className="text-sm" style={{ color: 'var(--ink-mid)' }}>
                    {account.phone}
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Edit-mode account note: an account is created exactly once (with
              the card); linking/managing logins is #263, not the card. */}
          {mode === 'edit' && staff?.has_user && account === null && (
            <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
              К карточке привязана учётка входа.
            </p>
          )}
        </div>
      </Modal>

      {/* One-time link handover (#348 spec §6): rendered from a live issue
          response only — or the issuance-error + «Повторить» state. */}
      {linkDialog !== null && (
        <PasswordLinkDialog
          link={linkDialog.link}
          error={linkDialog.error}
          busy={issuingLink}
          onRetry={() => {
            if (!account) return;
            void issueFor(account.id);
          }}
          onClose={() => setLinkDialog(null)}
        />
      )}
    </div>
  );
}
