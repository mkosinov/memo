import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ActivityView } from "../../lib/model/view/activity";
import { BookingActivityOverlay } from "../BookingActivityOverlay";

const mockActivity: ActivityView = {
  id: "act-1",
  title: "Тестовое мероприятие",
  imageUrl: "/test-image.jpg",
  category: "вместе",
  time: "14:00 – 16:00",
  duration: "2 ч",
  guestsCount: 8,
  material: "Акрил",
  size: "30×40 см",
  priceMin: 1000,
  priceMax: 1500,
  teacherName: "Анна",
  date: "2026-05-20",
  dateFormatted: "20 мая",
  priceFormatted: "1 000 – 1 500 ₽",
  categoryColor: "#5B8C7A",
  location: { id: "loc-1", title: "Парк Горького", address: "ул. Тестовая, 1" },
  guestPhotos: [],
  tariffs: [
    { id: "tariff-adult", title: "Взрослый", price: 1500 },
    { id: "tariff-kid", title: "Детский (5–11 лет)", price: 1050 },
  ],
};

const mockActivityNoTariffs: ActivityView = {
  ...mockActivity,
  id: "act-2",
  tariffs: [],
};

function renderOverlay(props: Partial<React.ComponentProps<typeof BookingActivityOverlay>> = {}) {
  return render(
    <BookingActivityOverlay
      isOpen={props.isOpen ?? true}
      onClose={props.onClose ?? vi.fn()}
      activityId={props.activityId ?? "act-1"}
      activities={props.activities ?? [mockActivity, mockActivityNoTariffs]}
      tariffsStatus={props.tariffsStatus}
    />,
  );
}

/** Click the "+" button inside a tariff counter identified by its data-testid. */
function increaseTariffSeats(testId: string, times = 1) {
  const counter = screen.getByTestId(testId);
  const plus = within(counter).getByRole("button", { name: /increase/i });
  for (let i = 0; i < times; i += 1) fireEvent.click(plus);
}

describe("BookingActivityOverlay — real tariffs (US-1)", () => {
  it("renders one counter per tariff with tariff-counter-{id} testid and price next to it", () => {
    renderOverlay();

    const adult = screen.getByTestId("tariff-counter-tariff-adult");
    expect(adult).toHaveTextContent("Взрослый");
    expect(adult).toHaveTextContent("1 500 ₽");

    const kid = screen.getByTestId("tariff-counter-tariff-kid");
    expect(kid).toHaveTextContent("Детский (5–11 лет)");
    expect(kid).toHaveTextContent("1 050 ₽");
  });

  it("computes the total from real tariff prices", () => {
    renderOverlay();

    expect(screen.getByText(/Итого:/)).toHaveTextContent("Итого: 0 ₽");

    // 2 adults (1500) + 1 kid (1050) = 4050
    increaseTariffSeats("tariff-counter-tariff-adult", 2);
    increaseTariffSeats("tariff-counter-tariff-kid", 1);
    expect(screen.getByText(/Итого:/)).toHaveTextContent("Итого: 4 050 ₽");
  });

  it("keeps the channel selector visible", () => {
    renderOverlay();

    // Selector stays visible (spec §7: untouchable, non-functional)
    expect(screen.getByLabelText("Отправить детали записи в:")).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
  });
});

describe("BookingActivityOverlay — tariff-free service (US-2)", () => {
  it("renders a single seats counter and the price hint instead of tariff counters", () => {
    renderOverlay({ activityId: "act-2" });

    expect(screen.getByText("Места")).toBeInTheDocument();
    expect(screen.getByTestId("booking-price-hint")).toHaveTextContent(
      "Стоимость уточняется",
    );
    // No per-tariff counters and no misleading zero total
    expect(screen.queryByTestId(/^tariff-counter-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Итого:/)).not.toBeInTheDocument();
  });

  it("allows selecting seats on the single counter", () => {
    renderOverlay({ activityId: "act-2" });

    // Single counter → a unique increase button
    const plus = screen.getByRole("button", { name: /increase/i });
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("BookingActivityOverlay — visitors names table", () => {
  it("is hidden until «Указать имена посетителей» is clicked", () => {
    renderOverlay();

    expect(screen.queryByTestId("visitors-names-table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Указать имена посетителей/i }));
    expect(screen.getByTestId("visitors-names-table")).toBeInTheDocument();
  });

  it("shows one row per selected seat with name/age inputs and read-only tariff", () => {
    renderOverlay();

    increaseTariffSeats("tariff-counter-tariff-adult", 2);
    increaseTariffSeats("tariff-counter-tariff-kid", 1);
    fireEvent.click(screen.getByRole("button", { name: /Указать имена посетителей/i }));

    const table = screen.getByTestId("visitors-names-table");
    expect(within(table).getByText("Имя")).toBeInTheDocument();
    expect(within(table).getByText("Возраст")).toBeInTheDocument();
    expect(within(table).getByText("Тариф")).toBeInTheDocument();

    const rows = within(table).getAllByRole("row");
    // header + 3 seat rows
    expect(rows.length).toBe(4);
    expect(within(rows[1]).getByText("Взрослый")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Взрослый")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Детский (5–11 лет)")).toBeInTheDocument();

    // name and age are inputs; tariff is plain read-only text
    expect(within(rows[1]).getAllByRole("textbox").length).toBe(2);
    expect(within(rows[1]).getByText("Взрослый").tagName).toBe("TD");
  });

  it("accepts typed names and ages", () => {
    renderOverlay();

    increaseTariffSeats("tariff-counter-tariff-adult", 1);
    fireEvent.click(screen.getByRole("button", { name: /Указать имена посетителей/i }));

    const nameInput = screen.getByLabelText("Имя посетителя");
    const ageInput = screen.getByLabelText("Возраст посетителя");
    fireEvent.change(nameInput, { target: { value: "Иван" } });
    fireEvent.change(ageInput, { target: { value: "9" } });

    expect(nameInput).toHaveValue("Иван");
    expect(ageInput).toHaveValue("9");
  });

  it("adds and removes rows when seat counts change", () => {
    renderOverlay();

    increaseTariffSeats("tariff-counter-tariff-adult", 2);
    fireEvent.click(screen.getByRole("button", { name: /Указать имена посетителей/i }));

    let table = screen.getByTestId("visitors-names-table");
    expect(within(table).getAllByRole("row").length).toBe(3);

    const adultCounter = screen.getByTestId("tariff-counter-tariff-adult");
    fireEvent.click(within(adultCounter).getByRole("button", { name: /decrease/i }));
    table = screen.getByTestId("visitors-names-table");
    expect(within(table).getAllByRole("row").length).toBe(2);
  });

  it("hides the table when the toggle is clicked again", () => {
    renderOverlay();

    const toggle = screen.getByRole("button", { name: /Указать имена посетителей/i });
    fireEvent.click(toggle);
    expect(screen.getByTestId("visitors-names-table")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("visitors-names-table")).not.toBeInTheDocument();
  });
});

describe("BookingActivityOverlay — tariffs loading/error states", () => {
  it("shows a loading state instead of counters while tariffs load", () => {
    renderOverlay({ tariffsStatus: "loading" });

    expect(screen.getByTestId("booking-tariffs-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("tariff-counter-tariff-adult")).not.toBeInTheDocument();
    expect(screen.queryByText(/Итого:/)).not.toBeInTheDocument();
  });

  it("shows an error state instead of counters when tariffs fail to load", () => {
    renderOverlay({ tariffsStatus: "error" });

    expect(screen.getByTestId("booking-tariffs-error")).toBeInTheDocument();
    expect(screen.queryByTestId("tariff-counter-tariff-adult")).not.toBeInTheDocument();
    expect(screen.queryByText(/Итого:/)).not.toBeInTheDocument();
  });
});

describe("BookingActivityOverlay — form flow", () => {
  it("renders form state when open", () => {
    renderOverlay();

    expect(screen.getByText("Оформление записи")).toBeInTheDocument();
    expect(screen.getByText("Тестовое мероприятие")).toBeInTheDocument();
    // Time is rendered as part of "{dateFormatted}, {time}" line
    expect(screen.getByText(/14:00.*16:00/)).toBeInTheDocument();
    expect(screen.getByText("Парк Горького")).toBeInTheDocument();
  });

  it("disables submit when no participants selected", () => {
    renderOverlay();

    const submitBtn = screen.getByRole("button", { name: /Записаться/i });
    expect(submitBtn).toBeDisabled();
  });

  it("disables submit when form is invalid", () => {
    renderOverlay();

    increaseTariffSeats("tariff-counter-tariff-adult", 1);

    // Form is invalid (name, phone not filled)
    const submitBtn = screen.getByRole("button", { name: /Записаться/i });
    expect(submitBtn).toBeDisabled();
  });

  it("shows success state after booking", () => {
    renderOverlay();

    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByLabelText("Телефон"), { target: { value: "+79991234567" } });
    increaseTariffSeats("tariff-counter-tariff-adult", 1);

    const submitBtn = screen.getByRole("button", { name: /Записаться/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    expect(screen.getByText("Вы записаны!")).toBeInTheDocument();
    expect(screen.getByText("Готово")).toBeInTheDocument();
  });

  it("calls onClose when back button clicked", () => {
    const handleClose = vi.fn();
    renderOverlay({ onClose: handleClose });

    const backBtn = screen.getByRole("button", { name: /назад/i });
    fireEvent.click(backBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
