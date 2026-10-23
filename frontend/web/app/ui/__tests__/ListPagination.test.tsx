import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListPagination } from "../ListPagination";

describe("ListPagination", () => {
  it("renders nothing when everything fits on one page", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ListPagination page={1} pageCount={1} onChange={onChange} />,
    );
    expect(screen.queryByTestId("list-pagination")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the current page of the total («Страница 1 из 3»)", () => {
    render(<ListPagination page={1} pageCount={3} onChange={vi.fn()} />);
    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
    expect(screen.getByTestId("list-pagination-info")).toHaveTextContent(
      "Страница 1 из 3",
    );
  });

  it("disables «Назад» on the first page and enables «Вперёд»", () => {
    render(<ListPagination page={1} pageCount={3} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Вперёд" })).toBeEnabled();
  });

  it("disables «Вперёд» on the last page", () => {
    render(<ListPagination page={3} pageCount={3} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Назад" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Вперёд" })).toBeDisabled();
  });

  it("calls onChange with page+1 on «Вперёд» and page-1 on «Назад»", () => {
    const onChange = vi.fn();
    render(<ListPagination page={2} pageCount={3} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(onChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
