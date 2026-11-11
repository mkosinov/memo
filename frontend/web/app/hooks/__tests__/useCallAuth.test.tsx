import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

// ── Mock the client-branch API (#593): initiate + status poll ───────────────
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
    initiateCallAuth: vi.fn(),
    callAuthStatus: vi.fn(),
  };
});

import { initiateCallAuth, callAuthStatus, ApiError } from "@memo/api-client";
import { createQueryWrapper } from "../../__tests__/fixtures/cabinet";
import { useCallAuth } from "../useCallAuth";

const mockedInitiate = initiateCallAuth as unknown as Mock;
const mockedStatus = callAuthStatus as unknown as Mock;

const PHONE = "+79991234567";
const CALL_PHONE = "+79995552255";
const WINDOW_MS = 5 * 60 * 1000;

/** A real initiate 202 with the window `WINDOW_MS` from `fromNow`. */
function initiateResponse(fromNow = WINDOW_MS) {
  return {
    handle: "handle-1",
    call: {
      phone: CALL_PHONE,
      pretty: "+7 999 555-22-55",
      expires_at: new Date(Date.now() + fromNow).toISOString(),
    },
  };
}

/** Drives initiate to the calling phase (the default happy start). */
async function startCalling() {
  mockedInitiate.mockResolvedValue(initiateResponse());
  let ok = false;
  await act(async () => {
    ok = await result.current.initiate(PHONE);
  });
  expect(ok).toBe(true);
}

let result: { current: ReturnType<typeof useCallAuth> };

function renderCallAuth() {
  const rendered = renderHook(() => useCallAuth(), {
    wrapper: createQueryWrapper(),
  });
  result = rendered.result;
  return rendered;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockedInitiate.mockReset();
  mockedStatus.mockReset();
  mockedStatus.mockResolvedValue({ status: "waiting" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCallAuth — initiate (#593)", () => {
  it("reaches the calling phase with the parsed call info", async () => {
    renderCallAuth();
    await startCalling();

    expect(result.current.phase).toBe("calling");
    // The exact contract bits:
    expect(result.current.call?.handle).toBe("handle-1");
    expect(result.current.call?.phone).toBe(CALL_PHONE);
    expect(result.current.call?.pretty).toBe("+7 999 555-22-55");
    expect(result.current.call?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("canonicalizes the phone before the request", async () => {
    renderCallAuth();
    mockedInitiate.mockResolvedValue(initiateResponse());
    await act(async () => {
      await result.current.initiate("+7 (999) 123-45-67");
    });
    expect(mockedInitiate).toHaveBeenCalledWith("+79991234567");
  });

  it("refuses without a request when the phone cannot be canonicalized", async () => {
    renderCallAuth();
    let ok = true;
    await act(async () => {
      ok = await result.current.initiate("12345");
    });
    expect(ok).toBe(false);
    expect(mockedInitiate).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBe("Не удалось подтвердить телефон");
  });

  it("treats the empty 202 (silent staff skip) as a failure to start", async () => {
    renderCallAuth();
    mockedInitiate.mockResolvedValue({});
    let ok = true;
    await act(async () => {
      ok = await result.current.initiate(PHONE);
    });
    expect(ok).toBe(false);
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBe("Не удалось подтвердить телефон");
  });

  it("maps 503 to «Вход временно недоступен» (fail-closed transport)", async () => {
    renderCallAuth();
    mockedInitiate.mockRejectedValue(
      new ApiError(503, "notification transport unavailable", "NOTIFICATION_TRANSPORT_UNAVAILABLE"),
    );
    let ok = true;
    await act(async () => {
      ok = await result.current.initiate(PHONE);
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe("Вход временно недоступен");
  });

  it("surfaces the server's structured 429 message", async () => {
    renderCallAuth();
    mockedInitiate.mockRejectedValue(
      new ApiError(429, "Слишком много попыток. Попробуйте позже", "AUTH_LOCKED_OUT"),
    );
    await act(async () => {
      await result.current.initiate(PHONE);
    });
    expect(result.current.error).toBe("Слишком много попыток. Попробуйте позже");
  });
});

describe("useCallAuth — status poll (#593)", () => {
  it("starts polling after initiate and flips to confirmed", async () => {
    renderCallAuth();
    await startCalling();

    await waitFor(() => expect(mockedStatus).toHaveBeenCalledWith("handle-1"));
    mockedStatus.mockResolvedValue({ status: "confirmed" });
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    await waitFor(() => expect(result.current.phase).toBe("confirmed"));
  });

  it("flips to invalid on the poll's 404 (handle consumed/replaced)", async () => {
    renderCallAuth();
    mockedStatus.mockRejectedValue(new ApiError(404, "Not Found"));
    await startCalling();

    await waitFor(() => expect(result.current.phase).toBe("invalid"));
  });

  it("flips to expired when the poll says expired", async () => {
    renderCallAuth();
    mockedStatus.mockResolvedValue({ status: "expired" });
    await startCalling();

    await waitFor(() => expect(result.current.phase).toBe("expired"));
  });

  it("keeps waiting while the poll says waiting (no terminal flip)", async () => {
    renderCallAuth();
    await startCalling();

    await waitFor(() => expect(mockedStatus).toHaveBeenCalled());
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.phase).toBe("calling");
  });
});

describe("useCallAuth — countdown vs poll (#593: результат опроса побеждает отсчёт)", () => {
  it("flips to expired when the window runs out locally", async () => {
    renderCallAuth();
    mockedInitiate.mockResolvedValue(initiateResponse(5000));
    await act(async () => {
      await result.current.initiate(PHONE);
    });
    expect(result.current.secondsLeft).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.phase).toBe("expired");
    expect(result.current.secondsLeft).toBe(0);
  });

  it("a late confirmed poll beats the local countdown expiry", async () => {
    renderCallAuth();
    mockedInitiate.mockResolvedValue(initiateResponse(5000));
    await act(async () => {
      await result.current.initiate(PHONE);
    });
    // First fetch: waiting. Countdown runs out → expired …
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.phase).toBe("expired");
    // … but the next poll confirms the last-second call — it wins.
    mockedStatus.mockResolvedValue({ status: "confirmed" });
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    await waitFor(() => expect(result.current.phase).toBe("confirmed"));
  });

  it("counts down in mm:ss-sized whole seconds while calling", async () => {
    renderCallAuth();
    mockedInitiate.mockResolvedValue(initiateResponse(300_000));
    await act(async () => {
      await result.current.initiate(PHONE);
    });
    expect(result.current.secondsLeft).toBeLessThanOrEqual(300);
    expect(result.current.secondsLeft).toBeGreaterThan(295);
  });
});

describe("useCallAuth — retry & reset (#593)", () => {
  it("retry re-initiates the same phone with a fresh window", async () => {
    renderCallAuth();
    await startCalling();

    mockedInitiate.mockResolvedValue({ ...initiateResponse(), handle: "handle-2" });
    let ok = false;
    await act(async () => {
      ok = await result.current.retry();
    });
    expect(ok).toBe(true);
    expect(mockedInitiate).toHaveBeenCalledTimes(2);
    expect(mockedInitiate).toHaveBeenLastCalledWith(PHONE);
    expect(result.current.phase).toBe("calling");
    expect(result.current.call?.handle).toBe("handle-2");
  });

  it("reset drops the check and returns to idle", async () => {
    renderCallAuth();
    await startCalling();
    act(() => {
      result.current.reset();
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.call).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
