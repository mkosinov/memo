import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

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
  return { ApiError, requestOtpCode: vi.fn(), verifyOtpCode: vi.fn() };
});

import { requestOtpCode, verifyOtpCode, ApiError } from "@memo/api-client";
import { useOtpLogin } from "../useOtpLogin";

const mockedRequest = requestOtpCode as unknown as Mock;
const mockedVerify = verifyOtpCode as unknown as Mock;

describe("useOtpLogin — code request (US-4)", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockedVerify.mockReset();
  });

  it("moves to entering after a 202 and surfaces dev_code when present", async () => {
    mockedRequest.mockResolvedValue({ dev_code: "123456" });

    const { result } = renderHook(() => useOtpLogin());
    await act(async () => {
      await result.current.requestCode("+79991234567");
    });

    expect(mockedRequest).toHaveBeenCalledWith("+79991234567");
    expect(result.current.stage).toBe("entering");
    expect(result.current.devCode).toBe("123456");
    expect(result.current.error).toBeNull();
  });

  it("maps 503 to «Вход временно недоступен» and stays requestable", async () => {
    mockedRequest.mockRejectedValue(
      new ApiError(503, "notify transport unavailable", "NOTIFY_TRANSPORT_UNAVAILABLE"),
    );

    const { result } = renderHook(() => useOtpLogin());
    await act(async () => {
      await result.current.requestCode("+79991234567");
    });

    expect(result.current.stage).toBe("idle");
    expect(result.current.error).toBe("Вход временно недоступен");
  });

  it("shows the server message for structured request failures (e.g. 429)", async () => {
    mockedRequest.mockRejectedValue(
      new ApiError(429, "Слишком часто. Попробуйте позже", "AUTH_LOCKED_OUT"),
    );

    const { result } = renderHook(() => useOtpLogin());
    await act(async () => {
      await result.current.requestCode("+79991234567");
    });

    expect(result.current.error).toBe("Слишком часто. Попробуйте позже");
  });

  it("falls back to the localized message when the refusal carries no structured detail", async () => {
    // No code → message is the client-synthesized "API error: N ..." — never raw to a client.
    mockedRequest.mockRejectedValue(new ApiError(429, "API error: 429 Too Many Requests"));

    const { result } = renderHook(() => useOtpLogin());
    await act(async () => {
      await result.current.requestCode("+79991234567");
    });

    expect(result.current.error).toBe("Не удалось подтвердить телефон");
  });

  it("falls back to a connection hint on network errors", async () => {
    mockedRequest.mockRejectedValue(new TypeError("fetch failed"));

    const { result } = renderHook(() => useOtpLogin());
    await act(async () => {
      await result.current.requestCode("+79991234567");
    });

    expect(result.current.error).toBe("Не удалось отправить код. Проверьте соединение");
  });
});

describe("useOtpLogin — verify", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockedVerify.mockReset();
  });

  it("returns the client on success", async () => {
    const client = { phone: "+79991234567", name: null };
    mockedVerify.mockResolvedValue(client);

    const { result } = renderHook(() => useOtpLogin());
    let verified = null as null | Awaited<ReturnType<typeof result.current.verify>>;
    await act(async () => {
      verified = await result.current.verify("+79991234567", "123456");
    });

    expect(mockedVerify).toHaveBeenCalledWith("+79991234567", "123456");
    expect(verified).toEqual(client);
    expect(result.current.error).toBeNull();
  });

  it("returns null and renders the step error on a wrong/expired code (401)", async () => {
    mockedVerify.mockRejectedValue(new ApiError(401, "Неверный код", "AUTH_INVALID_OTP"));

    const { result } = renderHook(() => useOtpLogin());
    let verified: unknown = "unset";
    await act(async () => {
      verified = await result.current.verify("+79991234567", "000000");
    });

    expect(verified).toBeNull();
    expect(result.current.stage).toBe("entering");
    expect(result.current.error).toBe("Неверный код");
  });

  it("falls back when a verify refusal carries no structured detail", async () => {
    mockedVerify.mockRejectedValue(new ApiError(401, "API error: 401 Unauthorized"));

    const { result } = renderHook(() => useOtpLogin());
    await act(async () => {
      await result.current.verify("+79991234567", "000000");
    });

    expect(result.current.error).toBe("Не удалось подтвердить телефон");
  });
});
