import { Button } from "./Button";

export interface ListPaginationProps {
  /** Current page (1-based). */
  page: number;
  /** Total page count; ≤1 → the controls are not rendered at all. */
  pageCount: number;
  onChange: (page: number) => void;
}

/** Light prev/next pagination for the cabinet lists (#513): rendered only
 * when the list spills past one page (the spec's conditional element). */
export function ListPagination({ page, pageCount, onChange }: ListPaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <div
      data-testid="list-pagination"
      className="mt-6 flex items-center justify-center gap-4"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Назад
      </Button>
      <span data-testid="list-pagination-info" className="text-sm text-ink-mid">
        Страница {page} из {pageCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        Вперёд
      </Button>
    </div>
  );
}

export default ListPagination;
