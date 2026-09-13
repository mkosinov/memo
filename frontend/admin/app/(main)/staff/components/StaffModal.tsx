'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import type { StaffResponse, PositionResponse } from '@memo/api-client';
import { Modal } from '@/app/components/shared/modal/Modal';

/**
 * Structured form payload the StaffModal hands to its parent (StaffTable),
 * which maps it onto the typed wire schemas (StaffCreate / StaffUpdate).
 *
 * - `master`: null = no section (create) / remove section (edit, D7 — blocked
 *   by activities server-side); a payload = upsert. `archived` is the schedule
 *   flag (D3/Gap A) — sent in edit to toggle the section's archive without
 *   deleting the row; omitted in create (a fresh section is born active).
 * - `create_user`: create-only (D6) — `{phone, password}` or false.
 */
export interface StaffFormData {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  sort_order: number;
  position_ids: string[];
  master: { specialty: string; color: string; archived?: boolean } | null;
  create_user: { phone: string; password: string } | false;
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
}

const TEXT_INPUT =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors';

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
      {children}
    </label>
  );
}

export function StaffModal({ mode, staff, positions, onSubmit, onClose, title, subtitle }: StaffModalProps) {
  const baseId = useId();

  // ─── Person fields ──────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState(staff?.first_name ?? '');
  const [lastName, setLastName] = useState(staff?.last_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(staff?.avatar_url ?? '');

  // ─── Positions (M2M checkboxes, D4) ─────────────────────────────────────
  const [positionIds, setPositionIds] = useState<string[]>(staff?.position_ids ?? []);

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

  // ─── Account (D6, create-only) ──────────────────────────────────────────
  const [createUserEnabled, setCreateUserEnabled] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const togglePosition = useCallback((id: string) => {
    markDirty();
    setPositionIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }, [markDirty]);

  const validate = useCallback((): boolean => {
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.first_name = 'Обязательное поле';
    if (!lastName.trim()) next.last_name = 'Обязательное поле';
    if (masterEnabled) {
      // D5: specialty + color required for a master.
      if (!specialty.trim()) next.specialty = 'Обязательное поле';
      if (!color.trim()) next.color = 'Обязательное поле';
    }
    if (mode === 'create' && createUserEnabled) {
      if (!phone.trim()) next.phone = 'Обязательное поле';
      if (!password.trim()) next.password = 'Обязательное поле';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [firstName, lastName, masterEnabled, specialty, color, mode, createUserEnabled, phone, password]);

  const handleSubmit = async () => {
    if (!validate()) return;
    setIsSubmitting(true);
    try {
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
            ? { phone: phone.trim(), password: password.trim() }
            : false,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
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

          {/* ── Учётка (D6, create-only) ── */}
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
                <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  Создать учётку (телефон + пароль)
                </span>
              </label>
              {createUserEnabled && (
                <div className="mt-3 space-y-3 pl-6">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${baseId}-phone`}>Телефон *</Label>
                    <input
                      id={`${baseId}-phone`}
                      type="text"
                      value={phone}
                      onChange={(e) => { setPhone(e.target.value); markDirty(); }}
                      placeholder="+79990000000"
                      className={TEXT_INPUT}
                      style={{ borderColor: errors.phone ? 'var(--danger)' : 'var(--line)', color: 'var(--ink)' }}
                    />
                    {errorEl('phone')}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${baseId}-password`}>Пароль *</Label>
                    <input
                      id={`${baseId}-password`}
                      type="password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); markDirty(); }}
                      placeholder="••••••••"
                      className={TEXT_INPUT}
                      style={{ borderColor: errors.password ? 'var(--danger)' : 'var(--line)', color: 'var(--ink)' }}
                    />
                    {errorEl('password')}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Edit-mode account note: an account is created exactly once (with
              the card); linking/managing logins is #263, not the card. */}
          {mode === 'edit' && staff?.has_user && (
            <p className="text-xs" style={{ color: 'var(--ink-light)' }}>
              К карточке привязана учётка входа.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
