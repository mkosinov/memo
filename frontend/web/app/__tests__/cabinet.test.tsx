import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

// ── Mock the client-branch API (#499/#593): the cabinet detects the session
// on open and logs out via /auth/logout — keep these tests hermetic
// (anonymous by default). The auth method registry + callcheck feed the
// shared auth screen (#593).
vi.mock("@memo/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    getMyClient: vi.fn(),
    requestOtpCode: vi.fn(),
    verifyOtpCode: vi.fn(),
    createMyRecord: vi.fn(),
    logout: vi.fn(),
    getAuthMethods: vi.fn(),
    initiateCallAuth: vi.fn(),
    callAuthStatus: vi.fn(),
  };
});

// /cabinet redirects an authenticated client to /cabinet/records (#513
// Task 7) — the redirect rides the Next router.
const mocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ ...mocks }),
}));

import CabinetPage from "../cabinet/page";
import {
  getMyClient,
  requestOtpCode,
  verifyOtpCode,
  getAuthMethods,
  initiateCallAuth,
  callAuthStatus,
  ApiError,
} from "@memo/api-client";
import { createQueryWrapper } from "./fixtures/cabinet";

const mockedGetMyClient = getMyClient as unknown as Mock;
const mockedRequestOtpCode = requestOtpCode as unknown as Mock;
const mockedVerifyOtpCode = verifyOtpCode as unknown as Mock;
const mockedGetAuthMethods = getAuthMethods as unknown as Mock;
const mockedInitiateCallAuth = initiateCallAuth as unknown as Mock;
const mockedCallAuthStatus = callAuthStatus as unknown as Mock;

const PHONE = "+79991234567";

const QueryWrapper = createQueryWrapper();

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMyClient.mockRejectedValue(new ApiError(401, "unauthorized"));
  // Dev-like registry (#593): both methods available.
  mockedGetAuthMethods.mockResolvedValue([
    { id: "sms_otp", available: true },
    { id: "call", available: true },
  ]);
  mockedInitiateCallAuth.mockResolvedValue({
    handle: "handle-1",
    call: {
      phone: "+79995552255",
      pretty: "+7 999 555-22-55",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    },
  });
  mockedCallAuthStatus.mockResolvedValue({ status: "waiting" });
});

function renderCabinet() {
  return render(
    <QueryWrapper>
      <CabinetPage />
    </QueryWrapper>,
  );
}

/// Drives the anonymous cabinet through the full SMS login: phone → «Войти»
/// → method picker → «Код по SMS» → «Отправить код» → code → «Подтвердить».
/// Assumes the OTP request mock is already configured by the caller.
async function loginThroughOtp(code = "123456") {
  fireEvent.change(await screen.findByLabelText("Номер телефона"), {
    target: { value: PHONE },
  });
  fireEvent.click(screen.getByRole("button", { name: /войти/i }));

  // The SAME auth screen as the booking form (#593) — picker first.
  expect(await screen.findByText("Подтвердите телефон")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Код по SMS/i }));

  fireEvent.click(screen.getByRole("button", { name: /отправить код/i }));
  fireEvent.change(await screen.findByTestId("otp-code-input"), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: /подтвердить/i }));
}

// ── Anonymous: login form ───────────────────────────────────────

describe("Cabinet page — anonymous", () => {
  it("renders the phone login form", async () => {
    renderCabinet();
    expect(
      await screen.findByLabelText("Номер телефона"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /войти/i }),
    ).toBeInTheDocument();
  });

  it("does not render the logged-in phone block", async () => {
    renderCabinet();
    await screen.findByLabelText("Номер телефона");
    expect(screen.queryByTestId("cabinet-phone")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /выйти/i })).not.toBeInTheDocument();
  });

  it("does not redirect an anonymous visitor", async () => {
    renderCabinet();
    await screen.findByLabelText("Номер телефона");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

// ── Login flow: phone → the same OTP step as the booking form ──

describe("Cabinet page — login flow (US-5)", () => {
  it("moves from the phone form into the «Подтвердите телефон» step with the entered phone", async () => {
    renderCabinet();
    fireEvent.change(await screen.findByLabelText("Номер телефона"), {
      target: { value: PHONE },
    });
    fireEvent.click(screen.getByRole("button", { name: /войти/i }));

    expect(await screen.findByText("Подтвердите телефон")).toBeInTheDocument();
    expect(screen.getByText(PHONE)).toBeInTheDocument();
  });

  it("verifies the code and redirects the now-authenticated client to /cabinet/records", async () => {
    mockedRequestOtpCode.mockResolvedValue({ dev_code: null });
    mockedVerifyOtpCode.mockResolvedValue({ phone: PHONE, name: "Мария" });
    mockedGetMyClient.mockRejectedValueOnce(
      new ApiError(401, "unauthorized"),
    );
    mockedGetMyClient.mockResolvedValue({ phone: PHONE, name: "Мария" });

    renderCabinet();
    await loginThroughOtp();

    expect(mockedVerifyOtpCode).toHaveBeenCalledWith(PHONE, "123456");
    await screen.findByTestId("cabinet-checking");
    expect(mocks.replace).toHaveBeenCalledWith("/cabinet/records");
  });
});

// ── Logged in: /cabinet is a redirect to the records section ────

describe("Cabinet page — logged in (redirect)", () => {
  it("redirects an authenticated client to /cabinet/records without rendering the section shell", async () => {
    mockedGetMyClient.mockResolvedValue({ phone: PHONE, name: "Мария" });
    renderCabinet();

    await screen.findByTestId("cabinet-checking");
    expect(mocks.replace).toHaveBeenCalledWith("/cabinet/records");
    // The section shell (phone block, nav) lives on /cabinet/records —
    // /cabinet itself stays a pure redirect frame.
    expect(screen.queryByTestId("cabinet-phone")).not.toBeInTheDocument();
  });
});

// ── Login by call (#593): the same auth screen, the call branch ──

describe("Cabinet page — вход звонком (US-2)", () => {
  it("«Подтвердить звонком» → экран звонка → poll confirmed → redirect", async () => {
    mockedCallAuthStatus.mockResolvedValue({ status: "confirmed" });
    mockedGetMyClient
      .mockRejectedValueOnce(new ApiError(401, "unauthorized")) // initial check
      .mockResolvedValue({ phone: PHONE, name: "Мария" }); // post-confirm refresh

    renderCabinet();
    fireEvent.change(await screen.findByLabelText("Номер телефона"), {
      target: { value: PHONE },
    });
    fireEvent.click(screen.getByRole("button", { name: /войти/i }));

    fireEvent.click(
      await screen.findByRole("button", { name: /Подтвердить звонком/i }),
    );
    const callScreen = await screen.findByTestId("auth-call-screen");
    expect(mockedInitiateCallAuth).toHaveBeenCalledWith(PHONE);
    expect(
      within(callScreen).getByTestId("auth-call-number"),
    ).toHaveAttribute("href", "tel:+79995552255");

    // confirmed sets the session cookie → refresh → the cabinet redirect.
    await screen.findByTestId("cabinet-checking");
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/cabinet/records"),
    );
    expect(mockedVerifyOtpCode).not.toHaveBeenCalled();
  });

  it("«Связаться» opens with the cabinet greeting", async () => {
    renderCabinet();
    fireEvent.change(await screen.findByLabelText("Номер телефона"), {
      target: { value: PHONE },
    });
    fireEvent.click(screen.getByRole("button", { name: /войти/i }));

    fireEvent.click(await screen.findByRole("button", { name: /Связаться/i }));
    const panel = await screen.findByTestId("auth-contact-channels");
    expect(panel).toHaveTextContent("Здравствуйте");
  });
});
