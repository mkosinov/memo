import { describe, it, expect, vi, afterEach } from "vitest";
import {
  telegramContact,
  whatsappContact,
  telegramLink,
  whatsappLink,
} from "../contacts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("telegramContact / whatsappContact (#593 «Связаться»)", () => {
  it("returns the env value when set", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_TELEGRAM", "memo_admin");
    vi.stubEnv("NEXT_PUBLIC_CONTACT_WHATSAPP", "79990001122");
    expect(telegramContact()).toBe("memo_admin");
    expect(whatsappContact()).toBe("79990001122");
  });

  it("returns empty strings when the env vars are unset", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_TELEGRAM", "");
    vi.stubEnv("NEXT_PUBLIC_CONTACT_WHATSAPP", "");
    expect(telegramContact()).toBe("");
    expect(whatsappContact()).toBe("");
  });
});

describe("telegramLink (#593: https://t.me/<user>?text=…)", () => {
  it("builds the link with the URL-encoded text", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_TELEGRAM", "@memo_admin");
    expect(telegramLink("Здравствуйте! Запись: МК, 2 гостя")).toBe(
      "https://t.me/memo_admin?text=" +
        encodeURIComponent("Здравствуйте! Запись: МК, 2 гостя"),
    );
  });

  it("returns null for an empty contact (button hidden)", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_TELEGRAM", "");
    expect(telegramLink("текст")).toBeNull();
  });
});

describe("whatsappLink (#593: https://wa.me/<7XXXXXXXXXX>?text=…)", () => {
  it("builds the link from digits only with the encoded text", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_WHATSAPP", "+7 999 000-11-22");
    expect(whatsappLink("Здравствуйте!")).toBe(
      "https://wa.me/79990001122?text=" + encodeURIComponent("Здравствуйте!"),
    );
  });

  it("returns null for an empty contact (button hidden)", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_WHATSAPP", "");
    expect(whatsappLink("текст")).toBeNull();
  });
});
