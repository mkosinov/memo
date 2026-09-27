"""Shared Pydantic schemas used across domains."""

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

ItemT = TypeVar("ItemT", bound=BaseModel)

# Sort direction for list endpoints (#205 Task 3). Shared across all
# dictionary list endpoints; per-entity sort_by whitelists live in their
# own schema modules.
SortOrder = Literal["asc", "desc"]


class PaginatedResponse(BaseModel, Generic[ItemT]):
    """List response envelope."""

    items: list[ItemT]
    total: int
    page: int
    per_page: int


class DeleteBody(BaseModel):
    """DELETE /{id} body — the deferred-delete commit state (GH #324 §4,
    the shared factory of the ``RecordDeleteBody``/#285 rev7 shape —
    ``TagDeleteBody``/#318 is its per-entity twin).

    Every real deletion must declare the dependency state the caller saw
    at dry-run time:

    * ``expected`` — id-sets per FK entity (the 409 tree's ``items``
      ids); leaves send ``{}``. Auto deps participate when sent but are
      never verified (the executor deletes the group anyway).
    * ``resolutions`` — the user's cascade choices; a busy subject sends
      ``{<entity>: "cascade"}`` for every non-auto dep alongside
      ``expected``.

    Both optional at the schema level: ``?dry_run=true`` needs no body,
    and the execute-path requirement (``expected`` mandatory) is enforced
    in the route branch so the preview stays body-free. Unknown body keys
    are ignored (family semantics §16).
    """

    resolutions: dict[str, str] | None = None
    expected: dict[str, list[str]] | None = None
