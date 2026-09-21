'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { DependencyNode } from '@memo/api-client';

// ─── DeleteDialog — shared destructive-action dialog (GH #207 §7) ─────────────
//
// Two modes (§7.1/§7.2):
//  * Mode A — resolvable + auto deps: the dep list is informational; a single
//    "Подтверждаю удаление зависимостей" checkbox gates "Удалить" (all-auto trees have no
//    checkbox and confirm immediately); confirming calls resolveDelete
//    (DELETE /{id} WITH resolutions body — every choice dep resolved with its
//    only allowed action; auto deps omitted → server resolves them per §6 rule 3).
//  * Mode B — blocked by activities (`allowed_actions: []`): delete is not
//    offered, primary action is "Архивировать" (POST /{id}/archive).
//
// Design decision (Task 18): the dialog is fully presentational. Parents
// (tables, Tasks 19/20) own the dry-run fetch flow and inject the mutations
// as callbacks mirroring the api-client shapes:
//   onResolve(id, resolutions) ↔ resolveDeleteX(id, resolutions)
//   onArchive(id)              ↔ archiveX(id)
// This keeps the dialog table-agnostic and avoids a hook-per-entityType map.
// Parents also own open/close state (the hooks' `dependencies` has no reset).
//
// GH #285 (records) / GH #286 (activities): the parent's confirm callback
// ENQUEUES a deferred delete (removeRecordResolved / deleteActivityConfirmed)
// — the enqueue is synchronous, so the dialog closes immediately via onDone;
// the real DELETE runs in the 5s commit. The rendering is unchanged for every
// other entity (instant resolveDelete).

export type DeleteDialogEntityType = 'staff' | 'master' | 'location' | 'service' | 'material' | 'client' | 'record' | 'activity' | 'tag';

export interface DeleteDialogProps {
  /** Human-readable entity name — shown in the dialog title. */
  entityName: string;
  /** Entity kind — used for the dialog title wording ("«мастера Анна»" etc.). */
  entityType: DeleteDialogEntityType;
  /** Entity row id, passed to the injected mutations. */
  entityId: string;
  /**
   * Dependency tree already fetched from the no-body DELETE 409 dry-run (§7.3).
   * The PARENT owns the initial DELETE call and the open/close state — do not
   * derive visibility from the hooks' `dependencies` state (no exposed reset).
   */
  dependencies: DependencyNode[];
  /**
   * #286: optional refresh banner text — rendered as the dialog's FIRST line
   * when the parent's ensure-fresh refetched the cache before the dry-run
   * («Карточка обновлена по данным сервера»). Undefined → no banner (the
   * clean path never primes the dialog).
   */
  refetchNote?: string;
  /** Execute the hard delete (DELETE /{id} WITH `{ resolutions }` body, §6). */
  onResolve: (id: string, resolutions: Record<string, string>) => Promise<void>;
  /** Archive the entity (POST /{id}/archive) — Mode B primary action. */
  onArchive: (id: string) => Promise<unknown>;
  /** Called after a successful delete/archive — close the dialog + refresh lists. */
  onDone: () => void;
  /** Called when the user cancels (Отмена / backdrop click / Escape) — no action. */
  onCancel: () => void;
}

// ─── §4 FK matrix facts (mirrors backend src/domain/deletion.py) ──────────────

// Auto deps are flagged by the backend itself: rev8 (#285) copies the matrix's
// ``FKDependency.auto`` into every DependencyNode — the client-classification
// below is FIELD-based (isAuto), with no entity-name hardcode (#286 Task 6).

// Auto deps use friendly plural labels; choice deps derive the plural from the
// backend `relation` label via RELATION_PLURAL. `relation` is the backend's
// single source of truth — extend one of these maps when the matrix grows.
// GH #318 D9: the five *_tags join entities are DELIBERATELY ABSENT — both
// sides of each join now derive from `relation` (parent side: relation «Тег»
// → RELATION_PLURAL fallback «Теги»; tag side: relation = the parent entity
// → its plural). The entity-keyed map is side-blind and must not own them.
const AUTO_ENTITY_LABEL: Record<string, string> = {
  users: 'Пользователь',
  masters: 'Мастер', // GH #266: the schedule extension row (relation «Мастер»)
  staff_positions: 'Должности', // GH #266: M2M position links (relation «Должность»)
  tariffs: 'Тарифы',
  photos: 'Фото',
};

const RELATION_PLURAL: Record<string, string> = {
  Активность: 'Активности',
  Запись: 'Записи',
  Посетитель: 'Посетители',
  // Record deps (Addendum 13 / GH #139) — backend deletion.py relation labels.
  Посещение: 'Посещения',
  Платёж: 'Платежи',
  // service_materials join (GH #223 §7) — SIDE-AWARE: the join is listed in
  // the backend FK_MATRIX for BOTH endpoints, each shipping its own relation
  // label, so the entity-keyed AUTO_ENTITY_LABEL map (side-blind) must not
  // own this label. Material delete → relation «Услуга» → «Услуги»;
  // Service delete → relation «Материал» → «Материалы» (deletion.py:166/:204).
  Услуга: 'Услуги',
  Материал: 'Материалы',
  // Join/tag relation shared by the *_tags joins (#286/#318) — parent-side
  // trees (relation «Тег») fall here; the tag-side tree carries the PARENT
  // relation labels (below) instead.
  Тег: 'Теги',
  // GH #318 D9: tag-side tree relations — the eight *_tags joins FROM THE
  // TAG'S SIDE ship the parent entity as `relation` (deletion.py FK_MATRIX[Tag]).
  Занятие: 'Занятия',
  Мастер: 'Мастера',
  Локация: 'Локации',
  Клиент: 'Клиенты',
  Фото: 'Фото',
};

/** Genitive entity name — used in the title and the Mode B fallback hint. */
const TITLE_BY_TYPE: Record<DeleteDialogEntityType, string> = {
  staff: 'сотрудника', // GH #266: the «Сотрудники» directory card
  master: 'мастера',
  location: 'локации',
  service: 'услуги',
  material: 'материала',
  client: 'клиента',
  record: 'записи',
  activity: 'занятия', // #286: deferred activity delete (schedule card/modal)
  tag: 'тега', // #318: deferred tag delete (tags directory)
};

// #286 (spec §4): the activity tree's auto deps (photos/activity_tags) are
// implicit cascades (SET NULL / join rows) — their drift destroys no data and
// requires no confirmation, so they are NOT rendered in the dialog and not
// part of the confirmed subtree (`expected`). Every other entity keeps the
// informational auto lines (#207 §7.1 — «Без изменений: диалоги других
// сущностей»).
const AUTO_LINES_HIDDEN: ReadonlySet<DeleteDialogEntityType> = new Set<DeleteDialogEntityType>(['activity']);

// Per-relation nullify tail (spec §7.1: "○ Фото: 12 (отвязаны от услуги)").
// Nullify deps exist only for Service→photos and Client→records (§4 matrix);
// extend when the matrix grows.
const NULLIFY_TAIL: Record<string, string> = {
  photos: ' от услуги',
  records: ' от клиента',
};

// ─── helpers ───────────────────────────────────────────────────────────────────

function pluralSuffix(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** rev8 (#285): the backend flags server-resolved deps — field, not hardcode. */
function isAuto(dep: DependencyNode): boolean {
  return dep.auto === true;
}

/** → = will be deleted (cascade); ○ = will be unlinked (nullify). */
function actionMarker(dep: DependencyNode): string {
  return dep.allowed_actions[0] === 'nullify' ? '○' : '→';
}

function actionSuffix(dep: DependencyNode, entityType: DeleteDialogEntityType): string {
  if (dep.allowed_actions[0] === 'nullify') {
    const tail = NULLIFY_TAIL[dep.entity] ?? '';
    return pluralSuffix(dep.count, `отвязан${tail}`, `отвязаны${tail}`, `отвязаны${tail}`);
  }
  // #318 D9: the tag dialog unlinks, never destroys — the parents stay, the
  // links die. Per-type suffix («снят/сняты»), the AUTO_LINES_HIDDEN pattern.
  if (entityType === 'tag') {
    return pluralSuffix(dep.count, 'снят', 'сняты', 'сняты');
  }
  return pluralSuffix(dep.count, 'удалён', 'удалены', 'удалены');
}

function depLabel(dep: DependencyNode): string {
  return AUTO_ENTITY_LABEL[dep.entity] ?? RELATION_PLURAL[dep.relation] ?? dep.relation;
}

// ─── GH #285 D9в — per-item one-liners for record dependency nodes ────────────
// Nodes carrying `items` (id + human-readable label — the record dry-run tree)
// render a group: header «{plural} — будут удалены:» + one line per item,
// capped at 10 lines + «и ещё N». The counter line («Посещения: 2 (удалены)»)
// is replaced — the rows themselves are the information. Nodes without items
// (every other entity, auto join-rows) keep the counter line.

/** Max item lines shown before the «и ещё N» tail (spec D9в). */
const ITEM_LINES_CAP = 10;

function DepItemGroup({
  dep,
  entityType,
}: {
  dep: DependencyNode;
  entityType: DeleteDialogEntityType;
}) {
  const items = dep.items ?? [];
  // #318 D9: same per-type tail as the counter line — the tag dialog's
  // groups say «будут сняты», every other entity keeps «будут удалены».
  const groupTail = entityType === 'tag' ? 'будут сняты' : 'будут удалены';
  return (
    <>
      <div className="font-medium" style={{ color: 'var(--ink)' }}>
        {`${depLabel(dep)} — ${groupTail}:`}
      </div>
      <ul className="mt-1 flex flex-col gap-0.5 pl-4 list-disc">
        {items.slice(0, ITEM_LINES_CAP).map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
        {items.length > ITEM_LINES_CAP && (
          <li key="more">{`и ещё ${items.length - ITEM_LINES_CAP}`}</li>
        )}
      </ul>
    </>
  );
}

/** A dep row: with items → the group; without → the legacy counter line
 *  («→ Посещения: 2 (удалены)», with the cascade_preview tail when present). */
function DepRow({
  dep,
  entityType,
}: {
  dep: DependencyNode;
  entityType: DeleteDialogEntityType;
}) {
  const hasItems = Array.isArray(dep.items) && dep.items.length > 0;
  if (hasItems) {
    return (
      <li className="text-sm" style={{ color: 'var(--ink-mid)' }} data-testid={`dep-${dep.entity}`}>
        <DepItemGroup dep={dep} entityType={entityType} />
      </li>
    );
  }
  const preview = dep.cascade_preview ? `; визиты: ${dep.cascade_preview.visits ?? '?'}` : '';
  return (
    <li className="text-sm" style={{ color: 'var(--ink-mid)' }} data-testid={`dep-${dep.entity}`}>
      {`${actionMarker(dep)} ${depLabel(dep)}: ${dep.count} (${actionSuffix(dep, entityType)}${preview})`}
    </li>
  );
}

export function DeleteDialog({
  entityName,
  entityType,
  entityId,
  dependencies,
  refetchNote,
  onResolve,
  onArchive,
  onDone,
  onCancel,
}: DeleteDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = useMemo(
    () => dependencies.some((d) => d.allowed_actions.length === 0),
    [dependencies],
  );
  const choiceDeps = useMemo(
    () => dependencies.filter((d) => d.allowed_actions.length > 0 && !isAuto(d)),
    [dependencies],
  );
  const autoDeps = useMemo(
    () => dependencies.filter((d) => d.allowed_actions.length > 0 && isAuto(d)),
    [dependencies],
  );
  // #286 (spec §4): activities hide the informational auto lines entirely —
  // photos/activity_tags cascade implicitly and are not user-confirmed.
  const showAutoLines = !AUTO_LINES_HIDDEN.has(entityType);

  const needsConfirm = choiceDeps.length > 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Every choice dep resolves with its only allowed action (the §4 matrix
      // gives each exactly one today). Auto deps stay OUT of the body (§6
      // rule 3) — the server resolves them.
      const resolutions = Object.fromEntries(
        choiceDeps.map((d) => [d.entity, d.allowed_actions[0]!]),
      );
      await onResolve(entityId, resolutions);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onArchive(entityId);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось архивировать. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  // #286: the activity pending-confirm carries only the id — no human label —
  // so a nameless render falls back to the plain genitive («Удаление занятия»).
  const title = entityName
    ? `Удаление «${TITLE_BY_TYPE[entityType]} ${entityName}»`
    : `Удаление ${TITLE_BY_TYPE[entityType]}`;

  // #286: refresh notice — the FIRST line of the dialog, only when the parent
  // actually refetched before the dry-run (refetchNote undefined → nothing).
  const refetchBanner = refetchNote && (
    <p
      className="mb-2 rounded-lg px-3 py-1.5 text-xs"
      style={{ backgroundColor: 'var(--surface)', color: 'var(--ink-mid)' }}
      data-testid="delete-dialog-refetch-note"
    >
      {refetchNote}
    </p>
  );

  const errorBlock = error && (
    <p role="alert" style={{ color: 'var(--danger)' }} data-testid="delete-dialog-error">
      {error}
    </p>
  );

  const cancelButton = (
    <button
      data-testid="delete-dialog-cancel-btn"
      onClick={onCancel}
      disabled={busy}
      className="px-4 py-2 text-sm rounded-lg border transition-colors"
      style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
    >
      Отмена
    </button>
  );

  // Mobile-first overlay per admin convention (MasterModal/ActivityDetailsModal):
  // full-screen fixed wrapper + dark backdrop; backdrop click = Отмена.
  const overlay = (children: ReactNode): ReactElement => (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      data-testid="delete-dialog-overlay"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        data-testid="delete-dialog-backdrop"
        onClick={onCancel}
      />
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl px-5 py-4"
        style={{ backgroundColor: 'var(--white)' }}
        data-testid="delete-dialog"
      >
        {children}
      </div>
    </div>
  );

  // ── Mode B — blocked by activities (§7.2): archive-only, no "Удалить". ──
  if (blocked) {
    const blockDep = dependencies.find((d) => d.allowed_actions.length === 0)!;
    const plural = pluralSuffix(blockDep.count, 'активность', 'активности', 'активностей');
    return overlay(
      <>
        <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }} data-testid="delete-dialog-title">
          {title}
        </h2>
        <p className="text-sm mt-3" style={{ color: 'var(--ink)' }} data-testid="delete-dialog-block-message">
          Нельзя удалить: есть {blockDep.count} {plural}.
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--ink-mid)' }} data-testid="delete-dialog-block-hint">
          {blockDep.message ?? `Сначала удалите активности вручную или архивируйте ${TITLE_BY_TYPE[entityType]}.`}
        </p>
        {errorBlock}
        <div className="flex justify-end gap-2 mt-4">
          {cancelButton}
          <button
            data-testid="delete-dialog-archive-btn"
            onClick={handleArchive}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {busy ? 'Архивирование…' : 'Архивировать'}
          </button>
        </div>
      </>,
    );
  }

  // ── Mode A — resolvable + auto deps (§7.1): confirm-checkbox, delete primary. ──
  return overlay(
    <>
      {refetchBanner}
      <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }} data-testid="delete-dialog-title">
        {title}
      </h2>
      <p className="text-sm mt-3" style={{ color: 'var(--ink)' }}>
        Будет выполнено:
      </p>
      <ul className="flex flex-col gap-1.5 my-2">
        {showAutoLines && autoDeps.map((dep) => (
          <DepRow key={dep.entity} dep={dep} entityType={entityType} />
        ))}
        {choiceDeps.map((dep) => (
          <DepRow key={dep.entity} dep={dep} entityType={entityType} />
        ))}
      </ul>
      {needsConfirm && (
        <label
          className="flex items-center gap-2 mt-1 cursor-pointer"
          style={{ color: 'var(--ink)' }}
        >
          <input
            type="checkbox"
            data-testid="delete-dialog-confirm-checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={() => setConfirmed((c) => !c)}
            className="shrink-0 rounded accent-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2"
          />
          <span className="text-sm font-medium">Подтверждаю удаление зависимостей</span>
        </label>
      )}
      {errorBlock}
      <div className="flex justify-end gap-2 mt-3">
        {cancelButton}
        <button
          data-testid="delete-dialog-confirm-btn"
          onClick={handleConfirm}
          disabled={busy || (needsConfirm && !confirmed)}
          className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--danger)' }}
        >
          {busy ? 'Удаление…' : 'Удалить'}
        </button>
      </div>
    </>,
  );
}
