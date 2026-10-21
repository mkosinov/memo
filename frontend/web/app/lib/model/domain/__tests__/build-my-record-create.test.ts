import { describe, it, expect } from "vitest";
import { buildMyRecordCreate, SEATS_KEY, visitorRowKey } from "../booking";

const tariffs = [
  { id: "t-adult", title: "Взрослый", price: 1500 },
  { id: "t-kid", title: "Детский (5–11 лет)", price: 1050 },
];

describe("buildMyRecordCreate — tariff service (US-1)", () => {
  it("builds one visit per selected seat carrying its tariff_id", () => {
    const payload = buildMyRecordCreate({
      activityId: "act-1",
      phone: "+79991234567",
      comment: "",
      counts: { "t-adult": 2, "t-kid": 1 },
      visitors: {},
      tariffs,
    });

    expect(payload.activity_id).toBe("act-1");
    expect(payload.phone).toBe("+79991234567");
    expect(payload.visits).toHaveLength(3);
    expect(payload.visits.every((v) => v.name === null && v.age === null)).toBe(true);
    expect(payload.visits.filter((v) => v.tariff_id === "t-adult")).toHaveLength(2);
    expect(payload.visits.filter((v) => v.tariff_id === "t-kid")).toHaveLength(1);
  });

  it("maps visitor rows by stable key: names trimmed, ages parsed, empties → null (anonymous)", () => {
    const payload = buildMyRecordCreate({
      activityId: "act-1",
      phone: "+79991234567",
      comment: "",
      counts: { "t-adult": 2 },
      visitors: {
        [visitorRowKey("t-adult", 0)]: { name: "  Иван  ", age: "9" },
        [visitorRowKey("t-adult", 1)]: { name: "", age: "" },
      },
      tariffs,
    });

    expect(payload.visits[0]).toEqual({ name: "Иван", age: 9, tariff_id: "t-adult" });
    expect(payload.visits[1]).toEqual({ name: null, age: null, tariff_id: "t-adult" });
  });

  it("treats a non-numeric age as absent (null)", () => {
    const payload = buildMyRecordCreate({
      activityId: "act-1",
      phone: "+79991234567",
      comment: "",
      counts: { "t-adult": 1 },
      visitors: { [visitorRowKey("t-adult", 0)]: { name: "Оля", age: "abc" } },
      tariffs,
    });

    expect(payload.visits[0]).toEqual({ name: "Оля", age: null, tariff_id: "t-adult" });
  });

  it("rejects partially-numeric ages instead of parseInt-truncating them", () => {
    const payload = buildMyRecordCreate({
      activityId: "act-1",
      phone: "+79991234567",
      comment: "",
      counts: { "t-adult": 2 },
      visitors: {
        [visitorRowKey("t-adult", 0)]: { name: "Оля", age: "9abc" },
        [visitorRowKey("t-adult", 1)]: { name: "Пётр", age: " 7 " },
      },
      tariffs,
    });

    // "9abc" is garbage → null; " 7 " is a numeric string with padding → 7.
    expect(payload.visits[0].age).toBeNull();
    expect(payload.visits[1].age).toBe(7);
  });

  it("orders visits by tariff order, then seat index", () => {
    const payload = buildMyRecordCreate({
      activityId: "act-1",
      phone: "+79991234567",
      comment: "",
      counts: { "t-kid": 1, "t-adult": 1 },
      visitors: {},
      tariffs, // adult first in the array
    });

    expect(payload.visits.map((v) => v.tariff_id)).toEqual(["t-adult", "t-kid"]);
  });
});

describe("buildMyRecordCreate — tariff-free service (US-2)", () => {
  it("builds visits from the single seats counter with null tariff_id", () => {
    const payload = buildMyRecordCreate({
      activityId: "act-2",
      phone: "+79991234567",
      comment: "",
      counts: { [SEATS_KEY]: 2 },
      visitors: { [visitorRowKey(SEATS_KEY, 0)]: { name: "Мария", age: "" } },
      tariffs: [],
    });

    expect(payload.visits).toHaveLength(2);
    expect(payload.visits[0]).toEqual({ name: "Мария", age: null, tariff_id: null });
    expect(payload.visits[1]).toEqual({ name: null, age: null, tariff_id: null });
  });
});

describe("buildMyRecordCreate — comment", () => {
  it("collapses an empty/whitespace comment to null", () => {
    const payload = buildMyRecordCreate({
      activityId: "act-1",
      phone: "+79991234567",
      comment: "   ",
      counts: { "t-adult": 1 },
      visitors: {},
      tariffs,
    });

    expect(payload.comment).toBeNull();
  });

  it("keeps a trimmed comment", () => {
    const payload = buildMyRecordCreate({
      activityId: "act-1",
      phone: "+79991234567",
      comment: " Приветём друга ",
      counts: { "t-adult": 1 },
      visitors: {},
      tariffs,
    });

    expect(payload.comment).toBe("Приветём друга");
  });
});
