import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock window.matchMedia for Embla Carousel
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver for Embla Carousel
class MockIntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
}

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

Object.defineProperty(global, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

// Mock ResizeObserver for Embla Carousel
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: MockResizeObserver,
});

Object.defineProperty(global, "ResizeObserver", {
  writable: true,
  value: MockResizeObserver,
});

// Mock next/font/google — returns a dummy object with className and variable
vi.mock("next/font/google", () => ({
  Inter: vi.fn(() => ({
    className: "font-inter",
    variable: "--font-inter",
  })),
  Playfair_Display: vi.fn(() => ({
    className: "font-playfair",
    variable: "--font-playfair",
  })),
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    const { fill, ...rest } = props;
    return React.createElement("img", { ...rest, alt: (rest.alt as string) || "" });
  },
}));

import React from "react";
import type { ReactNode } from "react";

// Mock next/link — renders as a real <a> element
vi.mock("next/link", () => ({
  default: React.forwardRef<HTMLAnchorElement, { children?: ReactNode; href?: string }>(
    ({ children, ...props }, ref) =>
      React.createElement(
        "a",
        { ...props, ref },
        children
      )
  ),
}));
