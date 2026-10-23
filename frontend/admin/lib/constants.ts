/**
 * Shared frontend constants (GH #262).
 *
 * PASSWORD_POLICY_HINT_RU mirrors the backend single-source hint
 * (backend/src/auth/passwords.py) — the user-facing text of the password
 * policy. Kept as a frontend constant because the admin app does not import
 * backend Python; the wording is fixed by spec §5.3 / auth-design §3.2 and
 * the change-password 422 PASSWORD_POLICY error carries the same string.
 */
export const PASSWORD_POLICY_HINT_RU =
  'Пароль: от 8 до 64 символов, пробелы по краям обрезаются';

/**
 * Deferred-delete undo window, ms — the single source of the 5s interval
 * (GH #464): `delayMs` in deferred-delete mutation hooks, the undo-toast
 * fallback lifetime in UIContext (#285 D4), and the e2e `withUndoWindow`
 * rewind default.
 */
export const UNDO_WINDOW_MS = 5_000;
