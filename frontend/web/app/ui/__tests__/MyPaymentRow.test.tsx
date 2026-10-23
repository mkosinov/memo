import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyPaymentRow } from "../MyPaymentRow";
import { myPaymentRowView } from "@/app/__tests__/fixtures/cabinet";

describe("MyPaymentRow", () => {
  it("renders the row with amount, method, payment date and the row testid", () => {
    render(<MyPaymentRow payment={myPaymentRowView()} />);

    expect(screen.getByTestId("my-payment-row")).toBeInTheDocument();
    expect(screen.getByTestId("my-payment-amount")).toHaveTextContent("6 000 ₽");
    expect(screen.getByTestId("my-payment-method")).toHaveTextContent("Карта");
    expect(screen.getByTestId("my-payment-date")).toHaveTextContent("16 июня");
  });

  it("renders the lesson context: service title + lesson date", () => {
    render(
      <MyPaymentRow
        payment={myPaymentRowView({
          serviceTitle: "Морской пейзаж",
          lessonDateFormatted: "15 июня",
        })}
      />,
    );

    const lesson = screen.getByTestId("my-payment-lesson");
    expect(lesson).toHaveTextContent("Морской пейзаж");
    expect(lesson).toHaveTextContent("15 июня");
  });

  it("renders the «Способ не указан» label for a null-method payment", () => {
    render(
      <MyPaymentRow payment={myPaymentRowView({ methodLabel: "Способ не указан" })} />,
    );

    expect(screen.getByTestId("my-payment-method")).toHaveTextContent(
      "Способ не указан",
    );
  });
});
