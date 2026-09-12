/**
 * PUT/PATCH rejects `is_active` across all 5 entities (#207 §12,
 * auto-closes #178). GH #266: the master entity case moved to the STAFF card
 * (/masters is read-only — its PUT now 405s); the staff composite PUT/PATCH
 * carry the same extra="forbid" guarantee.
 *
 * The Update schemas carry `extra="forbid"` and no is_active field, so a
 * PUT with is_active must fail with 422 — archive/restore is ONLY via the
 * dedicated POST endpoints. Per entity: seed → PUT with is_active → 422 →
 * row unchanged (API + DB) → POST /archive still works (200 archived:true)
 * → cleanup. The UI never sends is_active (StaffModal's PUT payload is a
 * typed StaffUpdate — tsc fails on stray fields), so this is an
 * API-level scenario with DB verification.
 */
import { test, expect } from './fixtures/test';
import {
  cleanup,
  createTestClient,
  createTestLocation,
  createTestMaster,
  createTestService,
} from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Full PUT for each entity (every non-is_active field the schema accepts). */
function putPayload(entity: string, seed: Record<string, any>): Record<string, unknown> {
  switch (entity) {
    case 'staff':
      // GH #266: the staff card PUT is the composite shape (person + master
      // section + position_ids). is_active is still rejected (extra="forbid").
      // The master section is reduced to its INPUT shape {specialty, color} —
      // the response shape's archived/timestamps would trip .strict() and mask
      // the is_active violation under test.
      return {
        first_name: seed.first_name,
        last_name: seed.last_name,
        avatar_url: seed.avatar_url ?? '',
        sort_order: seed.sort_order ?? 0,
        master: seed.master
          ? { specialty: seed.master.specialty, color: seed.master.color }
          : null,
        position_ids: seed.position_ids ?? [],
        is_active: false,
      };
    case 'locations':
      return {
        name: seed.name,
        short_title: seed.short_title ?? null,
        address: seed.address ?? null,
        description: seed.description ?? null,
        capacity: seed.capacity,
        yandex_map_url: seed.yandex_map_url ?? null,
        review_url: seed.review_url ?? null,
        record_info: seed.record_info ?? null,
        image_url: seed.image_url ?? null,
        location_hint: seed.location_hint ?? null,
        is_active: false,
      };
    case 'services':
      return {
        title: seed.title,
        description: seed.description,
        image_url: seed.image_url ?? '',
        specialty: seed.specialty,
        min_age: seed.min_age,
        max_age: seed.max_age ?? null,
        duration: seed.duration,
        record_info: seed.record_info,
        tariffs: [],
        tag_ids: [],
        is_active: false,
      };
    case 'materials':
      return {
        title: seed.title,
        description: seed.description,
        is_active: false,
      };
    default: // clients
      return {
        name: seed.name ?? null,
        phone: seed.phone ?? null,
        email: seed.email ?? null,
        channel: seed.channel ?? null,
        is_active: false,
      };
  }
}

interface EntityCase {
  entity: string; // plural route segment
  table: string;  // sqlite table
  seed(request: any): Promise<Record<string, any>>;
  cleanup(request: any, id: string): Promise<void>;
}

const ENTITY_CASES: EntityCase[] = [
  {
    // GH #266: master mutations moved to the staff card; /masters is read-only.
    entity: 'staff',
    table: 'staff',
    seed: (request) => createTestMaster(request),
    cleanup: (request, id) => cleanup(request, `/api/v1/staff/${id}`),
  },
  {
    entity: 'locations',
    table: 'locations',
    seed: (request) => createTestLocation(request),
    cleanup: (request, id) => cleanup(request, `/api/v1/locations/${id}`),
  },
  {
    entity: 'services',
    table: 'services',
    seed: (request) => createTestService(request),
    cleanup: (request, id) => cleanup(request, `/api/v1/services/${id}`),
  },
  {
    entity: 'materials',
    table: 'materials',
    seed: async (request) => {
      const resp = await request.post(`${BACKEND}/api/v1/materials`, {
        data: { title: `Материал S6 ${Date.now()}`, description: 'e2e seed' },
      });
      expect(resp.ok()).toBeTruthy();
      return resp.json();
    },
    cleanup: (request, id) => cleanup(request, `/api/v1/materials/${id}`),
  },
  {
    entity: 'clients',
    table: 'clients',
    seed: (request) => createTestClient(request, { name: `S6 Client ${Date.now()}` }),
    cleanup: (request, id) => cleanup(request, `/api/v1/clients/${id}`),
  },
];

test.describe('S6 — PUT with is_active is rejected everywhere (#178)', () => {
  for (const entityCase of ENTITY_CASES) {
    test(`${entityCase.entity}: PUT with is_active → 422; archive endpoint works`, async ({ request }) => {
      const seed = await entityCase.seed(request);
      try {
        // ── PUT (full replace) with is_active → 422 + error payload ─────
        const putResp = await request.put(`${BACKEND}/api/v1/${entityCase.entity}/${seed.id}`, {
          data: putPayload(entityCase.entity, seed),
        });
        expect(putResp.status()).toBe(422);
        // Backend error envelope ({detail:{code,message}} via src/errors.py):
        // the extra field is rejected — the envelope names the violation,
        // not the field, so assert the envelope presence (§14: 422 is the
        // acceptance criterion).
        const putErr = await putResp.json();
        expect(putErr.detail).toBeTruthy();

        // ── PATCH (partial) with is_active → 422 as well ────────────────
        const patchResp = await request.patch(`${BACKEND}/api/v1/${entityCase.entity}/${seed.id}`, {
          data: { is_active: false },
        });
        expect(patchResp.status()).toBe(422);

        // VERIFY — row untouched (is_active still 1, DB row identical).
        const dbRow = queryDBRow(`SELECT is_active FROM ${entityCase.table} WHERE id='${seed.id}'`);
        expect(dbRow!.is_active).toBe(1);
        const apiRow = await (await request.get(`${BACKEND}/api/v1/${entityCase.entity}/${seed.id}`)).json();
        expect(apiRow.archived).toBe(false);

        // ── archive via the dedicated endpoint still works (200 + body) ──
        const archiveResp = await request.post(`${BACKEND}/api/v1/${entityCase.entity}/${seed.id}/archive`);
        expect(archiveResp.status()).toBe(200);
        expect((await archiveResp.json()).archived).toBe(true);
        const restoreResp = await request.post(`${BACKEND}/api/v1/${entityCase.entity}/${seed.id}/restore`);
        expect(restoreResp.status()).toBe(200);
        expect((await restoreResp.json()).archived).toBe(false);
      } finally {
        await entityCase.cleanup(request, seed.id);
      }
    });
  }
});
