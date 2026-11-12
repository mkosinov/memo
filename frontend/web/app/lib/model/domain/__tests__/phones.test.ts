import { describe, it, expect } from "vitest";
import { toCanonicalPhone } from "../phones";

describe("toCanonicalPhone (#593: call initiate requires +7XXXXXXXXXX)", () => {
  it("passes through an already-canonical number", () => {
    expect(toCanonicalPhone("+79991234567")).toBe("+79991234567");
  });

  it("canonicalizes a formatted RU number to E.164", () => {
    expect(toCanonicalPhone("+7 (999) 123-45-67")).toBe("+79991234567");
  });

  it("canonicalizes a national 8-prefixed number", () => {
    expect(toCanonicalPhone("8 (999) 123-45-67")).toBe("+79991234567");
  });

  it("returns null for garbage (no network call — server 422 is the backstop)", () => {
    expect(toCanonicalPhone("12345")).toBeNull();
    expect(toCanonicalPhone("")).toBeNull();
  });

  it("returns null for a non-RU number", () => {
    expect(toCanonicalPhone("+14155552671")).toBeNull();
  });
});
