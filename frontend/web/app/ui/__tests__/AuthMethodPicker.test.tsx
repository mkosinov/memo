import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { AuthMethodPicker } from "../AuthMethodPicker";
import type { AuthMethod } from "@memo/api-client";

function registry(...entries: Array<[AuthMethod["id"], boolean]>): AuthMethod[] {
  return entries.map(([id, available]) => ({ id, available }));
}

function renderPicker(
  props: Partial<React.ComponentProps<typeof AuthMethodPicker>> = {},
) {
  return render(
    <AuthMethodPicker
      methods={props.methods ?? registry(["sms_otp", true], ["call", true])}
      loading={props.loading ?? false}
      onSelectCall={props.onSelectCall ?? vi.fn()}
      onSelectSms={props.onSelectSms ?? vi.fn()}
    />,
  );
}

describe("AuthMethodPicker — реестр методов (#593 US-3)", () => {
  it("renders a button per AVAILABLE method when both are on (dev)", () => {
    renderPicker();

    const picker = screen.getByTestId("auth-method-picker");
    expect(
      screen.getByRole("button", { name: /Подтвердить звонком/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Код по SMS/i })).toBeInTheDocument();
    expect(picker).toContainElement(
      screen.getByRole("button", { name: /Подтвердить звонком/i }),
    );
  });

  it("hides a method the registry marks unavailable", () => {
    renderPicker({ methods: registry(["sms_otp", true], ["call", false]) });

    expect(
      screen.queryByRole("button", { name: /Подтвердить звонком/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Код по SMS/i })).toBeInTheDocument();
  });

  it("shows only the call method when SMS is off", () => {
    renderPicker({ methods: registry(["sms_otp", false], ["call", true]) });

    expect(
      screen.getByRole("button", { name: /Подтвердить звонком/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Код по SMS/i }),
    ).not.toBeInTheDocument();
  });

  it("empty registry → «Вход временно недоступен», no method buttons", () => {
    renderPicker({ methods: registry(["sms_otp", false], ["call", false]) });

    expect(screen.getByText("Вход временно недоступен")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Подтвердить звонком/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Код по SMS/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a loading state while the registry loads", () => {
    renderPicker({ methods: [], loading: true });

    expect(screen.getByText(/Загрузка/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Подтвердить звонком/i }),
    ).not.toBeInTheDocument();
  });

  it("passes the method choice up", () => {
    const onSelectCall = vi.fn();
    const onSelectSms = vi.fn();
    renderPicker({ onSelectCall, onSelectSms });

    fireEvent.click(
      screen.getByRole("button", { name: /Подтвердить звонком/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Код по SMS/i }));
    expect(onSelectCall).toHaveBeenCalledTimes(1);
    expect(onSelectSms).toHaveBeenCalledTimes(1);
  });
});
