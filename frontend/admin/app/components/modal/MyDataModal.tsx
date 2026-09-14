'use client';

// GH #262 T7 — MyDataModal (spec §5.2, D2/D4/D7/D12).
//
// «Мои данные» — the cabinet form over GET/PUT /api/v1/my. Field-config
// pattern of PhotoModal (per-field errors, dirty-guard confirm on close,
// Escape). Layout rules:
//  - Роль — read-only (the role is not editable anywhere);
//  - Имя*/Фамилия* — the STAFF CARD half; hidden ENTIRELY when
//    has_staff=false (D7/S6: a cardless user edits private fields only);
//  - Специализация — read-only string (array joined with a comma), visible
//    only when has_master=true; the admin owns it in the staff card (D4) —
//    it is NEVER part of the PUT payload;
//  - portrait block (preview + «Загрузить фото» + «Удалить») — only with a
//    card; upload → POST /my/portrait, delete → PUT {avatar_url: null}; both
//    call AuthContext.refresh() so the sidebar plate updates immediately
//    (the plate reads the snapshot STATE, not react-query — pinned T7);
//  - «Паспорт» section — private fields + the disabled placeholder row
//    «Фото первой страницы паспорта — появится позже» (domain-rules/
//    profile.md: no passport-file infrastructure in v1).
//
// PUT semantics (domain-rules/profile.md): only CHANGED keys are sent —
// an omitted key keeps its value, a cleared text field travels as an
// explicit null.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/app/components/shared/modal/Modal';
import { CalendarPopover } from '@/app/components/shared/CalendarPopover';
import { useMyProfile, useUpdateMyProfile, useUploadPortrait } from '@/hooks/useMyProfile';
import { useAuth } from '@/contexts/AuthContext';
import { useUI } from '@/contexts/UIContext';
import { parseApiError } from '@/app/lib/api/parseApiError';
import { toISODate } from '@/lib/datetime';
import type { MyProfile, MyProfileUpdate } from '@memo/api-client';
import {
  MYDATA_MAIN_FIELDS,
  MYDATA_PASSPORT_FIELDS,
  PASSPORT_PHOTO_PLACEHOLDER,
  type MyDataFieldConfig,
} from './myDataFields';

export interface MyDataModalProps {
  onClose: () => void;
}

/** The private-half keys (always editable) + the card names (has_staff only). */
const PRIVATE_KEYS = [
  ...MYDATA_MAIN_FIELDS,
  ...MYDATA_PASSPORT_FIELDS,
].map((f) => f.key);

type FormState = Record<string, string>;

function initialForm(profile: MyProfile): FormState {
  const form: FormState = {};
  if (profile.has_staff) {
    form.first_name = profile.first_name ?? '';
    form.last_name = profile.last_name ?? '';
  }
  for (const key of PRIVATE_KEYS) {
    form[key] = (profile[key as keyof MyProfile] as string | null) ?? '';
  }
  return form;
}

/** Parse a 'YYYY-MM-DD' key into a LOCAL Date (CalendarPopover input). */
function parseISODate(iso: string): Date {
  if (!iso) return new Date();
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

const inputClasses = 'w-full rounded-lg border px-3 py-2 text-sm transition-colors';

function inputStyle(error?: string): React.CSSProperties {
  return {
    borderColor: error ? 'var(--danger)' : 'var(--line)',
    backgroundColor: 'var(--white)',
    color: 'var(--ink)',
  };
}

function FieldLabel({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium" style={{ color: 'var(--ink-light)' }}>
      {label}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function FieldError({ testId, error }: { testId: string; error?: string }) {
  if (!error) return null;
  return (
    <span
      className="text-xs"
      style={{ color: 'var(--danger)' }}
      // id = the input's aria-describedby target (PhotoModal/PasswordModal
      // pattern) — fix-round issue 2.
      id={testId}
      data-testid={testId}
    >
      {error}
    </span>
  );
}

/* ── Inner form (mounted only once the profile query resolved) ─────── */

function MyDataForm({ profile, onClose }: { profile: MyProfile; onClose: () => void }) {
  const { refresh } = useAuth();
  const { showToast } = useUI();
  const updateProfile = useUpdateMyProfile();
  const uploadPortrait = useUploadPortrait();

  const [form, setForm] = useState<FormState>(() => initialForm(profile));
  const initial = useRef<FormState>(form).current;
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Portrait preview is local state so an upload/delete updates the block
  // immediately (the query refetch converges in the background).
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarOpenRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Effect-synced ref: when Escape fires, the CalendarPopover's own document
  // handler closes the popover first — this ref still reads "open" inside the
  // same event (effects flush afterwards), so the modal swallows that Escape
  // instead of closing on top of the popover.
  useEffect(() => {
    calendarOpenRef.current = calendarOpen;
  }, [calendarOpen]);

  const buildPayload = useCallback((): MyProfileUpdate => {
    const payload: MyProfileUpdate = {};
    const keys = profile.has_staff ? ['first_name', 'last_name', ...PRIVATE_KEYS] : PRIVATE_KEYS;
    for (const key of keys) {
      if (form[key] !== initial[key]) {
        // A cleared field travels as an explicit null (clears server-side);
        // an untouched key is omitted (keeps its value).
        Object.assign(payload, { [key]: form[key] === '' ? null : form[key] });
      }
    }
    // specialties is read-only (D4) — structurally never part of the payload.
    return payload;
  }, [form, profile.has_staff]);

  const isDirty = Object.keys(buildPayload()).length > 0;

  const handleChange = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    // Required: only Имя/Фамилия, and only while has_staff (spec §5.2).
    if (!profile.has_staff) return true;
    const next: Record<string, string> = {};
    if (!form.first_name.trim()) next.first_name = 'Обязательное поле';
    if (!form.last_name.trim()) next.last_name = 'Обязательное поле';
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [profile.has_staff, form.first_name, form.last_name]);

  const handleClose = useCallback(() => {
    if (isDirty && !window.confirm('Есть несохранённые изменения. Закрыть?')) return;
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (calendarOpenRef.current) return; // the popover consumes this Escape
      handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    try {
      await updateProfile.mutateAsync(buildPayload());
      // Pinned T7 decision: the plate reads the snapshot STATE — refresh it
      // so the new name shows without a reload.
      await refresh();
      showToast('Данные сохранены', 'success');
      onClose();
    } catch (err) {
      // Modal stays open so the error is actionable (PhotoModal pattern).
      showToast(parseApiError(err).message, 'error');
    }
  }, [validate, updateProfile, buildPayload, refresh, showToast, onClose]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-picking the same file after an error
      if (!file) return;
      try {
        const res = await uploadPortrait.mutateAsync(file);
        setAvatarUrl(res.avatar_url);
        await refresh(); // the plate avatar updates immediately (pinned T7)
      } catch (err) {
        showToast(parseApiError(err).message, 'error');
      }
    },
    [uploadPortrait, refresh, showToast],
  );

  const handleDeleteAvatar = useCallback(async () => {
    try {
      await updateProfile.mutateAsync({ avatar_url: null });
      setAvatarUrl(null);
      await refresh();
    } catch (err) {
      showToast(parseApiError(err).message, 'error');
    }
  }, [updateProfile, refresh, showToast]);

  const busy = updateProfile.isPending;
  // Fix-round issue 4: BOTH portrait buttons disable while ANY portrait
  // mutation is in flight — the upload (uploadPortrait) and the delete
  // (updateProfile with avatar_url:null) share one busy flag.
  const portraitBusy = busy || uploadPortrait.isPending;

  const renderField = (field: MyDataFieldConfig) => {
    const testId = `mydata-${field.key}`;
    const value = form[field.key] ?? '';
    const error = errors[field.key];

    if (field.type === 'calendar') {
      // Дата рождения — read-only display + CalendarPopover (spec §5.2).
      return (
        <div key={field.key} className="flex flex-col gap-1">
          <FieldLabel htmlFor={testId} label={field.label} />
          <div className="relative">
            <input
              id={testId}
              data-testid={testId}
              type="text"
              readOnly
              value={value}
              placeholder="гггг-мм-дд"
              className={inputClasses}
              style={inputStyle(error)}
              aria-invalid={!!error}
              aria-describedby={error ? `${testId}-error` : undefined}
            />
            <button
              type="button"
              data-testid={`${testId}-toggle`}
              aria-label={`Выбрать ${field.label.toLowerCase()}`}
              onClick={() => setCalendarOpen((prev) => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-light hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>
            <CalendarPopover
              isOpen={calendarOpen}
              onClose={() => setCalendarOpen(false)}
              onSelectDate={(date) => handleChange(field.key, toISODate(date))}
              selectedDate={parseISODate(value)}
            />
          </div>
          <FieldError testId={`${testId}-error`} error={error} />
        </div>
      );
    }

    return (
      <div key={field.key} className="flex flex-col gap-1">
        <FieldLabel htmlFor={testId} label={field.label} />
        <input
          id={testId}
          data-testid={testId}
          type={field.type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => handleChange(field.key, e.target.value)}
          className={inputClasses}
          style={inputStyle(error)}
          aria-invalid={!!error}
          aria-describedby={error ? `${testId}-error` : undefined}
        />
        <FieldError testId={`${testId}-error`} error={error} />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <Modal
        title="Мои данные"
        onClose={handleClose}
        testId="mydata-modal"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg border transition-colors"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              Отмена
            </button>
            <button
              data-testid="mydata-submit"
              onClick={() => void handleSubmit()}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {busy ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        }
      >
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4" data-testid="mydata-form">
          {/* ── Portrait (card owners only, D7) ── */}
          {profile.has_staff && (
            <div className="flex items-center gap-4" data-testid="mydata-portrait-block">
              {avatarUrl ? (
                <img
                  data-testid="mydata-avatar-preview"
                  src={avatarUrl}
                  alt="Портрет"
                  className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div
                  data-testid="mydata-avatar-empty"
                  className="w-16 h-16 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                  style={{ backgroundColor: 'var(--surface)', color: 'var(--ink-light)' }}
                >
                  {(form.first_name || 'А').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={portraitBusy}
                  className="px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                >
                  {uploadPortrait.isPending ? 'Загрузка...' : 'Загрузить фото'}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    data-testid="mydata-portrait-delete"
                    onClick={() => void handleDeleteAvatar()}
                    disabled={portraitBusy}
                    className="px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50"
                    style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                  >
                    Удалить
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  data-testid="mydata-portrait-file"
                  onChange={(e) => void handleFileChange(e)}
                  className="hidden"
                />
              </div>
            </div>
          )}

          {/* ── Роль — read-only ── */}
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="mydata-role" label="Роль" />
            <input
              id="mydata-role"
              data-testid="mydata-role"
              type="text"
              value={profile.role}
              disabled
              className={`${inputClasses} opacity-60 cursor-not-allowed`}
              style={inputStyle()}
            />
          </div>

          {/* ── Имя / Фамилия — the card half, hidden without a card (D7) ── */}
          {profile.has_staff && (
            <>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="mydata-first_name" label="Имя" required />
                <input
                  id="mydata-first_name"
                  data-testid="mydata-first_name"
                  type="text"
                  value={form.first_name ?? ''}
                  onChange={(e) => handleChange('first_name', e.target.value)}
                  className={inputClasses}
                  style={inputStyle(errors.first_name)}
                  aria-invalid={!!errors.first_name}
                  aria-describedby={errors.first_name ? 'mydata-first_name-error' : undefined}
                />
                <FieldError testId="mydata-first_name-error" error={errors.first_name} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="mydata-last_name" label="Фамилия" required />
                <input
                  id="mydata-last_name"
                  data-testid="mydata-last_name"
                  type="text"
                  value={form.last_name ?? ''}
                  onChange={(e) => handleChange('last_name', e.target.value)}
                  className={inputClasses}
                  style={inputStyle(errors.last_name)}
                  aria-invalid={!!errors.last_name}
                  aria-describedby={errors.last_name ? 'mydata-last_name-error' : undefined}
                />
                <FieldError testId="mydata-last_name-error" error={errors.last_name} />
              </div>
            </>
          )}

          {/* ── Специализация — read-only string, master section only (D4) ── */}
          {profile.has_master && (
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="mydata-specialties" label="Специализация" />
              <input
                id="mydata-specialties"
                data-testid="mydata-specialties"
                type="text"
                value={(profile.specialties ?? []).join(', ')}
                disabled
                className={`${inputClasses} opacity-60 cursor-not-allowed`}
                style={inputStyle()}
              />
            </div>
          )}

          {/* ── Private half — main section ── */}
          {MYDATA_MAIN_FIELDS.map(renderField)}

          {/* ── Паспорт ── */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>
              Паспорт
            </h3>
            <div className="space-y-4">
              {MYDATA_PASSPORT_FIELDS.map(renderField)}
              {/* Placeholder row — v1 has no passport-file infrastructure
                  (domain-rules/profile.md): disabled, no interaction. */}
              <div
                data-testid="mydata-passport-photo-placeholder"
                aria-disabled="true"
                className="rounded-lg border border-dashed px-3 py-2 text-sm select-none"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-light)' }}
              >
                {PASSPORT_PHOTO_PLACEHOLDER}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Modal shell — owns the profile query ─────────────────────────── */

/** A small centred status card (loading / error) with the shared backdrop.
 *  Both states are dismissible (fix-round issue 1): «Закрыть» → onClose and
 *  Escape closes, so a failed GET never leaves a stuck «Загрузка...». */
function StatusCard({
  testId,
  children,
  onClose,
}: {
  testId: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        data-testid={testId}
        className="relative bg-white rounded-xl shadow-2xl px-6 py-5 text-sm max-w-sm w-full mx-4 space-y-3"
        style={{ backgroundColor: 'var(--white)', color: 'var(--ink-mid)' }}
      >
        {children}
        {onClose && (
          <div className="flex justify-end">
            <button
              type="button"
              data-testid={`${testId}-close`}
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border transition-colors"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              Закрыть
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MyDataModal({ onClose }: MyDataModalProps) {
  const { data: profile, isError } = useMyProfile();

  // Fix-round issue 1 (BLOCKER): a failed GET /my (401/500/network) used to
  // fall through to a permanent, non-dismissible «Загрузка...». Render a
  // dismissible error state instead.
  if (isError) {
    return (
      <StatusCard testId="mydata-error" onClose={onClose}>
        <p style={{ color: 'var(--ink)' }}>Не удалось загрузить данные. Попробуйте позже.</p>
      </StatusCard>
    );
  }

  if (!profile) {
    // Loading is transient (the query either resolves or errors), but it is
    // still dismissible so a hung request can never trap the user.
    return (
      <StatusCard testId="mydata-loading" onClose={onClose}>
        <p>Загрузка...</p>
      </StatusCard>
    );
  }

  return <MyDataForm profile={profile} onClose={onClose} />;
}
