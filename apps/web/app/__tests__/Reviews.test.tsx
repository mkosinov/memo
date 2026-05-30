import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reviews } from "../sections/Reviews";

describe("Reviews", () => {
  it("renders rating text with default values", () => {
    render(<Reviews />);
    // Link text: "4.9★ Отзывы на Яндекс Картах →"
    const link = screen.getByRole("link", { name: /4\.9★/ });
    expect(link).toBeInTheDocument();
  });

  it("renders custom rating and review count", () => {
    render(<Reviews rating={4.8} reviewCount={142} />);
    const link = screen.getByRole("link", { name: /4\.8★/ });
    expect(link).toBeInTheDocument();
  });

  it("renders link to Yandex Maps with target='_blank'", () => {
    render(<Reviews />);
    const link = screen.getByRole("link", { name: /Отзывы на Яндекс/ });
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

  it("renders arrow icon in link text", () => {
    render(<Reviews />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("→");
  });
});
