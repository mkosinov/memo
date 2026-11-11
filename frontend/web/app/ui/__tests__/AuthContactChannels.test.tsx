import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthContactChannels } from "../AuthContactChannels";

const MESSAGE = "Здравствуйте! Хочу записаться: МК, 20 мая, 14:00, 2 гостя. Имя: Иван, +79991234567";

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function renderChannels() {
  return render(<AuthContactChannels message={MESSAGE} />);
}

describe("AuthContactChannels — панель «Связаться» (#593 US-4)", () => {
  it("shows the prefilled message text", () => {
    renderChannels();

    const panel = screen.getByTestId("auth-contact-channels");
    expect(panel).toHaveTextContent("МК, 20 мая, 14:00");
    expect(panel).toHaveTextContent("Иван");
    expect(panel).toHaveTextContent("+79991234567");
  });

  it("copies the message text to the clipboard on click", async () => {
    const writeText = stubClipboard();
    renderChannels();

    fireEvent.click(screen.getByRole("button", { name: /Скопировать текст/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MESSAGE));
    expect(await screen.findByText(/Скопировано/i)).toBeInTheDocument();
  });

  it("renders both messenger links with the encoded text when both contacts are set", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_TELEGRAM", "memo_admin");
    vi.stubEnv("NEXT_PUBLIC_CONTACT_WHATSAPP", "79990001122");
    renderChannels();

    const tg = screen.getByRole("link", { name: /Telegram/i });
    expect(tg).toHaveAttribute(
      "href",
      `https://t.me/memo_admin?text=${encodeURIComponent(MESSAGE)}`,
    );
    const wa = screen.getByRole("link", { name: /WhatsApp/i });
    expect(wa).toHaveAttribute(
      "href",
      `https://wa.me/79990001122?text=${encodeURIComponent(MESSAGE)}`,
    );
  });

  it("hides the empty-contact button, keeps the other", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_TELEGRAM", "");
    vi.stubEnv("NEXT_PUBLIC_CONTACT_WHATSAPP", "79990001122");
    renderChannels();

    expect(screen.queryByRole("link", { name: /Telegram/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /WhatsApp/i })).toBeInTheDocument();
  });

  it("both contacts empty → no messenger buttons; the text and copy button remain", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_TELEGRAM", "");
    vi.stubEnv("NEXT_PUBLIC_CONTACT_WHATSAPP", "");
    renderChannels();

    const panel = screen.getByTestId("auth-contact-channels");
    expect(screen.queryByRole("link", { name: /Telegram/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /WhatsApp/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Скопировать текст/i })).toBeInTheDocument();
    expect(panel).toHaveTextContent("МК, 20 мая, 14:00");
  });

  it("messenger links open in a new tab (external chats)", () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_TELEGRAM", "memo_admin");
    vi.stubEnv("NEXT_PUBLIC_CONTACT_WHATSAPP", "79990001122");
    renderChannels();

    expect(screen.getByRole("link", { name: /Telegram/i })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: /WhatsApp/i })).toHaveAttribute(
      "target",
      "_blank",
    );
  });
});
