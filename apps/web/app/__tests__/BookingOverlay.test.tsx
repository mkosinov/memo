import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookingOverlay } from "../components/BookingOverlay";

const defaultActivity = {
  imageUrl: "/test-image.jpg",
  title: "Тестовое мероприятие",
  time: "14:00",
  location: "Парк Горького",
  tariffs: [
    { label: "Взрослый", price: 1500 },
    { label: "Детский (5–11 лет)", price: 800 },
  ],
};

function renderOverlay(props: Partial<React.ComponentProps<typeof BookingOverlay>> = {}) {
  return render(
    <BookingOverlay
      isOpen={props.isOpen ?? true}
      onClose={props.onClose ?? vi.fn()}
      activity={props.activity ?? defaultActivity}
    />,
  );
}

describe("BookingOverlay", () => {
  it("renders form state when open", () => {
    renderOverlay();

    expect(screen.getByText("Оформление записи")).toBeInTheDocument();
    expect(screen.getByText("Тестовое мероприятие")).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
    expect(screen.getByText("Парк Горького")).toBeInTheDocument();
  });

  it("calculates total correctly with tariff-based counters", () => {
    renderOverlay();

    // Initial: all counters at 0 → total 0
    expect(screen.getByText(/Итого:/)).toHaveTextContent("Итого: 0 ₽");

    // Add 2 adults (first tariff): 2 * 1500 = 3000
    const tariffPlusButtons = screen.getAllByRole("button", { name: /increase/i });
    fireEvent.click(tariffPlusButtons[0]);
    fireEvent.click(tariffPlusButtons[0]);
    expect(screen.getByText(/Итого:/)).toHaveTextContent("Итого: 3 000 ₽");

    // Add 1 child (second tariff): 3000 + 800 = 3800
    fireEvent.click(tariffPlusButtons[1]);
    expect(screen.getByText(/Итого:/)).toHaveTextContent("Итого: 3 800 ₽");
  });

  it("renders counters based on service tariffs", () => {
    renderOverlay();

    expect(screen.getByText("Взрослый")).toBeInTheDocument();
    expect(screen.getByText("1 500 ₽")).toBeInTheDocument();
    expect(screen.getByText("Детский (5–11 лет)")).toBeInTheDocument();
    expect(screen.getByText("800 ₽")).toBeInTheDocument();
  });

  it("disables submit when no participants selected", () => {
    renderOverlay();

    const submitBtn = screen.getByRole("button", { name: /Записаться/i });
    expect(submitBtn).toBeDisabled();
  });

  it("disables submit when form is invalid", async () => {
    const { container } = renderOverlay();

    // Add 1 adult (first tariff) so total > 0
    const tariffPlusButtons = screen.getAllByRole("button", { name: /increase/i });
    fireEvent.click(tariffPlusButtons[0]);

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
    const tariffPlusButtons = screen.getAllByRole("button", { name: /increase/i });
    fireEvent.click(tariffPlusButtons[0]);

    // Submit
    const submitBtn = screen.getByRole("button", { name: /Записаться/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    // Success state
    expect(screen.getByText("Вы записаны!")).toBeInTheDocument();
    expect(screen.getByText(/Получить напоминание в WhatsApp/)).toBeInTheDocument();
  });

  it("calls onClose when back button clicked", () => {
    const handleClose = vi.fn();
    renderOverlay({ onClose: handleClose });

    const backBtn = screen.getByRole("button", { name: /назад/i });
    fireEvent.click(backBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
