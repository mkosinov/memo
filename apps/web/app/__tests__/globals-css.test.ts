import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("globals.css", () => {
  const cssPath = path.resolve(__dirname, "../globals.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  it("defines --bg CSS variable", () => {
    expect(cssContent).toMatch(/--bg:\s*#EDEDEE/);
  });

  it("defines --card-bg CSS variable", () => {
    expect(cssContent).toMatch(/--card-bg:\s*#ffffff/);
  });

  it("defines --brand CSS variable", () => {
    expect(cssContent).toMatch(/--brand:\s*#004D56/);
  });

  it("defines --gold CSS variable", () => {
    expect(cssContent).toMatch(/--gold:\s*#C49A2E/);
  });

  it("defines ink color variables (ink, ink-mid, ink-light, ink-faint)", () => {
    expect(cssContent).toMatch(/--ink:\s*#1a1a1a/);
    expect(cssContent).toMatch(/--ink-mid:\s*#555555/);
    expect(cssContent).toMatch(/--ink-light:\s*#888888/);
    expect(cssContent).toMatch(/--ink-faint:\s*#cccccc/);
  });

  it("defines --line CSS variable", () => {
    expect(cssContent).toMatch(/--line:\s*#E0E0E1/);
  });

  it("defines --surface CSS variable", () => {
    expect(cssContent).toMatch(/--surface:\s*#f4f4f5/);
  });

  it("includes .no-scrollbar utility class", () => {
    expect(cssContent).toContain(".no-scrollbar");
    expect(cssContent).toContain("scrollbar-width: none");
    expect(cssContent).toContain("-ms-overflow-style: none");
  });

  it("includes webkit scrollbar styling", () => {
    expect(cssContent).toContain("::-webkit-scrollbar");
    expect(cssContent).toContain("::-webkit-scrollbar-thumb");
  });

  it("includes @tailwind directives", () => {
    expect(cssContent).toContain("@tailwind base");
    expect(cssContent).toContain("@tailwind components");
    expect(cssContent).toContain("@tailwind utilities");
  });
});
