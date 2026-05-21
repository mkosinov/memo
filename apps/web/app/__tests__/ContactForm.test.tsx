import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContactForm } from "../components/ContactForm";

describe("ContactForm", () => {
  it("renders name, phone, comment fields and confirmation select", () => {
    render(<ContactForm />);
    expect(screen.getByPlaceholderText(/имя/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/телефон/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/комментарий/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/отправить детали/i)).toBeInTheDocument();
  });

  it("calls onValidityChange with true when form becomes valid", () => {
    const handleValidity = vi.fn();
    render(<ContactForm onValidityChange={handleValidity} />);

    const nameInput = screen.getByPlaceholderText(/имя/i);
    const phoneInput = screen.getByPlaceholderText(/телефон/i);
    const confirmSelect = screen.getByLabelText(/отправить детали/i);

    fireEvent.change(nameInput, { target: { value: "Анна" } });
    fireEvent.change(phoneInput, { target: { value: "+79001234567" } });
    fireEvent.change(confirmSelect, { target: { value: "max" } });

    // Should have been called with true at some point
    expect(handleValidity).toHaveBeenCalledWith(true);
  });

  it("calls onValidityChange with false when name is too short", () => {
    const handleValidity = vi.fn();
    render(<ContactForm onValidityChange={handleValidity} />);

    const nameInput = screen.getByPlaceholderText(/имя/i);
    const phoneInput = screen.getByPlaceholderText(/телефон/i);
    const confirmSelect = screen.getByLabelText(/отправить детали/i);

    fireEvent.change(nameInput, { target: { value: "А" } });
    fireEvent.change(phoneInput, { target: { value: "+79001234567" } });
    fireEvent.change(confirmSelect, { target: { value: "max" } });

    expect(handleValidity).toHaveBeenCalledWith(false);
  });

  it("calls onValidityChange with false when phone has fewer than 10 digits", () => {
    const handleValidity = vi.fn();
    render(<ContactForm onValidityChange={handleValidity} />);

    const nameInput = screen.getByPlaceholderText(/имя/i);
    const phoneInput = screen.getByPlaceholderText(/телефон/i);
    const confirmSelect = screen.getByLabelText(/отправить детали/i);

    fireEvent.change(nameInput, { target: { value: "Анна" } });
    fireEvent.change(phoneInput, { target: { value: "123" } });
    fireEvent.change(confirmSelect, { target: { value: "whatsapp" } });

    expect(handleValidity).toHaveBeenCalledWith(false);
  });

  it("is valid by default since Telegram is pre-selected", () => {
    const handleValidity = vi.fn();
    render(<ContactForm onValidityChange={handleValidity} />);

    const nameInput = screen.getByPlaceholderText(/имя/i);
    const phoneInput = screen.getByPlaceholderText(/телефон/i);

    fireEvent.change(nameInput, { target: { value: "Анна" } });
    fireEvent.change(phoneInput, { target: { value: "+79001234567" } });
    // Telegram is pre-selected, so form should be valid

    expect(handleValidity).toHaveBeenCalledWith(true);
  });

  it("accepts optional comment field", () => {
    render(<ContactForm />);
    const commentInput = screen.getByPlaceholderText(/комментарий/i);
    fireEvent.change(commentInput, { target: { value: "Хочу на утро" } });
    expect(commentInput).toHaveValue("Хочу на утро");
  });

  it("has confirmation options: Telegram, WhatsApp, Max (in that order)", () => {
    render(<ContactForm />);
    const confirmSelect = screen.getByLabelText(/отправить детали/i);
    expect(confirmSelect).toBeInTheDocument();

    // Check options exist and order
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    const values = options.map((o) => o.value);
    expect(values).toEqual(["telegram", "whatsapp", "max"]);
  });

  it("defaults to Telegram as the selected option", () => {
    render(<ContactForm />);
    const confirmSelect = screen.getByLabelText(/отправить детали/i) as HTMLSelectElement;
    expect(confirmSelect.value).toBe("telegram");
  });
});
