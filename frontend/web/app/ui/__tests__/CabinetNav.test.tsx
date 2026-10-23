import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CabinetNav } from "../CabinetNav";

describe("CabinetNav", () => {
  it("renders the nav with data-testid=cabinet-nav", () => {
    render(<CabinetNav active="records" />);
    expect(screen.getByTestId("cabinet-nav")).toBeInTheDocument();
  });

  it("renders the three section links with their hrefs", () => {
    render(<CabinetNav active="records" />);
    const records = screen.getByRole("link", { name: "Мои записи" });
    const photos = screen.getByRole("link", { name: "Мои фото" });
    const payments = screen.getByRole("link", { name: "Мои платежи" });
    expect(records).toHaveAttribute("href", "/cabinet/records");
    expect(photos).toHaveAttribute("href", "/cabinet/photos");
    expect(payments).toHaveAttribute("href", "/cabinet/payments");
  });

  it("highlights the active section (aria-current=page) and not the others", () => {
    render(<CabinetNav active="records" />);
    expect(screen.getByRole("link", { name: "Мои записи" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Мои фото" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(
      screen.getByRole("link", { name: "Мои платежи" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks the photos section active when active=photos", () => {
    render(<CabinetNav active="photos" />);
    expect(screen.getByRole("link", { name: "Мои фото" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
