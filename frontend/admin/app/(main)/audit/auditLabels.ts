/**
 * RUSSIAN label dictionaries for the «Журнал» section (GH #344, spec §7).
 *
 * The journal stores canonical English slugs (`action`, `entity`); the
 * frontend owns the human display layer. Coverage is contractual:
 * `ACTION_LABELS` must cover every action the backend accumulator can
 * stage (`create|update|patch|delete|archive|restore|reorder`, spec §4/§8)
 * and `ENTITY_LABELS` every `ENTITY_SIGNATURES` key (backend
 * src/events/audit.py — the 16 canonical #239 entity names). The unit
 * suite pins both lists against the spec, so a backend vocabulary
 * extension surfaces as a failing test, not a raw slug in the table.
 *
 * Unknown keys fall back to the raw slug (defensive: old journal rows
 * outliving a frontend deploy).
 */

/** Journal action → Russian verb (spec §7: создал / изменил / удалил /
 *  заархивировал / восстановил / переставил; update/patch share «изменил»). */
export const ACTION_LABELS: Record<string, string> = {
  create: 'создал',
  update: 'изменил',
  patch: 'изменил',
  delete: 'удалил',
  archive: 'заархивировал',
  restore: 'восстановил',
  reorder: 'переставил',
};

/** Canonical #239 entity name → Russian noun (mirrors the `title` of every
 *  backend EntitySignature — «Над чем» renders `<ENTITY_LABELS[entity]>:
 *  <entity_label>`). */
export const ENTITY_LABELS: Record<string, string> = {
  clients: 'Клиент',
  visitors: 'Посетитель',
  services: 'Услуга',
  locations: 'Локация',
  materials: 'Материал',
  tags: 'Тег',
  positions: 'Должность',
  activities: 'Занятие',
  records: 'Запись',
  visits: 'Визит',
  payments: 'Платёж',
  photos: 'Фото',
  staff: 'Сотрудник',
  users: 'Пользователь',
  masters: 'Мастер',
  user_settings: 'Настройки',
};

/** Role → badge text; `user_role` is the ROW's role snapshot, so the two
 *  backend roles are the complete vocabulary. */
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  master: 'Мастер',
};

/** Dictionary lookup with a raw-slug fallback. */
export function labelOf(dict: Record<string, string>, key: string): string {
  return dict[key] ?? key;
}

/**
 * Render one `changes` scalar for the «поле: было → стало» line (§7).
 *
 * Masked phone/email strings arrive from the backend ALREADY masked
 * (`+7 (9**) ***-45-67`) — they are displayed VERBATIM, no re-formatting.
 * `null` renders as «—» (create's before / delete's after); booleans in
 * Russian; lists (tag_ids) bracketed and comma-separated.
 */
export function formatChangesValue(value: unknown): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => formatChangesValue(v)).join(', ')}]`;
  if (typeof value === 'string') return value;
  // Objects never occur in the canonical serializer's output; stringify
  // defensively rather than print "[object Object]".
  return JSON.stringify(value);
}
