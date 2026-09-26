"""Shared FULL-form DELETE contract for the dependent subjects (GH #324 Task 5).

Spec §10 (docs/specs/2026-09-21-delete-family-remaining-324-design.md):
ONE parametrized contract suite runs on the three DEPENDENT subjects —
photos (``photo_tags``), visitors (``visits`` + ``visitor_tags``),
positions (``staff_positions``). The per-entity files
(``test_api_photos`` / ``test_api_visitors`` / ``test_api_positions``)
subclass :class:`DependentDeleteContractMixin` and provide the
``busy_subject`` fixture — a :class:`DependentSubject` world spec built
through the shared conftest factories (the ``test_api_tags.py:178+``
pattern: API factories where they exist, raw SQL for join tables).

Not duplicated here (pinned elsewhere, §10 placement):

* the four FORM 422s (bare / resolutions-without-expected /
  dry_run+resolutions / dry_run+expected-only) — once for ALL six
  routes in ``test_errors.py``, on cannot-exist ids (the form runs
  before the existence probe);
* the smoke-level per-route cases — ``test_api_delete_family_routes.py``
  (dry_run clean 204, dry_run unknown/foreign 404, the plain
  appeared-dep stale 409, commit-clean ``{expected: {}}``, the
  positions ``is_system`` guard).

Cases this suite adds (the missing depth on top of the smoke level):

* bare DELETE and a resolutions-only body on a BUSY subject → 422 with
  the subject AND its dependency rows untouched;
* dry_run on the busy subject → 409 with the FULL tree: entity set,
  ``relation``, ``count``, ``allowed_actions == ["cascade"]`` (§3 —
  every node of the new subjects carries it), the ``auto`` perspective
  flag, and per-row ``items`` (id, label) pairs;
* dry_run + expected-only body → the preview proceeds (409, same
  tree): the body shape is legal and silently ignored (§4.1);
* commit with resolutions+expected → 204 and the EXECUTOR effects
  (§5: join rows stripped before the subject row, related rows
  survive, per-entity recompute);
* a dependency that DISAPPEARED mid-window → subset semantics → 204
  (§4.5: deleting less than was confirmed is safe);
* resolutions validation (§4.5): a busy non-auto dep without an
  action → 422; an action outside ``allowed_actions`` ("nullify") →
  422 — rows alive in both cases;
* ORDER PIN (#285 D7 mirror): a stale expected → 409 even when the
  resolutions would also be invalid;
* commit on a cannot-exist id WITH body → 404 (probe after the form).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import pytest


@dataclass(frozen=True)
class DependentSubject:
    """The busy world of one dependent subject, as the mixin needs it.

    ``tree`` — the EXPECTED 409 dry-run tree: entity → node fragment
    ``{"relation": str, "count": int, "auto": bool, "items":
    set[tuple[str, str]]}`` (``allowed_actions == ["cascade"]`` is
    pinned uniformly for every node — spec §3). Closures
    (``alive`` / ``subject_gone`` / ``executor_effects`` /
    ``remove_one_dep``) capture the building api_client and assert
    against the live world.
    """

    url: str
    unknown_url: str
    unknown_code: str
    tree: dict[str, dict]
    resolutions: dict[str, str]
    expected: dict[str, list[str]]
    alive: Callable[[], None]
    subject_gone: Callable[[], None]
    executor_effects: Callable[[], None]
    remove_one_dep: Callable[[], None]


class DependentDeleteContractMixin:
    """The parametrized FULL-form contract cases (subclass per subject).

    A subclass MUST provide a ``busy_subject`` fixture returning a
    :class:`DependentSubject` (see the photos/visitors/positions
    suites). Inherited test methods resolve it through the subclass's
    own class scope.
    """

    pytestmark = pytest.mark.api

    # ── form on a BUSY subject: 422 with the world untouched ──────────────

    def test_bare_delete_busy_returns_422_rows_alive(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.1: no flag, no body → 422 expected_state_required; the
        subject row AND its dependency rows stay alive (the bare
        silent-delete path is abolished)."""
        resp = api_client.delete(busy_subject.url)
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == "expected_state_required"
        busy_subject.alive()

    def test_resolutions_without_expected_returns_422_rows_alive(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.1: a resolutions-only body is the rejected legacy shape →
        422 expected_state_required; nothing deleted."""
        resp = api_client.request(
            "DELETE", busy_subject.url,
            json={"resolutions": dict(busy_subject.resolutions)},
        )
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == "expected_state_required"
        busy_subject.alive()

    # ── dry_run preview on the busy subject: the FULL tree ────────────────

    def test_dry_run_busy_returns_409_full_tree_rows_alive(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.4: pure preview → 409 has_dependencies + tree. Every node:
        relation, count, ``allowed_actions == ["cascade"]`` (§3), the
        ``auto`` perspective flag, per-row items (id, label). The
        preview modifies nothing."""
        resp = api_client.request(
            "DELETE", busy_subject.url, params={"dry_run": "true"},
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert set(deps) == set(busy_subject.tree), (
            f"tree entities {sorted(deps)} != expected "
            f"{sorted(busy_subject.tree)}"
        )
        for entity, want in busy_subject.tree.items():
            node = deps[entity]
            assert node["relation"] == want["relation"], entity
            assert node["count"] == want["count"], entity
            assert node["allowed_actions"] == ["cascade"], entity
            assert node["auto"] is want["auto"], entity
            got_items = {(i["id"], i["label"]) for i in node["items"]}
            assert got_items == set(want["items"]), entity
            for _id, label in got_items:
                assert label, f"{entity}: empty item label"
        busy_subject.alive()

    def test_dry_run_with_expected_only_body_proceeds(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.1 combinatorics: dry_run + expected-only body → the body
        shape is legal and silently IGNORED — the preview proceeds to
        the same 409 tree."""
        resp = api_client.request(
            "DELETE", busy_subject.url,
            params={"dry_run": "true"},
            json={"expected": dict(busy_subject.expected)},
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert set(deps) == set(busy_subject.tree)
        busy_subject.alive()

    # ── commit branch ─────────────────────────────────────────────────────

    def test_commit_unknown_id_with_body_returns_404(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.2: a cannot-exist id WITH body → 404 (the probe runs after
        the form checks)."""
        resp = api_client.request(
            "DELETE", busy_subject.unknown_url, json={"expected": {}},
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"]["code"] == busy_subject.unknown_code

    def test_commit_full_resolutions_and_expected_204(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.5: correct resolutions + expected → 204 and the EXECUTOR
        effects (§5: join clean first, then the subject row; related
        rows survive; per-entity recomputes)."""
        resp = api_client.request(
            "DELETE", busy_subject.url,
            json={
                "resolutions": dict(busy_subject.resolutions),
                "expected": {k: list(v) for k, v in busy_subject.expected.items()},
            },
        )
        assert resp.status_code == 204, resp.text
        busy_subject.executor_effects()

    def test_commit_dep_disappeared_subset_passes_204(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.5 subset semantics: a dep removed mid-window (absent from
        the live world but still claimed by ``expected``) does NOT
        block — deleting less than was confirmed is safe → 204."""
        busy_subject.remove_one_dep()

        resp = api_client.request(
            "DELETE", busy_subject.url,
            json={
                "resolutions": dict(busy_subject.resolutions),
                "expected": {k: list(v) for k, v in busy_subject.expected.items()},
            },
        )

        assert resp.status_code == 204, resp.text
        busy_subject.subject_gone()

    def test_commit_missing_resolution_returns_422_rows_alive(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.5 resolutions validation: a busy non-auto dep without an
        action → 422; the subject and its deps stay alive."""
        resp = api_client.request(
            "DELETE", busy_subject.url,
            json={
                "resolutions": {},  # every non-auto dep misses its action
                "expected": {k: list(v) for k, v in busy_subject.expected.items()},
            },
        )
        assert resp.status_code == 422, resp.text
        busy_subject.alive()

    def test_commit_invalid_action_returns_422_rows_alive(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """§4.5 resolutions validation: an action outside
        ``allowed_actions`` ("nullify" — cascade-only nodes, §3) → 422;
        rows alive."""
        bad = dict(busy_subject.resolutions)
        non_auto = next(iter(busy_subject.resolutions))
        bad[non_auto] = "nullify"

        resp = api_client.request(
            "DELETE", busy_subject.url,
            json={
                "resolutions": bad,
                "expected": {k: list(v) for k, v in busy_subject.expected.items()},
            },
        )
        assert resp.status_code == 422, resp.text
        busy_subject.alive()

    def test_stale_beats_invalid_resolutions_returns_409(
        self, api_client, busy_subject: DependentSubject,
    ) -> None:
        """ORDER PIN (#285 D7 mirror, §4.5): expected verification runs
        BEFORE resolutions validation — a stale expected ({} while deps
        exist) → 409 stale_dependencies even though the resolutions are
        also invalid; nothing deleted."""
        resp = api_client.request(
            "DELETE", busy_subject.url,
            json={"resolutions": {}, "expected": {}},
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"] == "stale_dependencies"
        busy_subject.alive()
