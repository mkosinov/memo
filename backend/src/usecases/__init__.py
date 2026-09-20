"""Use cases layer — multi-entity business scenarios (GH #171).

Corridor 2 of the service canon (docs/domain-rules/service-layer.md
rules 2, 5, 6): each scenario is a PUBLIC function named after the
business action (``create_record``, ``delete_record``), decorated with
``@transactional`` — it opens ONE transaction, commits it, and publishes
the accumulated event batch (#239) for the whole chain.

A scenario composes ONLY service calls and domain functions; it never
imports ORM models directly. The transaction = the business-action
boundary (rule 6): decorated service methods are FORBIDDEN inside a
scenario (rule 5 — no nested transactions).
"""
