import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reviews } from "../sections/Reviews";

describe("Reviews", () => {
  it("renders rating text with default values", () => {
    render(<Reviews />);
    expect(screen.getByText(/Хорошее место/)).toBeInTheDocument();
    expect(screen.getByText(/4\.9★/)).toBeInTheDocument();
  });

  it("renders custom rating and review count", () => {
    render(<Reviews rating={4.8} reviewCount={142} />);
    expect(screen.getByText(/4\.8★/)).toBeInTheDocument();
  });

  it("renders link to Yandex Maps with target='_blank'", () => {
    render(<Reviews />);
    const link = screen.getByRole("link", { name: /Посмотреть отзывы/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("has correct default href", () => {
    render(<Reviews />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href");
    expect(link.getAttribute("href")).toContain("yandex.ru/maps");
  });

  it("uses custom yandexMapsUrl when provided", () => {
    const customUrl = "https://yandex.ru/maps/org/custom_place/123";
    render(<Reviews yandexMapsUrl={customUrl} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", customUrl);
  });

  it("renders arrow icon (→)", () => {
    render(<Reviews />);
    expect(screen.getByText("→")).toBeInTheDocument();
  });
});
