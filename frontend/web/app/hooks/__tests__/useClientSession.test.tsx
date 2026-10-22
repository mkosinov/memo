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
  return { ApiError, getMyClient: vi.fn() };
});

import { getMyClient, ApiError } from "@memo/api-client";
import { useClientSession } from "../useClientSession";

const mockedGetMyClient = getMyClient as unknown as Mock;

describe("useClientSession — session detection via getMyClient (#499)", () => {
  beforeEach(() => {
    mockedGetMyClient.mockReset();
  });

  it("is authenticated when a client session exists", async () => {
    mockedGetMyClient.mockResolvedValue({ phone: "+79990000001", name: "Анна" });

    const { result } = renderHook(() => useClientSession(true));

    expect(result.current.status).toBe("checking");
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.client).toEqual({ phone: "+79990000001", name: "Анна" });
    expect(mockedGetMyClient).toHaveBeenCalledTimes(1);
  });

  it("is anonymous on 401", async () => {
    mockedGetMyClient.mockRejectedValue(new ApiError(401, "unauthorized"));

    const { result } = renderHook(() => useClientSession(true));

    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(result.current.client).toBeNull();
  });

  it("is error on other failures (treated as anonymous by callers)", async () => {
    mockedGetMyClient.mockRejectedValue(new ApiError(500, "boom"));

    const { result } = renderHook(() => useClientSession(true));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.client).toBeNull();
  });

  it("does not call the API while inactive", () => {
    renderHook(() => useClientSession(false));

    expect(mockedGetMyClient).not.toHaveBeenCalled();
  });

  it("refresh() re-checks the session (e.g. after OTP login)", async () => {
    mockedGetMyClient.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

    const { result } = renderHook(() => useClientSession(true));
    await waitFor(() => expect(result.current.status).toBe("anonymous"));

    mockedGetMyClient.mockResolvedValue({ phone: "+79990000001", name: null });
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe("authenticated");
    expect(result.current.client?.phone).toBe("+79990000001");
  });
});
