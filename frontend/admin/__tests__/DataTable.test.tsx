import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react';
import React from 'react';

import { DataTable } from '@/app/components/shared/DataTable';
import type {
  ColumnDef,
  DataTableProps,
  PagedListState,
  RowAction,
} from '@/app/components/shared/tableTypes';
import { makeTableState } from './helpers/makeTableState';

// ─── Test fixtures ───────────────────────────────────────────────────────

interface Tag {
  id: string;
  tag: string;
}

const TAGS: Tag[] = [
  { id: 't-1', tag: 'Альфа' },
  { id: 't-2', tag: 'Бета' },
];

const COLUMNS: ColumnDef<Tag>[] = [
  { key: 'tag', label: 'Тег', defaultVisible: true, accessor: (t) => t.tag },
  {
    key: 'count',
    label: 'Число',
    defaultVisible: true,
    render: (t) => <b data-testid={`count-cell-${t.id}`}>{t.tag}-n</b>,
  },
  // Never visible by default — proves hidden columns stay hidden
  { key: 'secret', label: 'Секрет', defaultVisible: false, accessor: (t) => t.id },
];

/** Default actions: edit + danger delete + a hidden one (§6.3 filtering). */
function makeActions(spies?: { onEdit?: () => void; onDelete?: () => void }) {
  return (row: Tag): RowAction<Tag>[] => [
    { label: 'Редактировать', onClick: () => spies?.onEdit?.() ?? undefined },
    { label: 'Удалить', danger: true, onClick: () => spies?.onDelete?.() ?? undefined },
    { label: 'Скрытое действие', hidden: () => true, onClick: vi.fn() },
  ];
}

const EMPTY_ACTIONS = () => [] as RowAction<Tag>[];

/** Render a DataTable with default columns; state overrides applied. */
function renderTable(
  overrides: Partial<PagedListState<Tag>> & { items?: Tag[] } = {},
  props: Partial<Omit<DataTableProps<Tag>, 'columns' | 'tableState'>> = {},
) {
  const { items, ...stateOverrides } = overrides;
  const tableState = makeTableState<Tag>({ items: items ?? TAGS, ...stateOverrides });
  const view = render(
    <DataTable<Tag>
      storageKey="test-columns"
      columns={COLUMNS}
      tableState={tableState}
      actions={makeActions()}
      rowKey={(t) => t.id}
      {...props}
    />,
  );
  return { view, tableState };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

// ─── Async state: skeleton / error / empty ───────────────────────────────

describe('DataTable async states', () => {
  it('isPending renders 10 skeleton rows × visible columns only', () => {
    renderTable({ items: [], isPending: true });

    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(10);
    expect(document.querySelectorAll('tbody td')).toHaveLength(20); // 2 visible columns
    rows.forEach((row) => {
      expect(row.querySelector('.animate-pulse')).not.toBeNull();
    });
    // No data, no "Загрузка..." text — skeleton only
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();
    expect(screen.queryByText('Нет записей')).not.toBeInTheDocument();
  });

  it('skeleton honors reduced column visibility from LS', () => {
    localStorage.setItem('test-columns', JSON.stringify(['tag']));
    renderTable({ items: [], isPending: true });

    expect(document.querySelectorAll('tbody td')).toHaveLength(10); // 1 visible column × 10
    expect(screen.queryByText('Число')).not.toBeInTheDocument();
  });

  it('error with no rows renders the ErrorState row; Повторить calls refetch', () => {
    renderTable({ items: [], error: new Error('boom') });

    const alert = screen.getByTestId('error-state');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Ошибка загрузки: boom');
    expect(screen.queryByText('Удалить')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Повторить'));
    expect(screen.getByText('Повторить')).toBeInTheDocument();
  });

  it('error row retry calls tableState.refetch()', () => {
    const refetch = vi.fn();
    renderTable({ items: [], error: new Error('boom'), refetch });

    fireEvent.click(screen.getByText('Повторить'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('error WITH rows keeps the rows and renders no error row', () => {
    renderTable({ error: new Error('boom') });

    expect(screen.getByText('Альфа')).toBeInTheDocument();
    expect(screen.getByText('Бета')).toBeInTheDocument();
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
  });

  it('empty state renders the default empty label', () => {
    renderTable({ items: [] });
    expect(screen.getByText('Нет записей')).toBeInTheDocument();
  });

  it('empty state renders the custom emptyLabel', () => {
    renderTable({ items: [] }, { emptyLabel: 'Теги не найдены' });
    expect(screen.getByText('Теги не найдены')).toBeInTheDocument();
  });

  it('renders visibleItems (filtered view) instead of items when present', () => {
    renderTable({ items: TAGS, visibleItems: [TAGS[0]] });
    expect(screen.getByText('Альфа')).toBeInTheDocument();
    expect(screen.queryByText('Бета')).not.toBeInTheDocument();
  });
});

// ─── Sorting ─────────────────────────────────────────────────────────────

describe('DataTable sorting', () => {
  it('inactive sortable header renders ↕ and clicking calls setSort(key, "asc")', () => {
    const setSort = vi.fn();
    renderTable({ setSort });

    const button = screen.getByRole('button', { name: /Тег/ });
    const header = button.closest('th')!;
    expect(header.textContent).toContain('↕');
    expect(header).not.toHaveAttribute('aria-sort');

    fireEvent.click(button);
    expect(setSort).toHaveBeenCalledWith('tag', 'asc');
  });

  it('active asc header shows ↑ with aria-sort, clicking flips to desc', () => {
    const setSort = vi.fn();
    renderTable({ sortBy: 'tag', sortOrder: 'asc', setSort });

    const button = screen.getByRole('button', { name: /Тег/ });
    const header = button.closest('th')!;
    expect(header.textContent).toContain('↑');
    expect(header).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(button);
    expect(setSort).toHaveBeenCalledWith('tag', 'desc');
  });

  it('active desc header shows ↓ with aria-sort, clicking flips back to asc', () => {
    const setSort = vi.fn();
    renderTable({ sortBy: 'tag', sortOrder: 'desc', setSort });

    const button = screen.getByRole('button', { name: /Тег/ });
    const header = button.closest('th')!;
    expect(header.textContent).toContain('↓');
    expect(header).toHaveAttribute('aria-sort', 'descending');

    fireEvent.click(button);
    expect(setSort).toHaveBeenCalledWith('tag', 'asc');
  });

  it('uses sortField over key when the server field differs', () => {
    const setSort = vi.fn();
    const cols: ColumnDef<Tag>[] = [
      { key: 'age', label: 'Возраст', defaultVisible: true, sortField: 'min_age', accessor: (t) => t.id },
    ];
    render(
      <DataTable<Tag>
        storageKey="sf-columns"
        columns={cols}
        tableState={makeTableState<Tag>({ items: TAGS, setSort })}
        actions={EMPTY_ACTIONS}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Возраст/ }));
    expect(setSort).toHaveBeenCalledWith('min_age', 'asc');
  });

  it('active header is keyed by sortField (glyph follows server field identity)', () => {
    const cols: ColumnDef<Tag>[] = [
      { key: 'age', label: 'Возраст', defaultVisible: true, sortField: 'min_age', accessor: (t) => t.id },
    ];
    render(
      <DataTable<Tag>
        storageKey="sf2-columns"
        columns={cols}
        tableState={makeTableState<Tag>({ items: TAGS, sortBy: 'min_age', sortOrder: 'desc' })}
        actions={EMPTY_ACTIONS}
      />,
    );

    const header = screen.getAllByRole('columnheader')[0];
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(header.textContent).toContain('↓');
  });

  it('sortable: false renders a plain header — no button, no glyph', () => {
    const cols: ColumnDef<Tag>[] = [
      { key: 'tags', label: 'Теги', defaultVisible: true, sortable: false, accessor: (t) => t.tag },
    ];
    render(
      <DataTable<Tag>
        storageKey="ns-columns"
        columns={cols}
        tableState={makeTableState<Tag>({ items: TAGS })}
        actions={EMPTY_ACTIONS}
      />,
    );

    const header = screen.getByText('Теги').closest('th')!;
    expect(within(header).queryByRole('button')).toBeNull();
    expect(header.textContent ?? '').not.toMatch(/[↕↑↓]/);
  });
});

// ─── Column visibility (LS persistence) ──────────────────────────────────

describe('DataTable column visibility', () => {
  it('renders the column picker and toggling hides the column + persists', () => {
    renderTable();
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();

    // Open picker and uncheck "Число"
    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    fireEvent.click(screen.getByText('Число'));

    // The "Число" HEADER is gone from the table (the picker popover keeps the label)
    expect(within(document.querySelector('thead')!).queryByText('Число')).toBeNull();
    expect(screen.queryByTestId('count-cell-t-1')).toBeNull(); // cells filtered too
    expect(JSON.parse(localStorage.getItem('test-columns')!)).toEqual(['tag']);
  });

  it('reads persisted visible keys on mount', () => {
    localStorage.setItem('test-columns', JSON.stringify(['tag']));
    renderTable();

    expect(screen.getByRole('button', { name: /Тег/ })).toBeInTheDocument();
    // Hidden column gone from headers; its cells too
    expect(within(document.querySelector('thead')!).queryByText('Число')).toBeNull();
    expect(screen.queryByTestId('count-cell-t-1')).toBeNull();
  });

  it('last visible column is guarded in the picker (click is a no-op)', () => {
    localStorage.setItem('test-columns', JSON.stringify(['tag']));
    renderTable();

    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    const checkbox = screen.getByLabelText('Тег') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    // The only visible column can't be unchecked — guard no-ops the toggle
    fireEvent.click(checkbox);
    expect(JSON.parse(localStorage.getItem('test-columns')!)).toEqual(['tag']);
  });

  it('corrupted LS value falls back to defaultVisible columns', () => {
    localStorage.setItem('test-columns', '{not-json');
    renderTable();

    // Defaults: tag + count visible; secret stays hidden
    expect(screen.getByRole('button', { name: /Тег/ })).toBeInTheDocument();
    expect(within(document.querySelector('thead')!).queryByText('Секрет')).toBeNull();
  });

  it('empty array in LS falls back to defaultVisible columns', () => {
    localStorage.setItem('test-columns', '[]');
    renderTable();
    expect(within(document.querySelector('thead')!).queryByText('Секрет')).toBeNull();
    expect(screen.getByRole('button', { name: /Число/ })).toBeInTheDocument();
  });

  it('LS array with unknown keys falls back to defaultVisible columns', () => {
    localStorage.setItem('test-columns', JSON.stringify(['nope']));
    renderTable();
    expect(within(document.querySelector('thead')!).queryByText('Секрет')).toBeNull();
    expect(screen.getByRole('button', { name: /Число/ })).toBeInTheDocument();
  });
});

// ─── Search (debounce / Enter / clear) ───────────────────────────────────

describe('DataTable search', () => {
  it('debounces 300ms before calling setSearch', () => {
    vi.useFakeTimers();
    const setSearch = vi.fn();
    renderTable({ setSearch, search: '' }, { withSearch: true, searchPlaceholder: 'Поиск...' });

    const input = screen.getByPlaceholderText('Поиск...');
    fireEvent.change(input, { target: { value: 'жив' } });

    expect(setSearch).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(setSearch).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(setSearch).toHaveBeenCalledTimes(1);
    expect(setSearch).toHaveBeenCalledWith('жив');
  });

  it('Enter submits immediately and cancels the pending debounce', () => {
    vi.useFakeTimers();
    const setSearch = vi.fn();
    renderTable({ setSearch, search: '' }, { withSearch: true, searchPlaceholder: 'Поиск...' });

    const input = screen.getByPlaceholderText('Поиск...');
    fireEvent.change(input, { target: { value: 'абв' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(setSearch).toHaveBeenCalledTimes(1);
    expect(setSearch).toHaveBeenCalledWith('абв');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(setSearch).toHaveBeenCalledTimes(1); // pending debounce cancelled
  });

  it('✕ clear button appears when non-empty and submits empty string', () => {
    const setSearch = vi.fn();
    renderTable({ setSearch, search: '' }, { withSearch: true, searchPlaceholder: 'Поиск...' });

    const input = screen.getByPlaceholderText('Поиск...') as HTMLInputElement;
    expect(screen.queryByText('✕')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByText('✕'));

    expect(setSearch).toHaveBeenCalledWith('');
    expect(input.value).toBe('');
  });

  it('clears the pending debounce timer on unmount', () => {
    vi.useFakeTimers();
    const setSearch = vi.fn();
    const { view } = renderTable({ setSearch, search: '' }, { withSearch: true, searchPlaceholder: 'Поиск...' });

    fireEvent.change(screen.getByPlaceholderText('Поиск...'), { target: { value: 'x' } });
    view.unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(setSearch).not.toHaveBeenCalled();
  });
});

// ─── Action dropdown (APG menu button) ───────────────────────────────────

describe('DataTable action dropdown', () => {
  function openFirstMenu() {
    const trigger = screen.getAllByLabelText('Действия')[0];
    fireEvent.click(trigger);
    return trigger;
  }

  it('trigger has menu-button a11y attributes', () => {
    renderTable();
    const trigger = screen.getAllByLabelText('Действия')[0];
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-controls', 'dropdown-t-1');
  });

  it('clicking the trigger opens the menu with menuitems and dropdown-<key> testid', () => {
    renderTable();
    openFirstMenu();

    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-testid', 'dropdown-t-1');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Редактировать', 'Удалить']);
  });

  it('hidden actions are filtered out', () => {
    renderTable();
    openFirstMenu();
    expect(screen.queryByText('Скрытое действие')).not.toBeInTheDocument();
  });

  it('danger action gets red styling', () => {
    renderTable();
    openFirstMenu();
    const danger = screen.getByRole('menuitem', { name: 'Удалить' });
    expect(danger.getAttribute('style')).toContain('--danger');
  });

  it('menu item click calls the action with the row and closes the menu', () => {
    const onEdit = vi.fn();
    renderTable({}, { actions: makeActions({ onEdit }) });
    openFirstMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('second trigger click closes the menu (toggle)', () => {
    renderTable();
    const trigger = openFirstMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('outside mousedown closes the menu', () => {
    renderTable();
    openFirstMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Esc closes the menu and returns focus to the trigger', () => {
    renderTable();
    const trigger = openFirstMenu();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opening the menu focuses its first menuitem (roving tabindex)', () => {
    renderTable();
    openFirstMenu();

    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    expect(items[0].tabIndex).toBe(0);
    expect(items[1].tabIndex).toBe(-1);
  });

  it('ArrowDown/ArrowUp/Home/End move focus across items', () => {
    renderTable();
    openFirstMenu();

    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');

    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].tabIndex).toBe(0);
    expect(items[0].tabIndex).toBe(-1);

    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0], { key: 'End' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1], { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('actionCellExtra renders per-row extra BEFORE the trigger (Addendum #10)', () => {
    renderTable(
      {},
      {
        actionCellExtra: (row) =>
          <a href={`/map/${row.id}`} data-testid={`map-link-${row.id}`}>🗺</a>,
      },
    );

    const extra1 = screen.getByTestId('map-link-t-1');
    const extra2 = screen.getByTestId('map-link-t-2');
    expect(extra1).toHaveAttribute('href', '/map/t-1');
    expect(extra2).toHaveAttribute('href', '/map/t-2');
    // Per-row: the extra sits in the same cell as its own row's trigger.
    const triggers = screen.getAllByLabelText('Действия');
    expect(extra1.closest('td')).toContainElement(triggers[0]);
    expect(extra2.closest('td')).toContainElement(triggers[1]);
    // Order: extra precedes the ⋯ trigger in document order.
    const pos = extra1.compareDocumentPosition(triggers[0]);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('actionCellExtra absent renders only the trigger', () => {
    renderTable();
    const cells = screen.getAllByLabelText('Действия');
    expect(cells.length).toBe(2);
    cells.forEach((trigger) => {
      const cell = trigger.closest('td')!;
      // Nothing besides the dropdown wrapper inside the actions cell.
      expect(cell.querySelectorAll('a')).toHaveLength(0);
    });
  });
});

// ─── Row interactions ────────────────────────────────────────────────────

describe('DataTable row interactions', () => {
  it('row click calls onRowClick with the row', () => {
    const onRowClick = vi.fn();
    renderTable({}, { onRowClick });

    fireEvent.click(screen.getByText('Альфа').closest('tr')!);
    expect(onRowClick).toHaveBeenCalledWith(TAGS[0]);
  });

  it('clicks inside interactive cell elements do NOT call onRowClick', () => {
    const onRowClick = vi.fn();
    const cols: ColumnDef<Tag>[] = [
      { key: 'tag', label: 'Тег', defaultVisible: true, accessor: (t) => t.tag },
      {
        key: 'act',
        label: 'Действия',
        defaultVisible: true,
        sortable: false,
        render: (r) => (
          <div>
            <button data-testid={`guard-btn-${r.id}`}>B</button>
            <a data-testid={`guard-a-${r.id}`} href="#">
              A
            </a>
            <div role="button" data-testid={`guard-rb-${r.id}`}>
              R
            </div>
            <input data-testid={`guard-input-${r.id}`} />
          </div>
        ),
      },
    ];
    render(
      <DataTable<Tag>
        storageKey="guard-columns"
        columns={cols}
        tableState={makeTableState<Tag>({ items: TAGS })}
        actions={EMPTY_ACTIONS}
        onRowClick={onRowClick}
        rowKey={(t) => t.id}
      />,
    );

    fireEvent.click(screen.getByTestId('guard-btn-t-1'));
    fireEvent.click(screen.getByTestId('guard-a-t-1'));
    fireEvent.click(screen.getByTestId('guard-rb-t-1'));
    fireEvent.click(screen.getByTestId('guard-input-t-1'));
    expect(onRowClick).not.toHaveBeenCalled();

    // A plain row click still works
    fireEvent.click(screen.getByText('Альфа'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('rowClassName is applied to the matching row', () => {
    renderTable({}, { rowClassName: (r) => (r.id === 't-1' ? 'is-selected' : undefined) });

    expect(screen.getByText('Альфа').closest('tr')).toHaveClass('is-selected');
    expect(screen.getByText('Бета').closest('tr')).not.toHaveClass('is-selected');
  });

  it('rowTestId emits data-testid on rows and is omitted when absent', () => {
    renderTable({}, { rowTestId: (r) => `tag-row-${r.id}` });
    expect(document.querySelector('[data-testid="tag-row-t-1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="tag-row-t-2"]')).toBeInTheDocument();
  });

  it('rows carry no data-testid when rowTestId is not provided', () => {
    renderTable();
    const rows = document.querySelectorAll('tbody tr');
    rows.forEach((row) => expect(row).not.toHaveAttribute('data-testid'));
  });
});

// ─── Pager ───────────────────────────────────────────────────────────────

describe('DataTable pager', () => {
  it('renders page-size-select and page buttons; clicks call setPerPage/setPage', () => {
    const setPage = vi.fn();
    const setPerPage = vi.fn();
    renderTable({ items: TAGS, total: 42, perPage: 10, setPage, setPerPage });

    expect(screen.getByText('42 всего')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '20' } });
    expect(setPerPage).toHaveBeenCalledWith(20);

    // 42/10 → 5 numbered buttons
    for (let i = 1; i <= 5; i += 1) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(setPage).toHaveBeenCalledWith(2);
  });

  it('prev/next buttons call setPage and prev is disabled on page 1', () => {
    const setPage = vi.fn();
    renderTable({ items: TAGS, total: 42, perPage: 10, setPage });

    const prev = screen.getByLabelText('Предыдущая страница');
    const next = screen.getByLabelText('Следующая страница');
    expect(prev).toBeDisabled();

    fireEvent.click(next);
    expect(setPage).toHaveBeenCalledWith(2);
  });
});

// ─── Toolbar controls matrix ─────────────────────────────────────────────

describe('DataTable toolbar', () => {
  it('withSearch/withStatus false render neither control (picker still present)', () => {
    renderTable();

    expect(screen.queryByPlaceholderText('Поиск...')).toBeNull();
    // page-size-select exists in the pager — the status filter must not:
    expect(screen.queryByText('Активные')).toBeNull();
    expect(screen.queryByText('Все')).toBeNull();
    expect(screen.queryByText('Архив')).toBeNull();
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('withStatus renders the status select wired to status/setStatus', () => {
    const setStatus = vi.fn();
    renderTable(
      { status: 'active', setStatus },
      { withStatus: true },
    );

    const select = screen.getByLabelText('Статус') as HTMLSelectElement;
    expect(select.value).toBe('active');
    expect(select).toHaveDisplayValue('Активные');

    fireEvent.change(select, { target: { value: 'archived' } });
    expect(setStatus).toHaveBeenCalledWith('archived');

    // All three options exist (Активные/Все/Архив)
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['Активные', 'Все', 'Архив']);
  });

  it('toolbarExtras renders the escape-hatch node', () => {
    renderTable({}, { toolbarExtras: <button type="button">+ Добавить тег</button> });
    expect(screen.getByText('+ Добавить тег')).toBeInTheDocument();
  });

  it('toolbarLead renders in the left toolbar group, before search/status (Addendum #9)', () => {
    renderTable(
      { status: 'active', setStatus: vi.fn() },
      {
        withSearch: true,
        withStatus: true,
        toolbarLead: <input data-testid="lead-bar" placeholder="Название или адрес..." />,
      },
    );

    const lead = screen.getByTestId('lead-bar');
    // The lead node comes BEFORE the search input in document order (left group,
    // in front of the withSearch/withStatus controls).
    const pos = lead.compareDocumentPosition(screen.getByPlaceholderText('Поиск...'));
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Same toolbar row as the picker (not a separate stacked bar)
    const toolbar = lead.closest('div')!.parentElement;
    expect(toolbar).toContainElement(screen.getByLabelText('Настроить колонки'));
  });

  it('toolbarLead absent renders no lead node (zero impact when unused)', () => {
    renderTable();
    expect(screen.queryByTestId('lead-bar')).toBeNull();
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });
});
