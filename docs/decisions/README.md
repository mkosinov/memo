# Architecture Decision Records (ADR)

This directory contains Architecture Decision Records for the Memo project.

## What is an ADR?

An ADR captures a significant architectural decision, its context, and consequences. It serves as a historical record and helps future developers understand **why** certain choices were made.

## ADR Index

| # | Title | Status | Date |
|---|-------|--------|------|
| 001 | Use SQLite for storage | Accepted | 2026-05-20 |
| 002 | Use React Query for data fetching | Accepted | 2026-05-20 |
| 003 | Domain Rules as single source of truth | Accepted | 2026-05-28 |
| 004 | SuperAgents workflow for development | Accepted | 2026-05-15 |
| 005 | End-to-End Error Contract with Machine-Readable Codes | Accepted | 2026-06-20 |
| 006 | HTTP Contract Tests Are End-to-End (TestClient + Test SQLite), Not Mocked-Service | Accepted | 2026-08-03 |
| 007 | Composite Reads Stay Free Functions in Owning Service Modules (No `queries/` Layer) | Accepted | 2026-09-20 |
| 008 | Domain Events Are a Transactional Journal in the Main DB | Accepted | 2026-10-11 |
| 009 | Delivery Worker Is DB-Free — Full Snapshot Down, Status Events Back | Accepted | 2026-10-11 |
| 010 | arq + Redis as the Queue Transport | Superseded by 013 | 2026-10-11 |
| 011 | Channels Are Registry-Based Extensions; Templates and Rules Live in the Core | Accepted | 2026-10-11 |
| 012 | The Notification System Is Decomposed into Five Leaf Tasks under Container #476 | Accepted | 2026-10-11 |
| 013 | Redis Streams + Consumer Groups as the Queue Transport (redis-py Directly) | Accepted | 2026-10-21 |

## When to create an ADR?

Create an ADR when:
- Making an **architectural decision** (not implementation details)
- Choosing between **multiple approaches** with trade-offs
- Introducing a **new pattern** or convention
- Making a **breaking change** (API, data model, etc.)
- Documenting a **non-obvious trade-off**

Do NOT create an ADR for:
- Naming conventions → use `docs/domain-rules/_overview.md` (Naming Conventions)
- Implementation details → use code comments
- Temporary fixes → use TODO or scratchpad
- Bug fixes → use commit messages

## ADR Lifecycle

| Status | Meaning |
|--------|---------|
| Proposed | Under discussion, not yet decided |
| Accepted | Decision made, will be implemented |
| Deprecated | No longer relevant, replaced by another ADR |
| Superseded | Replaced by a newer ADR (reference the new one) |

## Template

Use `TEMPLATE.md` for new ADRs.

## File Naming

`NNN-title-with-hyphens.md` (e.g., `005-use-websockets.md`)
