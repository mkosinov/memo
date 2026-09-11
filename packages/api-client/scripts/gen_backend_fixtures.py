"""Generate backend-response fixtures for the api-client archived-inversion parity test.

Serializes via the real Pydantic response schemas (the exact objects FastAPI
emits). Each entity has an active pair (DB is_active=true -> archived=false)
and an archived pair (DB is_active=false -> archived=true). #207 Task 15;
#266: the staff card replaces the old master entity (the /masters list became
a read-only acting-masters VIEW — not archive-aware, so no pair for it).
"""

import json
from pathlib import Path

from src.schemas.client import ClientResponse, ClientWithStats
from src.schemas.location import LocationResponse
from src.schemas.material import MaterialResponse
from src.schemas.service import ServiceResponse
from src.schemas.staff import StaffResponse

CREATED = "2024-01-15T10:00:00"
UPDATED = "2024-06-01T12:00:00"

# Master-section row of the card (D3): the section keeps its own is_active —
# archived pair mirrors the dismissal dialog defaults (both checkboxes on).
master_section_active = dict(
    specialty="живопись, керамика", color="#5B8C7A", is_active=True,
    created_at=CREATED, updated_at=UPDATED,
)
master_section_archived = dict(master_section_active, is_active=False)

staff_active = dict(
    first_name="Анна", last_name="Иванова", avatar_url=None, sort_order=0,
    master=master_section_active, position_ids=["master"],
    created_at=CREATED, updated_at=UPDATED,
)
staff_archived = dict(staff_active, master=master_section_archived)

location = dict(
    name="Студия на Невском", short_title=None, address="Невский пр. 28",
    description="Уютная студия", capacity=10, yandex_map_url=None, review_url=None,
    record_info="Запись по телефону", image_url=None, location_hint=None, sort_order=0,
    created_at=CREATED, updated_at=UPDATED,
)
service = dict(
    title="Мастер-класс по керамике", description="Лепим кружку", image_url="",
    specialty="керамика", min_age=6, max_age=None, duration=120, record_info="",
    created_at=CREATED, updated_at=UPDATED,
    tariffs=[{"id": "tariff-1", "service_id": "service-1", "title": "Взрослый",
              "description": "", "price": 2500}],
    tags=[{"id": "tag-1", "tag": "керамика"}],
    # GH #223: nested ServiceMaterialItem — the linked material's description
    # travels with the link; note is per-link (NULL when unset).
    materials=[{"id": "5f8a1c2d-0004-4000-8000-000000000004", "title": "Глина",
                "description": "Шамотная глина", "note": "Принести фартук"}],
)
material = dict(title="Глина", description="Шамотная глина",
                created_at=CREATED, updated_at=UPDATED)
client = dict(name="Иван Петров", phone="+79991234567", email=None,
              channel="telegram", created_at=CREATED, updated_at=UPDATED)


def pair(cls, base: dict, entity_id: str) -> dict:
    return {
        "active": cls(id=entity_id, **base, is_active=True).model_dump(mode="json"),
        "archived": cls(id=entity_id, **base, is_active=False).model_dump(mode="json"),
    }


fixtures = {
    "staff": pair(StaffResponse, staff_active, "5f8a1c2d-0001-4000-8000-000000000001"),
    # staff_archived needs the archived master section too — rebuild by hand
    # (pair() flips only the person flag; D3 keeps the section flag independent).
}
fixtures["staff"]["archived"] = StaffResponse(
    id="5f8a1c2d-0001-4000-8000-000000000001", **staff_archived, is_active=False
).model_dump(mode="json")
fixtures.update({
    "location": pair(LocationResponse, location, "5f8a1c2d-0002-4000-8000-000000000002"),
    "service": pair(ServiceResponse, service, "5f8a1c2d-0003-4000-8000-000000000003"),
    "material": pair(MaterialResponse, material, "5f8a1c2d-0004-4000-8000-000000000004"),
    "client": pair(ClientResponse, client, "5f8a1c2d-0005-4000-8000-000000000005"),
    "client_with_stats": {
        "active": ClientWithStats(id="5f8a1c2d-0006-4000-8000-000000000006", **client,
                                  is_active=True, records_count=3,
                                  last_record="2026-08-01", total_paid=7500,
                                  missed_records=1).model_dump(mode="json"),
        "archived": ClientWithStats(id="5f8a1c2d-0006-4000-8000-000000000006", **client,
                                    is_active=False, records_count=0,
                                    last_record=None, total_paid=0,
                                    missed_records=0).model_dump(mode="json"),
    },
})

out = Path("packages/api-client/src/__fixtures__/backend-responses.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n")
print("wrote", out)
