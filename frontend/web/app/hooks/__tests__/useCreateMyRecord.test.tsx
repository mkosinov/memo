import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { MyRecordCreate } from "@memo/api-client";

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
  return { ApiError, createMyRecord: vi.fn() };
});

import { createMyRecord, ApiError } from "@memo/api-client";
import { useCreateMyRecord } from "../useCreateMyRecord";

const mockedCreate = createMyRecord as unknown as Mock;

const payload: MyRecordCreate = {
  activity_id: "act-1",
  phone: "+79991234567",
  comment: null,
  visits: [{ name: null, age: null, tariff_id: "t-adult" }],
};

const created = {
  id: "rec-1",
  activity_id: "act-1",
  start: "2026-05-20T14:00:00",
  comment: null,
  visits: [{ name: null, age: null, tariff_id: "t-adult", price: 1500 }],
};

describe("useCreateMyRecord — submission (US-1/US-3)", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
  });

  it("submits via createMyRecord and resolves true on 201", async () => {
    mockedCreate.mockResolvedValue(created);

    const { result } = renderHook(() => useCreateMyRecord());
    let ok: boolean | null = null;
    await act(async () => {
      ok = await result.current.submit(payload);
    });

    expect(mockedCreate).toHaveBeenCalledWith(payload);
    expect(ok).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("captures the server message on refusal (US-3)", async () => {
    mockedCreate.mockRejectedValue(new ApiError(409, "Недостаточно мест"));

    const { result } = renderHook(() => useCreateMyRecord());
    let ok: boolean | null = null;
    await act(async () => {
      ok = await result.current.submit(payload);
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Недостаточно мест");
  });

  it("falls back to a connection hint on network failure (US-3)", async () => {
    mockedCreate.mockRejectedValue(new TypeError("fetch failed"));

    const { result } = renderHook(() => useCreateMyRecord());
    await act(async () => {
      await result.current.submit(payload);
    });

    expect(result.current.error).toBe(
      "Не удалось отправить запись. Проверьте соединение и попробуйте еще раз",
    );
  });

  it("clears the previous error while a retry is in flight", async () => {
    mockedCreate.mockRejectedValueOnce(new ApiError(409, "Недостаточно мест"));

    const { result } = renderHook(() => useCreateMyRecord());
    await act(async () => {
      await result.current.submit(payload);
    });
    expect(result.current.error).toBe("Недостаточно мест");

    let resolved = false;
    mockedCreate.mockImplementation(
      () => new Promise((r) => setTimeout(() => r(created), 10)),
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = result.current.submit(payload);
    });
    expect(result.current.status).toBe("submitting");
    expect(result.current.error).toBeNull();
    await act(async () => {
      resolved = await pending;
    });
    expect(resolved).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });
});
