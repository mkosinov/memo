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
