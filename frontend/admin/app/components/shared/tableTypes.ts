import type { ReactNode } from 'react';
import type {
  ArchiveFilter,
  SortOrder,
} from '../../../contexts/createPagedListContext';

export interface ColumnDef<T> {
  key: string;
  label: string;
  defaultVisible: boolean;
  sortable?: boolean; // default true
  width?: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => ReactNode; // custom cell; takes precedence over accessor
  accessor?: (row: T) => string | number; // default cell renderer only (NOT sort)
  sortField?: string; // server sort field if ≠ key
}

export type RowAction<T> = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  hidden?: (row: T) => boolean;
  onClick: (row: T) => void;
};

export interface PagedListState<T> {
  items: T[];
  visibleItems?: T[]; // filtered view (dict client-search); render this ?? items
  total: number;
  page: number;
  perPage: number;
  sortBy: string | null;
  sortOrder: SortOrder;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  status?: ArchiveFilter; // required iff withStatus
  search?: string; // required iff withSearch
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setSort: (field: string, order: SortOrder) => void;
  setStatus?: (status: ArchiveFilter) => void;
  setSearch?: (s: string) => void;
  refetch: () => void;
}

export interface DataTableProps<T> {
  storageKey: string; // '<entity>-columns'
  columns: ColumnDef<T>[];
  tableState: PagedListState<T>;
  actions: (row: T) => RowAction<T>[];
  onRowClick?: (row: T) => void;
  emptyLabel?: string; // default "Нет записей"
  toolbarExtras?: ReactNode;
  withStatus?: boolean; // default false
  withSearch?: boolean; // default false
  searchPlaceholder?: string; // default "Поиск..."
  /** Left-group lead node rendered BEFORE search/status controls (Addendum #9: dict *Filters bars). */
  toolbarLead?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  rowKey?: (row: T) => string; // default: row index
  rowTestId?: (row: T) => string; // per-row data-testid on <tr>; attribute omitted when prop absent (Contract Addendum #6)
  /** Per-row node rendered in the actions cell BEFORE the ⋯ trigger (Addendum #10: Locations 🗺 Карта link). */
  actionCellExtra?: (row: T) => ReactNode;
}
