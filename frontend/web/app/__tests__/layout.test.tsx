import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RootLayout from "../layout";

describe("RootLayout", () => {
  it("renders children content", () => {
    render(
      <RootLayout>
        <div data-testid="child">Test Content</div>
      </RootLayout>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });

  it("applies Inter and Playfair Display font variables to body", () => {
    const { container } = render(
      <RootLayout>
        <div>Content</div>
      </RootLayout>
    );

    const body = container.querySelector("body");
    expect(body).toHaveClass("antialiased");
    // Font variable classes should be present
    expect(body?.className).toContain("font-");
  });

  it("sets html lang to ru", () => {
    const { container } = render(
      <RootLayout>
        <div>Content</div>
      </RootLayout>
    );

    const html = container.querySelector("html");
    expect(html).toHaveAttribute("lang", "ru");
  });
});
