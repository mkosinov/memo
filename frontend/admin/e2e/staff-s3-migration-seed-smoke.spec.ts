/**
 * S3 (GH #266) — «Миграция: всё прежнее на месте» (смоук на свежем стеке).
 *
 * The e2e stack boots on a FRESH DB (scripts/e2e-shard-start.sh wipes the
 * file; the backend stamps alembic to head and seed.py builds the schema +
 * canonical data). This spec pins the post-migration seed contract of the
 * staff domain: the six seed staff cards keep their names, specialties and
 * colors, their activities and records are alive, and every seed staff card
 * holds the «мастер» position. Schedule and records-view are smoke-checked
 * as the downstream consumers («расписание и статистика живы»).
 *
 * The DATA-PRESERVING migration path itself (legacy pre-#266 rows surviving
 * `alembic upgrade head`) cannot run on this stack — it never starts from a
 * legacy DB — so it is covered by the file-copy pytest block
 * backend/tests/test_staff_restructuring_migration_data.py (Task 10 NOTE).
 *
 * Expected seed values: backend/src/seed/seed.py (_STAFF_RAW,
 * _MASTER_EXTENSIONS) — RESET_SQL re-pins the seed links before every test.
 * Seed ids are UUIDs (GH #491), so every pin goes through a business-key
 * resolution (name / sort order / fixed-week slot) instead of a literal id.
 */
import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import { waitForScheduleReady } from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

const BACKEND = resolveBackendUrl();

/** The canonical seed staff cards (= former masters) by business keys. */
const SEED_STAFF = [
  { first_name: 'Ольга', last_name: 'Середа', specialty: 'живопись', color: '#5B8C7A' },
  { first_name: 'Юлия', last_name: 'Большакова', specialty: 'керамика', color: '#6B7E9C' },
  { first_name: 'Анастасия', last_name: 'П.', specialty: 'живопись', color: '#A07060' },
  { first_name: 'Дарья', last_name: 'Тюльпина', specialty: 'керамика', color: '#7A6E9C' },
  { first_name: 'Александра', last_name: 'В.', specialty: 'живопись', color: '#8A7840' },
  { first_name: 'Ирина', last_name: 'Горох', specialty: 'керамика', color: '#9A5870' },
] as const;

/** Fixed reference week Monday 10:00 slot (Морской пейзаж, m1) — the
 * stable anchor that used to be ev_fixed_0 / record r1. */
const FIXED_MON_10 = "substr(a.start,1,16) = '2026-06-15 10:00'";

test.describe('S3 — migration smoke: seed staff, activities and records intact', () => {
  test('seed staff keep names/colors, hold «мастер», schedule + records alive', async ({ page, request }) => {
    // ── 0. Resolve seed staff ids by name (UUIDs — GH #491) ────────────────
    const staffList = (await (await request.get(`${BACKEND}/api/v1/masters/all`)).json()) as
      Array<{ id: string; first_name: string; last_name: string; color: string; specialty: string; sort_order: number }>;
    const resolveStaff = (s: { first_name: string; last_name: string }): string => {
      const found = staffList.find(
        (m) => m.first_name === s.first_name && m.last_name === s.last_name,
      );
      expect(found, `staff card «${s.last_name}» present`).toBeTruthy();
      return found!.id;
    };
    const staffIds = SEED_STAFF.map(resolveStaff);

    // ── 1. Staff cards: names, sort order, «мастер» position (D4) ──────────
    for (let i = 0; i < SEED_STAFF.length; i++) {
      const s = SEED_STAFF[i];
      const resp = await request.get(`${BACKEND}/api/v1/staff/${staffIds[i]}`);
      expect(resp.status(), `GET /staff/${staffIds[i]}`).toBe(200);
      const card = await resp.json();
      expect(card.id).toBe(staffIds[i]);
      expect(card.first_name).toBe(s.first_name);
      expect(card.last_name).toBe(s.last_name);
      expect(card.archived).toBe(false);
      // Every seed master holds exactly the «мастер» position (spec
      // «Миграция» step 4: «все сид-мастера получают должность мастер»).
      expect(card.position_ids).toEqual(['master']);
      // Master section: specialty + color unchanged, acting.
      expect(card.master).toMatchObject({
        specialty: s.specialty,
        color: s.color,
        archived: false,
      });
    }

    // ── 2. Read-only masters view: same six, same colors ───────────────────
    // Exactly the six seed cards — no extras, none missing (name-set parity).
    expect(staffList.map((m) => `${m.last_name} ${m.first_name}`).sort())
      .toEqual(SEED_STAFF.map((s) => `${s.last_name} ${s.first_name}`).sort());
    for (let i = 0; i < SEED_STAFF.length; i++) {
      const s = SEED_STAFF[i];
      const m = staffList.find((a) => a.id === staffIds[i])!;
      expect(m.first_name).toBe(s.first_name);
      expect(m.last_name).toBe(s.last_name);
      expect(m.color).toBe(s.color);
      expect(m.specialty).toBe(s.specialty);
    }
    // Sort order preserved (Ольга..Ирина = 0..5 — RESET_SQL pins the same).
    expect(staffList.map((m) => m.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);

    // ── 3. Positions dictionary: built-ins + the unassigned user seed ──────
    const positions = (await (await request.get(`${BACKEND}/api/v1/positions/all`)).json()) as
      Array<{ id: string; title: string; is_system: boolean }>;
    const byId = Object.fromEntries(positions.map((p) => [p.id, p]));
    expect(byId.master).toMatchObject({ title: 'Мастер', is_system: true });
    expect(byId.admin).toMatchObject({ title: 'Администратор', is_system: true });
    expect(byId.smm).toMatchObject({ title: 'СММ', is_system: false });

    // ── 4. SQL: the four restructured tables hold the seed shape ───────────
    const links = queryDBRows(
      `SELECT staff_id, position_id FROM staff_positions ORDER BY staff_id`,
    );
    const byStaff = new Map(links.map((l) => [String(l.staff_id), String(l.position_id)]));
    expect([...byStaff.keys()].sort()).toEqual([...staffIds].sort());
    for (const id of staffIds) {
      expect(byStaff.get(id)).toBe('master');
    }
    const extRows = queryDBRows(
      `SELECT staff_id, is_active FROM masters WHERE is_active = 1`,
    );
    const extByStaff = new Map(extRows.map((r) => [String(r.staff_id), Number(r.is_active)]));
    expect([...extByStaff.keys()].sort()).toEqual([...staffIds].sort());
    for (const id of staffIds) {
      expect(extByStaff.get(id)).toBe(1);
    }

    // ── 5. Занятия на месте: seed activities point at the seed masters ─────
    const idList = staffIds.map((id) => `'${id}'`).join(',');
    expect(queryDBRow(
      `SELECT COUNT(*) AS n FROM activities WHERE master_id IN (${idList})`,
    )!.n).toBeGreaterThan(40); // 3 relative weeks + the fixed reference week (10)
    const evFixed0 = queryDBRow(
      `SELECT master_id FROM activities a WHERE ${FIXED_MON_10}`,
    );
    expect(evFixed0).toMatchObject({ master_id: staffIds[0] });

    // ── 6. Записи на месте + история показывает имя/цвет мастера ───────────
    // «записи на месте» = the seed record survives the migration with its
    // activity FK linkage intact. Its STATUS is a mutable business field
    // (other specs legitimately change it and RESET_SQL does not restore
    // edited seed rows), so it is deliberately NOT asserted — only the
    // migration-preserved linkage (record → activity → first staff card) is.
    const r1 = queryDBRow(
      `SELECT r.id, a.master_id FROM records r JOIN activities a ON r.activity_id=a.id WHERE ${FIXED_MON_10}`,
    );
    expect(r1).toBeTruthy();
    expect(r1).toMatchObject({ master_id: staffIds[0] });
    // Records view resolves the master name/color through the new tables
    // («статистика жива»: master_name = «Фамилия Имя», displayMasterName parity).
    // These resolve from the activity's master (Ольга Середа), not from any
    // mutable record field — stable across the suite.
    const view = await (await request.get(
      `${BACKEND}/api/v1/records/view?date_from=2000-01-01&date_to=2100-01-01&q=${encodeURIComponent('Анна Иванова')}`,
    )).json();
    const r1Row = (view.items as Array<{ id: string; master_name: string | null; master_color: string | null }>)
      .find((r) => r.id === String(r1!.id));
    expect(r1Row).toBeDefined();
    expect(r1Row!.master_name).toBe('Середа Ольга');
    expect(r1Row!.master_color).toBe('#5B8C7A');

    // ── 7. Расписание живо: the schedule screen renders this week's cards ──
    await waitForScheduleReady(page);
    const cardCount = await page.locator('[data-testid^="activity-"]').count();
    expect(cardCount).toBeGreaterThan(0);
  });
});
