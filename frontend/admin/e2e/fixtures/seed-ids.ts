/**
 * seed-ids.ts — seed-row resolvers by stable business keys (GH #491).
 *
 * Seed ids are UUIDs now; the readable literals (alpika, s4, m1, r1, t5a…)
 * survive only as internal alias keys inside backend/src/seed/seed.py. Specs
 * that pin seed rows resolve them by business keys (title / name / sort
 * order) HERE — one SQL implementation per key shape, no per-spec copies.
 *
 * Seed rows (and their ids) are constant across the whole stack run — the
 * per-test canonical reset restores the same canon dump.
 *
 * IMPORT-TIME RULE: never call these at module scope. CI's
 * `playwright --list` collects specs BEFORE the shard stack seeds the DB,
 * so import-time DB access dies with "no such table". Resolve in
 * `test.beforeAll` (or inside test bodies) instead.
 */
import { queryDBRow } from './db-query';

const esc = (value: string): string => value.replace(/'/g, "''");

/**
 * Id of the seed row in `table` whose `column` equals `value`.
 * Throw loud when missing — a stale business key must fail fast, not
 * cascade into "element not found" confusion later in the test.
 */
export function seedId(table: string, column: string, value: string): string {
  const row = queryDBRow(
    `SELECT id FROM ${table} WHERE ${column} = '${esc(value)}'`,
  );
  if (!row) {
    throw new Error(`seed-ids: no ${table} row with ${column}='${value}'`);
  }
  return String(row.id);
}

/** Id of the n-th seeded staff card by sort_order (0 = «Ольга Середа»). */
export function seedStaffIdBySortOrder(sortOrder: number): string {
  const row = queryDBRow(
    `SELECT id FROM staff WHERE sort_order = ${sortOrder} LIMIT 1`,
  );
  if (!row) throw new Error(`seed-ids: no staff card with sort_order=${sortOrder}`);
  return String(row.id);
}

/** Id of a service's seed tariff by titles («Ручная лепка» + «Взрослый»). */
export function seedTariffId(serviceTitle: string, tariffTitle: string): string {
  const row = queryDBRow(
    `SELECT t.id AS id FROM tariffs t
     JOIN services s ON t.service_id = s.id
     WHERE s.title = '${esc(serviceTitle)}' AND t.title = '${esc(tariffTitle)}'`,
  );
  if (!row) {
    throw new Error(`seed-ids: no tariff '${tariffTitle}' on service '${serviceTitle}'`);
  }
  return String(row.id);
}

/** Id of the seed record of the client with the given name (unique among seed records). */
export function seedRecordIdByClientName(clientName: string): string {
  const row = queryDBRow(
    `SELECT r.id AS id FROM records r
     JOIN clients c ON r.client_id = c.id
     WHERE c.name = '${esc(clientName)}'`,
  );
  if (!row) throw new Error(`seed-ids: no record for client '${clientName}'`);
  return String(row.id);
}

/** Id of the fixed reference week's Monday 10:00 record (the earliest seed
 * record — «Анна Иванова» on «Морской пейзаж»; former alias r1). */
export function seedFixedWeekRecordId(): string {
  const row = queryDBRow(
    `SELECT r.id AS id FROM records r
     JOIN activities a ON r.activity_id = a.id
     WHERE substr(a.start, 1, 16) = '2026-06-15 10:00'`,
  );
  if (!row) throw new Error('seed-ids: fixed-week Monday 10:00 record not found');
  return String(row.id);
}
