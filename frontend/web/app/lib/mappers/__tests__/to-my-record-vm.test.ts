import { describe, it, expect } from "vitest";
import { toMyRecordCardView } from "../to-my-record-vm";
import { myRecordItem } from "@/app/__tests__/fixtures/cabinet";
import type { MyRecordItem } from "@memo/api-client";

describe("toMyRecordCardView", () => {
  it("maps all card fields: formatted date, start–end time, service, comment", () => {
    const vm = toMyRecordCardView(
      myRecordItem({ comment: "Позвать за 15 минут" }),
    );

    expect(vm.id).toBe("rec-1");
    expect(vm.dateFormatted).toBe("16 июня");
    expect(vm.timeFormatted).toBe("15:00–16:00");
    expect(vm.serviceTitle).toBe("Мини-картина акрилом");
    expect(vm.comment).toBe("Позвать за 15 минут");
  });

  it("keeps comment null (the card hides the block for null)", () => {
    const vm = toMyRecordCardView(myRecordItem());
    expect(vm.comment).toBeNull();
  });

  it("maps a named visitor row: name, status label, formatted price", () => {
    const vm = toMyRecordCardView(myRecordItem());
    expect(vm.visits).toHaveLength(1);
    expect(vm.visits[0]).toEqual({
      id: "vis-1",
      visitorName: "Анна Иванова",
      status: "visited",
      statusLabel: "Состоялось",
      priceFormatted: "2 000 ₽",
    });
  });

  it("labels an anonymous seat (visitor_name null) as «Посетитель»", () => {
    const vm = toMyRecordCardView(
      myRecordItem({
        visits: [{ id: "vis-2", visitor_name: null, status: "waiting", price: 3800 }],
      }),
    );
    expect(vm.visits[0].visitorName).toBe("Посетитель");
  });

  it("translates every visit status to its Russian label", () => {
    const cases: Array<[MyRecordItem["visits"][number]["status"], string]> = [
      ["waiting", "Ожидает"],
      ["visited", "Состоялось"],
      ["missed", "Пропущено"],
      ["cancelled", "Отменено"],
    ];
    for (const [status, label] of cases) {
      const vm = toMyRecordCardView(
        myRecordItem({
          visits: [{ id: "vis-x", visitor_name: "Анна", status, price: 1000 }],
        }),
      );
      expect(vm.visits[0].statusLabel).toBe(label);
    }
  });

  it("formats prices with the ru-RU thousands separator", () => {
    const vm = toMyRecordCardView(
      myRecordItem({
        visits: [{ id: "vis-3", visitor_name: "Софья", status: "visited", price: 3500 }],
      }),
    );
    expect(vm.visits[0].priceFormatted).toBe("3 500 ₽");
  });

  it("keeps the visits order (server sends id ASC)", () => {
    const vm = toMyRecordCardView(
      myRecordItem({
        visits: [
          { id: "vis-a", visitor_name: "Первая", status: "waiting", price: 100 },
          { id: "vis-b", visitor_name: "Вторая", status: "waiting", price: 200 },
        ],
      }),
    );
    expect(vm.visits.map((v) => v.visitorName)).toEqual(["Первая", "Вторая"]);
  });
});
