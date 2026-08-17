import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DependencyNode } from '@memo/api-client';

// DeleteDialog is fully presentational (design decision — #207 Task 18):
// parents (tables, Tasks 19/20) own the dry-run fetch flow and inject the
// mutations as callbacks mirroring the api-client shapes:
//   onResolve(id, resolutions) ↔ resolveDeleteX(id, resolutions)
//   onArchive(id)              ↔ archiveX(id)
import { DeleteDialog } from '@/app/components/DeleteDialog';

// ─── Helpers ───────────────────────────────────────────────────────────────────

type ResolveFn = (id: string, resolutions: Record<string, string>) => Promise<void>;
type ArchiveFn = (id: string) => Promise<unknown>;

function renderDialog(props: {
  entityName: string;
  entityType: 'master' | 'location' | 'service' | 'material' | 'client';
  entityId: string;
  dependencies: DependencyNode[];
  onDone: () => void;
  onCancel: () => void;
  onResolve?: ResolveFn;
  onArchive?: ArchiveFn;
}) {
  const onResolve = props.onResolve ?? vi.fn<ResolveFn>().mockResolvedValue(undefined);
  const onArchive = props.onArchive ?? vi.fn<ArchiveFn>().mockResolvedValue(undefined);
  const result = render(
    <DeleteDialog
      entityName={props.entityName}
      entityType={props.entityType}
      entityId={props.entityId}
      dependencies={props.dependencies}
      onResolve={onResolve}
      onArchive={onArchive}
      onDone={props.onDone}
      onCancel={props.onCancel}
    />,
  );
  return { result, onResolve, onArchive };
}

function typeConfirmName(name: string): void {
  fireEvent.change(screen.getByPlaceholderText('Введите название для подтверждения'), {
    target: { value: name },
  });
}

const confirmBtn = (): HTMLButtonElement => {
  const el = screen.getByText('Удалить').closest('button');
  expect(el).not.toBeNull();
  return el as HTMLButtonElement;
};

// ─── Fixtures (mirror backend src/domain/deletion.py matrix / §5 tree shape) ──

// Master with only auto deps (users + tags) — the only Master tree that can
// reach Mode A (activities always block). Per §4.1 users is AUTO cascade.
const MASTER_ALL_AUTO: DependencyNode[] = [
  { entity: 'users', relation: 'Пользователь', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'master_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
];

// Client with every dependency kind (§4): records nullify choice, visitors
// cascade choice (+ cascade_preview), client_tags AUTO cascade.
const CLIENT_MIXED: DependencyNode[] = [
  { entity: 'records', relation: 'Запись', count: 47, allowed_actions: ['nullify'], message: null },
  {
    entity: 'visitors',
    relation: 'Посетитель',
    count: 12,
    allowed_actions: ['cascade'],
    message: null,
    cascade_preview: { visits: 45 },
  },
  { entity: 'client_tags', relation: 'Тег', count: 5, allowed_actions: ['cascade'], message: null },
];

// Blocked — activities present → Mode B (archive only).
const MASTER_BLOCKED: DependencyNode[] = [
  {
    entity: 'activities',
    relation: 'Активность',
    count: 3,
    allowed_actions: [],
    message: 'Удалите активности вручную или архивируйте',
  },
  { entity: 'master_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
];

// ─── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('DeleteDialog — Mode A (resolvable deps, §7.1)', () => {
  it('renders auto deps as fixed "→ ... (удалён/удалены)" lines with no choice UI', () => {
    renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_ALL_AUTO,
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.getByText(/Удаление «мастера Анна»/)).toBeInTheDocument();
    expect(screen.getByText(/→ Пользователь: 1 \(удалён\)/)).toBeInTheDocument();
    expect(screen.getByText(/→ Теги: 2 \(удалены\)/)).toBeInTheDocument();
    // auto deps never offer a choice
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // only the auto lines render in the deps list
    expect(screen.getAllByTestId(/^dep-/)).toHaveLength(2);
    expect(screen.getByText('Отмена')).toBeInTheDocument();
  });

  it('disables "Удалить" until the typed name matches (case/trim-insensitive)', () => {
    renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_ALL_AUTO,
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    const confirm = confirmBtn();
    expect(confirm).toBeDisabled();

    typeConfirmName('Wrong');
    expect(confirm).toBeDisabled();

    typeConfirmName('Анна');
    expect(confirm).toBeEnabled();

    typeConfirmName('  анна  ');
    expect(confirm).toBeEnabled();
  });

  it('confirm calls onResolve(id, {}) when all deps are auto, then onDone', async () => {
    const onDone = vi.fn();
    const { onResolve } = renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_ALL_AUTO,
      onDone,
      onCancel: vi.fn(),
    });

    typeConfirmName('Анна');
    fireEvent.click(confirmBtn());

    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('m1', {}));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('"Отмена" calls onCancel', () => {
    const onCancel = vi.fn();
    renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_ALL_AUTO,
      onDone: vi.fn(),
      onCancel,
    });

    fireEvent.click(screen.getByText('Отмена'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error when resolve rejects; onDone is not called', async () => {
    const onDone = vi.fn();
    const onResolve = vi.fn().mockRejectedValue(new Error('boom'));
    renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_ALL_AUTO,
      onDone,
      onCancel: vi.fn(),
      onResolve,
    });

    typeConfirmName('Анна');
    fireEvent.click(confirmBtn());

    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('DeleteDialog — Mode A (client with user-choice deps)', () => {
  it('renders ○ nullify / → cascade lines with counts and cascade_preview; auto tags not selectable', () => {
    renderDialog({
      entityName: 'Иван',
      entityType: 'client',
      entityId: 'c1',
      dependencies: CLIENT_MIXED,
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.getByText(/○ Записи: 47 \(отвязаны от клиента\)/)).toBeInTheDocument();
    expect(screen.getByText(/→ Посетители: 12 \(удалены; визиты: 45\)/)).toBeInTheDocument();
    expect(screen.getByText(/→ Теги: 5 \(удалены\)/)).toBeInTheDocument();
    // the auto tags row is not a selectable control
    expect(screen.getByTestId('dep-client_tags').querySelector('button')).toBeNull();
  });

  it('Service photos nullify renders the spec §7.1 exact string "(отвязаны от услуги)"', () => {
    renderDialog({
      entityName: 'Маникюр',
      entityType: 'service',
      entityId: 's1',
      dependencies: [
        { entity: 'photos', relation: 'Фото', count: 12, allowed_actions: ['nullify'], message: null },
      ],
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.getByText('○ Фото: 12 (отвязаны от услуги)')).toBeInTheDocument();
  });

  it('confirm sends only non-auto resolutions (auto client_tags omitted), then onDone', async () => {
    const onDone = vi.fn();
    const { onResolve } = renderDialog({
      entityName: 'Иван',
      entityType: 'client',
      entityId: 'c1',
      dependencies: CLIENT_MIXED,
      onDone,
      onCancel: vi.fn(),
    });

    // nothing selected yet — button stays disabled even with the name typed
    typeConfirmName('Иван');
    expect(confirmBtn()).toBeDisabled();

    fireEvent.click(screen.getByText(/Записи: 47/)); // select nullify
    expect(confirmBtn()).toBeDisabled(); // visitors still unresolved

    fireEvent.click(screen.getByText(/Посетители: 12/)); // select cascade
    expect(confirmBtn()).toBeEnabled();

    fireEvent.click(confirmBtn());
    // toHaveBeenCalledWith on the EXACT object (deep equality) also proves the
    // auto dep client_tags is omitted from the resolutions body.
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith('c1', { records: 'nullify', visitors: 'cascade' }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('shows an inline error when resolve rejects; onDone is not called', async () => {
    const onDone = vi.fn();
    const onResolve = vi.fn().mockRejectedValue(new Error('client boom'));
    renderDialog({
      entityName: 'Иван',
      entityType: 'client',
      entityId: 'c1',
      dependencies: CLIENT_MIXED,
      onDone,
      onCancel: vi.fn(),
      onResolve,
    });

    fireEvent.click(screen.getByText(/Записи: 47/));
    fireEvent.click(screen.getByText(/Посетители: 12/));
    typeConfirmName('Иван');
    fireEvent.click(confirmBtn());

    await waitFor(() => expect(screen.getByText(/client boom/)).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('DeleteDialog — Mode B (blocked by activities → archive, §7.2)', () => {
  it('shows the block message with count + backend hint; "Архивировать" present, "Удалить" absent', () => {
    renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_BLOCKED,
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.getByText(/Нельзя удалить: есть 3 активности\./)).toBeInTheDocument();
    // backend `message` preferred over hardcoded strings (design decision)
    expect(screen.getByText(/Удалите активности вручную или архивируйте/)).toBeInTheDocument();
    expect(screen.queryByText('Удалить')).not.toBeInTheDocument();
    expect(screen.getByText('Архивировать')).toBeInTheDocument();
  });

  it('pluralizes the activities count (1 активность)', () => {
    renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_BLOCKED.map((d) => (d.entity === 'activities' ? { ...d, count: 1 } : d)),
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(screen.getByText(/Нельзя удалить: есть 1 активность\./)).toBeInTheDocument();
  });

  it('fallback hint (no backend message) matches spec §7.2 incl. entity-specific suffix', () => {
    renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_BLOCKED.map((d) => (d.entity === 'activities' ? { ...d, message: null } : d)),
      onDone: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(
      screen.getByText('Сначала удалите активности вручную или архивируйте мастера.'),
    ).toBeInTheDocument();
  });

  it('clicking "Архивировать" calls onArchive(id), then onDone', async () => {
    const onDone = vi.fn();
    const { onArchive } = renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_BLOCKED,
      onDone,
      onCancel: vi.fn(),
    });

    fireEvent.click(screen.getByText('Архивировать'));
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('"Отмена" in Mode B calls onCancel without archiving', () => {
    const onCancel = vi.fn();
    const { onArchive } = renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_BLOCKED,
      onDone: vi.fn(),
      onCancel,
    });

    fireEvent.click(screen.getByText('Отмена'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it('shows an inline error when archive rejects; onDone is not called', async () => {
    const onDone = vi.fn();
    const onArchive = vi.fn().mockRejectedValue(new Error('archive failed'));
    renderDialog({
      entityName: 'Анна',
      entityType: 'master',
      entityId: 'm1',
      dependencies: MASTER_BLOCKED,
      onDone,
      onCancel: vi.fn(),
      onArchive,
    });

    fireEvent.click(screen.getByText('Архивировать'));
    await waitFor(() => expect(screen.getByText(/archive failed/)).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});
