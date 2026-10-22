import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OtpStep } from "../OtpStep";

function renderStep(props: Partial<React.ComponentProps<typeof OtpStep>> = {}) {
  return render(
    <OtpStep
      phone={props.phone ?? "+79991234567"}
      requesting={props.requesting ?? false}
      codeSent={props.codeSent ?? false}
      verifying={props.verifying ?? false}
      error={props.error ?? null}
      devCode={props.devCode ?? null}
      onRequestCode={props.onRequestCode ?? vi.fn()}
      onVerify={props.onVerify ?? vi.fn()}
      onBack={props.onBack ?? vi.fn()}
    />,
  );
}

describe("OtpStep — «подтвердите телефон» (#499 §8)", () => {
  it("shows the phone and the send-code button; no code input before the request", () => {
    renderStep();

    expect(screen.getByText("Подтвердите телефон")).toBeInTheDocument();
    expect(screen.getByText("+79991234567")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отправить код/i })).toBeInTheDocument();
    expect(screen.queryByTestId("otp-code-input")).not.toBeInTheDocument();
  });

  it("reveals the code input and «Подтвердить» after the code was sent", () => {
    renderStep({ codeSent: true });

    const input = screen.getByTestId("otp-code-input");
    expect(input).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Подтвердить/i })).toBeDisabled();
  });

  it("enables «Подтвердить» once a 6-digit code is entered and passes it up", () => {
    const handleVerify = vi.fn();
    renderStep({ codeSent: true, onVerify: handleVerify });

    fireEvent.change(screen.getByTestId("otp-code-input"), {
      target: { value: "123456" },
    });
    const confirm = screen.getByRole("button", { name: /Подтвердить/i });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(handleVerify).toHaveBeenCalledWith("123456");
  });

  it("renders the step error inside the step", () => {
    renderStep({ codeSent: true, error: "Неверный код" });

    const errorBlock = screen.getByTestId("otp-step-error");
    expect(errorBlock).toHaveTextContent("Неверный код");
  });

  it("shows the dev-transport code when present", () => {
    renderStep({ codeSent: true, devCode: "654321" });

    expect(screen.getByText(/654321/)).toBeInTheDocument();
  });

  it("disables the send button while the request is in flight", () => {
    renderStep({ requesting: true });

    expect(screen.getByRole("button", { name: /Отправить код/i })).toBeDisabled();
  });

  it("disables «Подтвердить» while verifying", () => {
    renderStep({ codeSent: true, verifying: true });

    fireEvent.change(screen.getByTestId("otp-code-input"), {
      target: { value: "123456" },
    });
    expect(screen.getByRole("button", { name: /Подтвердить/i })).toBeDisabled();
  });

  it("goes back to the form on the back arrow", () => {
    const handleBack = vi.fn();
    renderStep({ onBack: handleBack });

    fireEvent.click(screen.getByRole("button", { name: /назад/i }));
    expect(handleBack).toHaveBeenCalledTimes(1);
  });
});
