import { describe, it, expect } from "vitest";
import { toMyPaymentRowView } from "../to-my-payment-vm";
import { myPaymentItem } from "@/app/__tests__/fixtures/cabinet";

describe("toMyPaymentRowView (GET /my/payments item → «Мои платежи» row view)", () => {
  it("maps all row fields: formatted amount, method label, payment date, lesson context", () => {
    const vm = toMyPaymentRowView(
      myPaymentItem({
        amount: 6000,
        method: "card",
        created_at: "2026-06-16T12:00:00",
        record: {
          id: "rec-1",
          activity_date: "2026-06-15",
          service_title: "Морской пейзаж",
        },
      }),
    );

    expect(vm).toEqual({
      id: "pay-1",
      amountFormatted: "6 000 ₽",
      methodLabel: "Карта",
      dateFormatted: "16 июня",
      serviceTitle: "Морской пейзаж",
      lessonDateFormatted: "15 июня",
    });
  });

  it("translates every payment method to its exact Russian label", () => {
    const cases = [
      ["cash", "Наличные"],
      ["card", "Карта"],
      ["transfer", "Перевод"],
    ] as const;
    for (const [method, label] of cases) {
      expect(toMyPaymentRowView(myPaymentItem({ method })).methodLabel).toBe(label);
    }
  });

  it("labels a null method (legal by model) as «Способ не указан»", () => {
    expect(toMyPaymentRowView(myPaymentItem({ method: null })).methodLabel).toBe(
      "Способ не указан",
    );
  });

  it("formats the amount with the ru-RU thousands separator", () => {
    expect(
      toMyPaymentRowView(myPaymentItem({ amount: 2000 })).amountFormatted,
    ).toBe("2 000 ₽");
  });
});
