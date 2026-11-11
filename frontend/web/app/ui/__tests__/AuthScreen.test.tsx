import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

// ── Mock the client-branch API (#593): registry, callcheck, OTP ─────────────
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
    getAuthMethods: vi.fn(),
    initiateCallAuth: vi.fn(),
    callAuthStatus: vi.fn(),
    requestOtpCode: vi.fn(),
    verifyOtpCode: vi.fn(),
  };
});

import {
  getAuthMethods,
  initiateCallAuth,
  callAuthStatus,
  requestOtpCode,
  ApiError,
} from "@memo/api-client";
import { createQueryWrapper } from "../../__tests__/fixtures/cabinet";
import { useOtpLogin } from "../../hooks/useOtpLogin";
import { AuthScreen } from "../AuthScreen";

const mockedGetAuthMethods = getAuthMethods as unknown as Mock;
const mockedInitiate = initiateCallAuth as unknown as Mock;
const mockedStatus = callAuthStatus as unknown as Mock;
const mockedRequestOtpCode = requestOtpCode as unknown as Mock;

const PHONE = "+79991234567";

function initiateResponse(handle = "handle-1") {
  return {
    handle,
    call: {
      phone: "+79995552255",
      pretty: "+7 999 555-22-55",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    },
  };
}

/** Wires the real useOtpLogin into the screen (the parents' pattern). */
function Harness(props: Partial<React.ComponentProps<typeof AuthScreen>>) {
  const otp = useOtpLogin();
  return (
    <AuthScreen
      phone={props.phone ?? PHONE}
      contactMessage={props.contactMessage ?? "Текст заявки: МК, 2 гостя"}
      otp={otp}
      onSmsVerify={props.onSmsVerify ?? vi.fn()}
      onCallConfirmed={props.onCallConfirmed ?? vi.fn()}
      onBack={props.onBack ?? vi.fn()}
    />
  );
}

function renderScreen(props: Partial<React.ComponentProps<typeof AuthScreen>> = {}) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <Harness {...props} />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Dev-like registry: both methods on.
  mockedGetAuthMethods.mockResolvedValue([
    { id: "sms_otp", available: true },
    { id: "call", available: true },
  ]);
  mockedInitiate.mockResolvedValue(initiateResponse());
  mockedStatus.mockResolvedValue({ status: "waiting" });
  mockedRequestOtpCode.mockResolvedValue({});
});

describe("AuthScreen — единый экран авторизации (#593)", () => {
  it("renders the picker from the registry with the «Связаться» entry always visible", async () => {
    renderScreen();

    await screen.findByTestId("auth-method-picker");
    expect(
      screen.getByRole("button", { name: /Подтвердить звонком/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Код по SMS/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Связаться/i })).toBeInTheDocument();
  });

  it("reveals the contact panel with the prefilled message on «Связаться»", async () => {
    renderScreen({ contactMessage: "Заявка: МК «Акрил», 20 мая, 14:00, 2 гостя" });

    fireEvent.click(await screen.findByRole("button", { name: /Связаться/i }));
    const panel = await screen.findByTestId("auth-contact-channels");
    expect(panel).toHaveTextContent("МК «Акрил», 20 мая, 14:00, 2 гостя");
  });

  it("empty registry → «Вход временно недоступен» + «Связаться», no method buttons", async () => {
    mockedGetAuthMethods.mockResolvedValue([
      { id: "sms_otp", available: false },
      { id: "call", available: false },
    ]);
    renderScreen();

    await screen.findByText("Вход временно недоступен");
    expect(
      screen.queryByRole("button", { name: /Подтвердить звонком/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Код по SMS/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Связаться/i })).toBeInTheDocument();
  });

  it("hides the call button when the registry marks it unavailable", async () => {
    mockedGetAuthMethods.mockResolvedValue([
      { id: "sms_otp", available: true },
      { id: "call", available: false },
    ]);
    renderScreen();

    await screen.findByTestId("auth-method-picker");
    expect(
      screen.queryByRole("button", { name: /Подтвердить звонком/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Код по SMS/i })).toBeInTheDocument();
  });
});

describe("AuthScreen — ветка звонка (#593)", () => {
  it("«Подтвердить звонком» initiates with the canonical phone and shows the call screen", async () => {
    renderScreen({ phone: "+7 (999) 123-45-67" });

    fireEvent.click(
      await screen.findByRole("button", { name: /Подтвердить звонком/i }),
    );
    await screen.findByTestId("auth-call-screen");

    expect(mockedInitiate).toHaveBeenCalledWith("+79991234567");
    const number = screen.getByTestId("auth-call-number");
    expect(number).toHaveAttribute("href", "tel:+79995552255");
    expect(number).toHaveTextContent("+7 999 555-22-55");
  });

  it("fires onCallConfirmed exactly once when the poll confirms", async () => {
    const onCallConfirmed = vi.fn();
    mockedStatus.mockResolvedValue({ status: "confirmed" });
    renderScreen({ onCallConfirmed });

    fireEvent.click(
      await screen.findByRole("button", { name: /Подтвердить звонком/i }),
    );
    await waitFor(() => expect(onCallConfirmed).toHaveBeenCalledTimes(1));
  });

  it("«Другой способ» returns to the picker from the call screen", async () => {
    renderScreen();

    fireEvent.click(
      await screen.findByRole("button", { name: /Подтвердить звонком/i }),
    );
    await screen.findByTestId("auth-call-screen");

    fireEvent.click(screen.getByRole("button", { name: /Другой способ/i }));
    await screen.findByTestId("auth-method-picker");
    expect(screen.queryByTestId("auth-call-screen")).not.toBeInTheDocument();
  });

  it("initiate 503 → the existing step-error channel shows «Вход временно недоступен»", async () => {
    mockedInitiate.mockRejectedValue(
      new ApiError(503, "notification transport unavailable", "NOTIFICATION_TRANSPORT_UNAVAILABLE"),
    );
    renderScreen();

    fireEvent.click(
      await screen.findByRole("button", { name: /Подтвердить звонком/i }),
    );

    const errorBlock = await screen.findByTestId("otp-step-error");
    expect(errorBlock).toHaveTextContent("Вход временно недоступен");
    // Still on the picker — the client can pick the other method or contact.
    expect(screen.getByTestId("auth-method-picker")).toBeInTheDocument();
  });

  it("404 poll → «Проверка недействительна» + «Начать заново» back to the picker", async () => {
    mockedStatus.mockRejectedValue(new ApiError(404, "Not Found"));
    renderScreen();

    fireEvent.click(
      await screen.findByRole("button", { name: /Подтвердить звонком/i }),
    );
    await screen.findByText("Проверка недействительна");

    fireEvent.click(screen.getByRole("button", { name: /Начать заново/i }));
    await screen.findByTestId("auth-method-picker");
  });
});

describe("AuthScreen — ветка SMS (#593: остаётся рабочей)", () => {
  it("«Код по SMS» opens the code step; request → input → verify rises to onSmsVerify", async () => {
    const onSmsVerify = vi.fn();
    renderScreen({ onSmsVerify });

    fireEvent.click(await screen.findByRole("button", { name: /Код по SMS/i }));
    expect(
      await screen.findByRole("button", { name: /Отправить код/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Отправить код/i }));
    await waitFor(() => expect(mockedRequestOtpCode).toHaveBeenCalledWith(PHONE));

    fireEvent.change(await screen.findByTestId("otp-code-input"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));
    await waitFor(() => expect(onSmsVerify).toHaveBeenCalledWith("123456"));
  });

  it("the SMS branch's back arrow returns to the picker (Другой способ)", async () => {
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: /Код по SMS/i }));
    await screen.findByRole("button", { name: /Отправить код/i });

    fireEvent.click(screen.getByRole("button", { name: /назад/i }));
    await screen.findByTestId("auth-method-picker");
  });
});

describe("AuthScreen — выход (#593)", () => {
  it("the picker's back arrow calls onBack (to the booking form / phone form)", async () => {
    const onBack = vi.fn();
    renderScreen({ onBack });

    fireEvent.click(await screen.findByRole("button", { name: /назад/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
