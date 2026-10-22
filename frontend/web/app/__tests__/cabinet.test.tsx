import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Mock } from "vitest";

// ── Mock the client-branch API (#499): the cabinet detects the session on
// open and logs out via /auth/logout — keep these tests hermetic
// (anonymous by default).
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
  };
});

import CabinetPage from "../cabinet/page";
import {
  getMyClient,
  requestOtpCode,
  verifyOtpCode,
  logout,
  ApiError,
} from "@memo/api-client";

const mockedGetMyClient = getMyClient as unknown as Mock;
const mockedRequestOtpCode = requestOtpCode as unknown as Mock;
const mockedVerifyOtpCode = verifyOtpCode as unknown as Mock;
const mockedLogout = logout as unknown as Mock;

const PHONE = "+79991234567";

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMyClient.mockRejectedValue(new ApiError(401, "unauthorized"));
  mockedLogout.mockResolvedValue(undefined);
});

/// Drives the anonymous cabinet through the full OTP login: phone → «Войти»
/// → «Отправить код» → code → «Подтвердить». Assumes the OTP request mock
/// is already configured by the caller.
async function loginThroughOtp(code = "123456") {
  fireEvent.change(await screen.findByLabelText("Номер телефона"), {
    target: { value: PHONE },
  });
  fireEvent.click(screen.getByRole("button", { name: /войти/i }));

  // The SAME «Подтвердите телефон» step as the booking form (#499 §7)
  expect(await screen.findByText("Подтвердите телефон")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /отправить код/i }));
  fireEvent.change(await screen.findByTestId("otp-code-input"), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: /подтвердить/i }));
}

// ── Anonymous: login form ───────────────────────────────────

describe("Cabinet page — anonymous", () => {
  it("renders the phone login form", async () => {
    render(<CabinetPage />);
    expect(
      await screen.findByLabelText("Номер телефона"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /войти/i }),
    ).toBeInTheDocument();
  });

  it("does not render the logged-in phone block", async () => {
    render(<CabinetPage />);
    await screen.findByLabelText("Номер телефона");
    expect(screen.queryByTestId("cabinet-phone")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /выйти/i })).not.toBeInTheDocument();
  });
});

// ── Login flow: phone → the same OTP step as the booking form ──

describe("Cabinet page — login flow (US-5)", () => {
  it("moves from the phone form into the «Подтвердите телефон» step with the entered phone", async () => {
    render(<CabinetPage />);
    fireEvent.change(await screen.findByLabelText("Номер телефона"), {
      target: { value: PHONE },
    });
    fireEvent.click(screen.getByRole("button", { name: /войти/i }));

    expect(await screen.findByText("Подтвердите телефон")).toBeInTheDocument();
    expect(screen.getByText(PHONE)).toBeInTheDocument();
  });

  it("verifies the code and shows the logged-in view", async () => {
    mockedRequestOtpCode.mockResolvedValue({ dev_code: null });
    mockedVerifyOtpCode.mockResolvedValue({ phone: PHONE, name: "Мария" });
    mockedGetMyClient.mockRejectedValueOnce(
      new ApiError(401, "unauthorized"),
    );
    mockedGetMyClient.mockResolvedValue({ phone: PHONE, name: "Мария" });

    render(<CabinetPage />);
    await loginThroughOtp();

    expect(mockedVerifyOtpCode).toHaveBeenCalledWith(PHONE, "123456");
    expect(await screen.findByTestId("cabinet-phone")).toHaveTextContent(PHONE);
  });
});

// ── Logged in: phone + «Выйти» ──────────────────────────────

describe("Cabinet page — logged in", () => {
  it("shows the session phone (cabinet-phone) and «Выйти»", async () => {
    mockedGetMyClient.mockResolvedValue({ phone: PHONE, name: "Мария" });
    render(<CabinetPage />);

    expect(await screen.findByTestId("cabinet-phone")).toHaveTextContent(PHONE);
    expect(
      screen.getByRole("button", { name: /выйти/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Номер телефона"),
    ).not.toBeInTheDocument();
  });

  it("logs out and returns to the login form", async () => {
    mockedGetMyClient.mockResolvedValueOnce({ phone: PHONE, name: null });
    mockedGetMyClient.mockRejectedValue(new ApiError(401, "unauthorized"));

    render(<CabinetPage />);
    fireEvent.click(await screen.findByRole("button", { name: /выйти/i }));

    expect(mockedLogout).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByLabelText("Номер телефона"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-phone")).not.toBeInTheDocument();
  });
});
