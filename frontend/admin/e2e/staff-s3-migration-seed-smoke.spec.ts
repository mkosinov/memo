/**
 * S3 (GH #266) — «Миграция: всё прежнее на месте» (смоук на свежем стеке).
 *
 * The e2e stack boots on a FRESH DB (scripts/e2e-shard-start.sh wipes the
 * file; the backend stamps alembic to head and seed.py builds the schema +
 * canonical data). This spec pins the post-migration seed contract of the
 * staff domain: the six seed masters (m1–m5, m7; m6 never existed) keep
 * their ids, names, specialties and colors, their activities and records are
 * alive, and every seed master holds the «мастер» position. Schedule and
 * records-view are smoke-checked as the downstream consumers («расписание и
 * статистика живы»).
 *
 * The DATA-PRESERVING migration path itself (legacy pre-#266 rows surviving
 * `alembic upgrade head`) cannot run on this stack — it never starts from a
 * legacy DB — so it is covered by the file-copy pytest block
 * backend/tests/test_staff_restructuring_migration_data.py (Task 10 NOTE).
 *
 * Expected seed values: backend/src/seed/seed.py (_STAFF_RAW,
 * _MASTER_EXTENSIONS) — RESET_SQL re-pins the seed links before every test.
 */
import { test, expect } from './fixtures/test';
import { waitForScheduleReady } from './fixtures/helpers';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** The canonical seed staff (= former masters): ids preserved by migration. */
const SEED_STAFF = [
  { id: 'm1', first_name: 'Ольга', last_name: 'Середа', specialty: 'живопись', color: '#5B8C7A' },
  { id: 'm2', first_name: 'Юлия', last_name: 'Большакова', specialty: 'керамика', color: '#6B7E9C' },
  { id: 'm3', first_name: 'Анастасия', last_name: 'П.', specialty: 'живопись', color: '#A07060' },
  { id: 'm4', first_name: 'Дарья', last_name: 'Тюльпина', specialty: 'керамика', color: '#7A6E9C' },
  { id: 'm5', first_name: 'Александра', last_name: 'В.', specialty: 'живопись', color: '#8A7840' },
  { id: 'm7', first_name: 'Ирина', last_name: 'Горох', specialty: 'керамика', color: '#9A5870' },
] as const;

const SEED_IDS = SEED_STAFF.map((s) => s.id);
const inList = SEED_IDS.map((id) => `'${id}'`).join(',');

test.describe('S3 — migration smoke: seed masters, activities and records intact', () => {
  test('seed staff keep ids/names/colors, hold «мастер», schedule + records alive', async ({ page, request }) => {
    // ── 1. Staff cards: ids, names, sort order, «мастер» position (D4) ─────
    for (const s of SEED_STAFF) {
      const resp = await request.get(`${BACKEND}/api/v1/staff/${s.id}`);
      expect(resp.status(), `GET /staff/${s.id}`).toBe(200);
      const card = await resp.json();
      expect(card.id).toBe(s.id);
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
    const acting = (await (await request.get(`${BACKEND}/api/v1/masters/all`)).json()) as
      Array<{ id: string; first_name: string; last_name: string; color: string; specialty: string; sort_order: number }>;
    const actingIds = acting.map((m) => m.id);
    expect([...actingIds].sort()).toEqual([...SEED_IDS].sort());
    for (const s of SEED_STAFF) {
      const m = acting.find((a) => a.id === s.id)!;
      expect(m.first_name).toBe(s.first_name);
      expect(m.last_name).toBe(s.last_name);
      expect(m.color).toBe(s.color);
      expect(m.specialty).toBe(s.specialty);
    }
    // Sort order preserved (m1..m5 = 0..4, m7 = 5 — RESET_SQL pins the same).
    expect(acting.map((m) => m.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);

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
    expect(links).toEqual(SEED_IDS.map((id) => ({ staff_id: id, position_id: 'master' })));
    const extRows = queryDBRows(
      `SELECT staff_id, is_active FROM masters WHERE staff_id IN (${inList}) ORDER BY staff_id`,
    );
    expect(extRows).toEqual(SEED_IDS.map((id) => ({ staff_id: id, is_active: 1 })));

    // ── 5. Занятия на месте: seed activities point at the seed masters ─────
    expect(queryDBRow(
      `SELECT COUNT(*) AS n FROM activities WHERE master_id IN (${inList})`,
    )!.n).toBeGreaterThan(40); // ev_* (3 weeks) + ev_fixed_* (10)
    const evFixed0 = queryDBRow(
      `SELECT master_id FROM activities WHERE id='ev_fixed_0'`,
    );
    expect(evFixed0).toMatchObject({ master_id: 'm1' });

    // ── 6. Записи на месте + история показывает имя/цвет мастера ───────────
    // «записи на месте» = the seed record survives the migration with its
    // activity FK linkage intact. Its STATUS is a mutable business field
    // (other specs legitimately change it and RESET_SQL does not restore
    // edited seed rows), so it is deliberately NOT asserted — only the
    // migration-preserved linkage (record → activity → master m1) is.
    const r1 = queryDBRow(
      `SELECT r.id, a.master_id FROM records r JOIN activities a ON r.activity_id=a.id WHERE r.id='r1'`,
    );
    expect(r1).toMatchObject({ id: 'r1', master_id: 'm1' });
    // Records view resolves the master name/color through the new tables
    // («статистика жива»: master_name = «Фамилия Имя», displayMasterName parity).
    // These resolve from the activity's master (m1), not from any mutable
    // record field — stable across the suite.
    const view = await (await request.get(
      `${BACKEND}/api/v1/records/view?date_from=2000-01-01&date_to=2100-01-01&q=${encodeURIComponent('Анна Иванова')}`,
    )).json();
    const r1Row = (view.items as Array<{ id: string; master_name: string | null; master_color: string | null }>)
      .find((r) => r.id === 'r1');
    expect(r1Row).toBeDefined();
    expect(r1Row!.master_name).toBe('Середа Ольга');
    expect(r1Row!.master_color).toBe('#5B8C7A');

    // ── 7. Расписание живо: the schedule screen renders this week's cards ──
    await waitForScheduleReady(page);
    const cardCount = await page.locator('[data-testid^="activity-"]').count();
    expect(cardCount).toBeGreaterThan(0);
  });
});
