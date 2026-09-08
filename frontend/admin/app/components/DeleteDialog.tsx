'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { DependencyNode } from '@memo/api-client';

// ─── DeleteDialog — shared destructive-action dialog (GH #207 §7) ─────────────
//
// Two modes (§7.1/§7.2):
//  * Mode A — resolvable + auto deps: type-to-confirm input unlocks "Удалить";
//    confirming calls resolveDelete (DELETE /{id} WITH resolutions body;
//    auto deps omitted → server resolves them per §6 rule 3).
//  * Mode B — blocked by activities (`allowed_actions: []`): delete is not
//    offered, primary action is "Архивировать" (POST /{id}/archive).
//
// Design decision (Task 18): the dialog is fully presentational. Parents
// (tables, Tasks 19/20) own the no-body DELETE dry-run fetch flow and inject
// the mutations as callbacks mirroring the api-client shapes:
//   onResolve(id, resolutions) ↔ resolveDeleteX(id, resolutions)
//   onArchive(id)              ↔ archiveX(id)
// This keeps the dialog table-agnostic and avoids a hook-per-entityType map.
// Parents also own open/close state (the hooks' `dependencies` has no reset).

export type DeleteDialogEntityType = 'master' | 'location' | 'service' | 'material' | 'client' | 'record';

export interface DeleteDialogProps {
  /** Human-readable entity name — shown in the title and matched by the type-to-confirm field. */
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

/** FK-relation names whose deps are auto-resolved server-side — never user choice. */
const AUTO_ENTITIES = new Set([
  'users', // Master→users auto-cascade (§4.1)
  'master_tags',
  'location_tags',
  'service_tags',
  'client_tags',
  'record_tags', // Record→record_tags auto-cascade (Addendum 13 / GH #139)
  'service_materials', // Service/Material→service_materials join (GH #223 §7)
  'tariffs',
  'photos',
]);

// Auto deps use friendly plural labels; choice deps derive the plural from the
// backend `relation` label via RELATION_PLURAL. `relation` is the backend's
// single source of truth — extend one of these maps when the matrix grows.
const AUTO_ENTITY_LABEL: Record<string, string> = {
  users: 'Пользователь',
  master_tags: 'Теги',
  location_tags: 'Теги',
  service_tags: 'Теги',
  client_tags: 'Теги',
  record_tags: 'Теги',
  service_materials: 'Услуги', // GH #223 §7 — materials delete 409 tree
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
};

/** Genitive entity name — used in the title and the Mode B fallback hint. */
const TITLE_BY_TYPE: Record<DeleteDialogEntityType, string> = {
  master: 'мастера',
  location: 'локации',
  service: 'услуги',
  material: 'материала',
  client: 'клиента',
  record: 'записи',
};

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

function isAuto(dep: DependencyNode): boolean {
  return AUTO_ENTITIES.has(dep.entity);
}

/** → = will be deleted (cascade); ○ = will be unlinked (nullify). */
function actionMarker(dep: DependencyNode): string {
  return dep.allowed_actions[0] === 'nullify' ? '○' : '→';
}

function actionSuffix(dep: DependencyNode): string {
  if (dep.allowed_actions[0] === 'nullify') {
    const tail = NULLIFY_TAIL[dep.entity] ?? '';
    return pluralSuffix(dep.count, `отвязан${tail}`, `отвязаны${tail}`, `отвязаны${tail}`);
  }
  return pluralSuffix(dep.count, 'удалён', 'удалены', 'удалены');
}

function depLabel(dep: DependencyNode): string {
  return AUTO_ENTITY_LABEL[dep.entity] ?? RELATION_PLURAL[dep.relation] ?? dep.relation;
}

export function DeleteDialog({
  entityName,
  entityType,
  entityId,
  dependencies,
  onResolve,
  onArchive,
  onDone,
  onCancel,
}: DeleteDialogProps) {
  const [confirmName, setConfirmName] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
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

  const nameMatches = confirmName.trim().toLowerCase() === entityName.trim().toLowerCase();
  const allChoiceSelected = choiceDeps.every((d) => selected[d.entity] !== undefined);

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
      // Only non-auto resolutions go into the body (§6 rule 3) — auto deps
      // (join tables, Master→users per §4.1, tariffs, photos) are resolved
      // server-side and omitted from the payload.
      await onResolve(entityId, selected);
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

  const title = `Удаление «${TITLE_BY_TYPE[entityType]} ${entityName}»`;

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
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
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

  // ── Mode A — resolvable + auto deps (§7.1): type-to-confirm, delete primary. ──
  return overlay(
    <>
      <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }} data-testid="delete-dialog-title">
        {title}
      </h2>
      <p className="text-sm mt-3" style={{ color: 'var(--ink)' }}>
        Будет выполнено:
      </p>
      <ul className="flex flex-col gap-1.5 my-2">
        {autoDeps.map((dep) => (
          <li key={dep.entity} className="text-sm" style={{ color: 'var(--ink-mid)' }} data-testid={`dep-${dep.entity}`}>
            {`${actionMarker(dep)} ${depLabel(dep)}: ${dep.count} (${actionSuffix(dep)})`}
          </li>
        ))}
        {choiceDeps.map((dep) => {
          const picked = selected[dep.entity] !== undefined;
          const preview = dep.cascade_preview ? `; визиты: ${dep.cascade_preview.visits ?? '?'}` : '';
          const line = `${actionMarker(dep)} ${depLabel(dep)}: ${dep.count} (${actionSuffix(dep)}${preview})`;
          return (
            <li key={dep.entity} className="text-sm" data-testid={`dep-${dep.entity}`}>
              <button
                type="button"
                onClick={() =>
                  setSelected((s) => ({ ...s, [dep.entity]: dep.allowed_actions[0] ?? s[dep.entity]! }))
                }
                disabled={busy}
                className="w-full text-left rounded px-1 py-0.5 hover:bg-[var(--surface)] transition-colors"
                style={{ color: picked ? 'var(--danger)' : 'var(--ink)', fontWeight: picked ? 600 : 400 }}
              >
                {line}
              </button>
            </li>
          );
        })}
      </ul>
      <input
        data-testid="delete-dialog-confirm-input"
        type="text"
        placeholder="Введите название для подтверждения"
        value={confirmName}
        onChange={(e) => setConfirmName(e.target.value)}
        autoComplete="off"
        disabled={busy}
        className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)', color: 'var(--ink)' }}
      />
      {errorBlock}
      <div className="flex justify-end gap-2 mt-3">
        {cancelButton}
        <button
          data-testid="delete-dialog-confirm-btn"
          onClick={handleConfirm}
          disabled={busy || !nameMatches || !allChoiceSelected}
          className="px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--danger)' }}
        >
          {busy ? 'Удаление…' : 'Удалить'}
        </button>
      </div>
    </>,
  );
}
