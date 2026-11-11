import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthCallScreen } from "../AuthCallScreen";

type CallPhase = "calling" | "expired" | "invalid";

function renderScreen(
  props: Partial<React.ComponentProps<typeof AuthCallScreen>> = {},
) {
  return render(
    <AuthCallScreen
      phone={props.phone ?? "+79995552255"}
      pretty={props.pretty ?? "+7 999 555-22-55"}
      secondsLeft={props.secondsLeft ?? 240}
      phase={props.phase ?? ("calling" as CallPhase)}
      initiating={props.initiating ?? false}
      onRetry={props.onRetry ?? vi.fn()}
      onRestart={props.onRestart ?? vi.fn()}
      onOtherMethod={props.onOtherMethod ?? vi.fn()}
    />,
  );
}

describe("AuthCallScreen — экран звонка (#593)", () => {
  it("renders the number as a tel: link: digits+plus in href, pretty visible text", () => {
    renderScreen();

    const link = screen.getByTestId("auth-call-number");
    expect(link).toHaveAttribute("href", "tel:+79995552255");
    expect(link).toHaveTextContent("+7 999 555-22-55");
    expect(screen.getByTestId("auth-call-screen")).toContainElement(link);
  });

  it("shows the honest call facts (free incl. roaming/abroad, beep, dropped & not charged)", () => {
    renderScreen();

    const screenEl = screen.getByTestId("auth-call-screen");
    expect(screenEl).toHaveTextContent(/бесплатен/i);
    expect(screenEl).toHaveTextContent(/роуминг/i);
    expect(screenEl).toHaveTextContent(/зарубежн/i);
    expect(screenEl).toHaveTextContent(/сообщени/i);
    expect(screenEl).toHaveTextContent(/сброс/i);
    expect(screenEl).toHaveTextContent(/тарифицир/i);
  });

  it("shows the remaining window as мм:сс", () => {
    renderScreen({ secondsLeft: 240 });

    expect(screen.getByTestId("auth-call-timer")).toHaveTextContent("04:00");
  });

  it("pads the timer below one minute", () => {
    renderScreen({ secondsLeft: 5 });

    expect(screen.getByTestId("auth-call-timer")).toHaveTextContent("00:05");
  });

  it("links back to the picker via «Другой способ»", () => {
    const onOtherMethod = vi.fn();
    renderScreen({ onOtherMethod });

    fireEvent.click(screen.getByRole("button", { name: /Другой способ/i }));
    expect(onOtherMethod).toHaveBeenCalledTimes(1);
  });

  it("expired → «Время вышло» + «Позвонить ещё раз» + «Связаться» entry stays", () => {
    const onRetry = vi.fn();
    renderScreen({ phase: "expired", onRetry });

    expect(screen.getByText("Время вышло")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /Позвонить ещё раз/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("invalid (404) → «Проверка недействительна» + «Начать заново»", () => {
    const onRestart = vi.fn();
    renderScreen({ phase: "invalid", onRestart });

    expect(screen.getByText("Проверка недействительна")).toBeInTheDocument();
    const restart = screen.getByRole("button", { name: /Начать заново/i });
    fireEvent.click(restart);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("keeps the call number visible in terminal states (the client may still dial)", () => {
    renderScreen({ phase: "expired" });

    expect(screen.getByTestId("auth-call-number")).toHaveAttribute(
      "href",
      "tel:+79995552255",
    );
  });

  it("disables «Позвонить ещё раз» while a retry initiate is in flight", () => {
    renderScreen({ phase: "expired", initiating: true });

    expect(
      screen.getByRole("button", { name: /Позвонить ещё раз/i }),
    ).toBeDisabled();
  });
});
