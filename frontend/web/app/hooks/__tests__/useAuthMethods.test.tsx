import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
  return {
    ApiError,
    getAuthMethods: vi.fn(),
  };
});

import { getAuthMethods, ApiError } from "@memo/api-client";
import { createQueryWrapper } from "../../__tests__/fixtures/cabinet";
import { useAuthMethods } from "../useAuthMethods";

const mockedGetAuthMethods = getAuthMethods as unknown as Mock;

beforeEach(() => {
  mockedGetAuthMethods.mockReset();
});

describe("useAuthMethods — реестр методов (#593 US-3)", () => {
  it("exposes the raw registry and the available-only list", async () => {
    mockedGetAuthMethods.mockResolvedValue([
      { id: "sms_otp", available: false },
      { id: "call", available: true },
    ]);
    const { result } = renderHook(() => useAuthMethods(), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.methods).toEqual([
      { id: "sms_otp", available: false },
      { id: "call", available: true },
    ]);
    expect(result.current.availableMethods).toEqual([{ id: "call", available: true }]);
  });

  it("a failed fetch degrades to an empty registry (picker: недоступен)", async () => {
    mockedGetAuthMethods.mockRejectedValue(new ApiError(500, "boom"));
    const { result } = renderHook(() => useAuthMethods(), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.methods).toEqual([]);
    expect(result.current.availableMethods).toEqual([]);
  });
});
