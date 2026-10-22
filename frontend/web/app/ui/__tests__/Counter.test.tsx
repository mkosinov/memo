import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Counter } from "../Counter";

describe("Counter", () => {
  it("renders label and value", () => {
    render(
      <Counter label="Adults" value={2} onChange={vi.fn()} />
    );
    expect(screen.getByText("Adults")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders optional subLabel", () => {
    render(
      <Counter label="Adults" subLabel="1500 ₽" value={1} onChange={vi.fn()} />
    );
    expect(screen.getByText("1500 ₽")).toBeInTheDocument();
  });

  it("renders data-testid on the counter row when testId is provided", () => {
    render(
      <Counter label="Adults" testId="tariff-counter-42" value={1} onChange={vi.fn()} />
    );
    const row = screen.getByTestId("tariff-counter-42");
    expect(row).toBeInTheDocument();
    // Label and price live inside the same row ("price next to the counter")
    expect(row).toHaveTextContent("Adults");
  });

  it("increments value when plus is clicked", () => {
    const handleChange = vi.fn();
    render(
      <Counter label="Count" value={2} onChange={handleChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: /increase/i }));
    expect(handleChange).toHaveBeenCalledWith(3);
  });

  it("decrements value when minus is clicked", () => {
    const handleChange = vi.fn();
    render(
      <Counter label="Count" value={3} onChange={handleChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: /decrease/i }));
    expect(handleChange).toHaveBeenCalledWith(2);
  });

  it("disables minus button at min value", () => {
    const handleChange = vi.fn();
    render(
      <Counter label="Count" value={0} onChange={handleChange} min={0} />
    );
    const minusBtn = screen.getByRole("button", { name: /decrease/i });
    expect(minusBtn).toBeDisabled();
  });

  it("disables plus button at max value", () => {
    const handleChange = vi.fn();
    render(
      <Counter label="Count" value={10} onChange={handleChange} max={10} />
    );
    const plusBtn = screen.getByRole("button", { name: /increase/i });
    expect(plusBtn).toBeDisabled();
  });

  it("does not call onChange when minus is disabled at min", () => {
    const handleChange = vi.fn();
    render(
      <Counter label="Count" value={0} onChange={handleChange} min={0} />
    );
    fireEvent.click(screen.getByRole("button", { name: /decrease/i }));
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when plus is disabled at max", () => {
    const handleChange = vi.fn();
    render(
      <Counter label="Count" value={10} onChange={handleChange} max={10} />
    );
    fireEvent.click(screen.getByRole("button", { name: /increase/i }));
    expect(handleChange).not.toHaveBeenCalled();
  });
});
