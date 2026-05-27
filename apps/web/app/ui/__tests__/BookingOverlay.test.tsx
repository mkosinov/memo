import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  location: { id: "loc-1", name: "Парк Горького", address: "ул. Тестовая, 1" },
  guestPhotos: [],
};

function renderOverlay(props: Partial<React.ComponentProps<typeof BookingActivityOverlay>> = {}) {
  return render(
    <BookingActivityOverlay
      isOpen={props.isOpen ?? true}
      onClose={props.onClose ?? vi.fn()}
      activityId="act-1"
      activities={[mockActivity]}
    />,
  );
}

describe("BookingActivityOverlay", () => {
  it("renders form state when open", () => {
    renderOverlay();

    expect(screen.getByText("Оформление записи")).toBeInTheDocument();
    expect(screen.getByText("Тестовое мероприятие")).toBeInTheDocument();
    // Time is rendered as part of "{dateFormatted}, {time}" line
    expect(screen.getByText(/14:00.*16:00/)).toBeInTheDocument();
    expect(screen.getByText("Парк Горького")).toBeInTheDocument();
  });

  it("calculates total correctly with tariff-based counters", () => {
    renderOverlay();

    // Initial: all counters at 0 → total 0
    expect(screen.getByText(/Итого:/)).toHaveTextContent("Итого: 0 ₽");

    // Add 2 adults (first tariff): 2 * 1500 = 3000
    const increaseButtons = screen.getAllByRole("button", { name: /increase/i });
    fireEvent.click(increaseButtons[0]);
    fireEvent.click(increaseButtons[0]);
    expect(screen.getByText(/Итого:/)).toHaveTextContent("Итого: 3 000 ₽");

    // Add 1 child (second tariff): 3000 + 1050 = 4050 (child = maxPrice * 0.7 = 1500 * 0.7 = 1050)
    fireEvent.click(increaseButtons[1]);
    expect(screen.getByText(/Итого:/)).toHaveTextContent("Итого: 4 050 ₽");
  });

  it("renders counters based on service tariffs", () => {
    renderOverlay();

    expect(screen.getByText("Взрослый")).toBeInTheDocument();
    expect(screen.getByText("1 500 ₽")).toBeInTheDocument();
    expect(screen.getByText("Детский (5–11 лет)")).toBeInTheDocument();
    expect(screen.getByText("1 050 ₽")).toBeInTheDocument();
  });

  it("disables submit when no participants selected", () => {
    renderOverlay();

    const submitBtn = screen.getByRole("button", { name: /Записаться/i });
    expect(submitBtn).toBeDisabled();
  });

  it("disables submit when form is invalid", async () => {
    renderOverlay();

    // Add 1 adult (first tariff) so total > 0
    const increaseButtons = screen.getAllByRole("button", { name: /increase/i });
    fireEvent.click(increaseButtons[0]);

    // Form is invalid (name, phone, confirmation not filled)
    const submitBtn = screen.getByRole("button", { name: /Записаться/i });
    expect(submitBtn).toBeDisabled();
  });

  it("shows success state after booking", async () => {
    renderOverlay();

    // Fill form: name
    const nameInput = screen.getByLabelText("Имя");
    fireEvent.change(nameInput, { target: { value: "Иван" } });

    // Fill form: phone
    const phoneInput = screen.getByLabelText("Телефон");
    fireEvent.change(phoneInput, { target: { value: "+79991234567" } });

    // Telegram is default, no need to change

    // Add 1 adult (first tariff)
    const increaseButtons = screen.getAllByRole("button", { name: /increase/i });
    fireEvent.click(increaseButtons[0]);

    // Submit
    const submitBtn = screen.getByRole("button", { name: /Записаться/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    // Success state
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
