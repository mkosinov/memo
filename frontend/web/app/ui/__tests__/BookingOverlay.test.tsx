import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import type { ActivityView } from "../../lib/model/view/activity";
import { BookingActivityOverlay } from "../BookingActivityOverlay";

// ── Mock the client-branch API (#499): session detection, OTP, booking ──────
vi.mock("@memo/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    getMyClient: vi.fn(),
    requestOtpCode: vi.fn(),
    verifyOtpCode: vi.fn(),
    createMyRecord: vi.fn(),
  };
});

import {
  getMyClient,
  requestOtpCode,
  verifyOtpCode,
  createMyRecord,
  ApiError,
} from "@memo/api-client";

const mockedGetMyClient = getMyClient as unknown as Mock;
const mockedRequestOtpCode = requestOtpCode as unknown as Mock;
const mockedVerifyOtpCode = verifyOtpCode as unknown as Mock;
const mockedCreateMyRecord = createMyRecord as unknown as Mock;

const createdResponse = {
  id: "rec-1",
  activity_id: "act-1",
  start: "2026-05-20T14:00:00",
  comment: null,
  visits: [{ name: null, age: null, tariff_id: "tariff-adult", price: 1500 }],
};

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

beforeEach(() => {
  mockedGetMyClient.mockReset();
  mockedRequestOtpCode.mockReset();
  mockedVerifyOtpCode.mockReset();
  mockedCreateMyRecord.mockReset();
  // Default: no client session — the OTP step path.
  mockedGetMyClient.mockRejectedValue(new ApiError(401, "unauthorized"));
  mockedRequestOtpCode.mockResolvedValue({});
  mockedVerifyOtpCode.mockResolvedValue({ phone: "+79991234567", name: null });
  mockedCreateMyRecord.mockResolvedValue(createdResponse);
});

/** Fill a valid contact form; pass phone=null to skip the session-owned field. */
function fillContactForm(name = "Иван", phone: string | null = "+79991234567") {
  fireEvent.change(screen.getByLabelText("Имя"), { target: { value: name } });
  if (phone !== null) {
    fireEvent.change(screen.getByLabelText("Телефон"), { target: { value: phone } });
  }
}

/** Wait for the session check to settle, then click «Записаться». */
async function clickSubmit() {
  const submitBtn = await screen.findByRole("button", { name: /Записаться/i });
  await waitFor(() => expect(submitBtn).not.toBeDisabled());
  fireEvent.click(submitBtn);
  return submitBtn;
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

  it("shows the booking-success screen after a 201 (authenticated client)", async () => {
    mockedGetMyClient.mockResolvedValue({ phone: "+79990001122", name: "Анна" });
    renderOverlay();

    await screen.findByDisplayValue("+79990001122");
    fillContactForm("Иван", null);
    increaseTariffSeats("tariff-counter-tariff-adult", 1);

    await clickSubmit();

    expect(await screen.findByTestId("booking-success")).toBeInTheDocument();
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

describe("BookingActivityOverlay — OTP step for anonymous submit (US-1)", () => {
  it("shows the confirm-phone step instead of creating a record", async () => {
    renderOverlay();

    fillContactForm();
    increaseTariffSeats("tariff-counter-tariff-adult", 1);
    await clickSubmit();

    expect(screen.getByText("Подтвердите телефон")).toBeInTheDocument();
    expect(screen.getByText("+79991234567")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Отправить код/i })).toBeInTheDocument();
    expect(mockedCreateMyRecord).not.toHaveBeenCalled();
  });

  it("full anonymous flow: code → verify → automatic re-submission with the exact payload → success", async () => {
    renderOverlay();

    fillContactForm("Иван", "+79991234567");
    fireEvent.change(screen.getByLabelText(/Комментарий/i), {
      target: { value: "Нужен стул для ребёнка" },
    });
    increaseTariffSeats("tariff-counter-tariff-adult", 2);
    increaseTariffSeats("tariff-counter-tariff-kid", 1);
    // Names for the first adult seat only; the rest stay anonymous.
    fireEvent.click(screen.getByRole("button", { name: /Указать имена посетителей/i }));
    fireEvent.change(screen.getAllByLabelText("Имя посетителя")[0], {
      target: { value: "Иван" },
    });
    fireEvent.change(screen.getAllByLabelText("Возраст посетителя")[0], {
      target: { value: "9" },
    });

    await clickSubmit();

    // Step 1: request the code for the form phone.
    fireEvent.click(screen.getByRole("button", { name: /Отправить код/i }));
    await waitFor(() =>
      expect(mockedRequestOtpCode).toHaveBeenCalledWith("+79991234567"),
    );

    // Step 2: enter the code and confirm.
    fireEvent.change(await screen.findByTestId("otp-code-input"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));
    await waitFor(() =>
      expect(mockedVerifyOtpCode).toHaveBeenCalledWith("+79991234567", "123456"),
    );

    // Step 3: automatic re-submission — no extra click.
    await waitFor(() => expect(mockedCreateMyRecord).toHaveBeenCalledTimes(1));
    expect(mockedCreateMyRecord).toHaveBeenCalledWith({
      activity_id: "act-1",
      phone: "+79991234567",
      comment: "Нужен стул для ребёнка",
      visits: [
        { name: "Иван", age: 9, tariff_id: "tariff-adult" },
        { name: null, age: null, tariff_id: "tariff-adult" },
        { name: null, age: null, tariff_id: "tariff-kid" },
      ],
    });

    expect(await screen.findByTestId("booking-success")).toBeInTheDocument();
  });

  it("shows the dev-transport code in the step when the API echoes it", async () => {
    mockedRequestOtpCode.mockResolvedValue({ dev_code: "654321" });
    renderOverlay();

    fillContactForm();
    increaseTariffSeats("tariff-counter-tariff-adult", 1);
    await clickSubmit();

    fireEvent.click(screen.getByRole("button", { name: /Отправить код/i }));
    expect(await screen.findByText(/654321/)).toBeInTheDocument();
  });
});

describe("BookingActivityOverlay — OTP step errors (US-4)", () => {
  async function openStep() {
    renderOverlay();
    fillContactForm();
    increaseTariffSeats("tariff-counter-tariff-adult", 1);
    await clickSubmit();
    fireEvent.click(screen.getByRole("button", { name: /Отправить код/i }));
    await screen.findByTestId("otp-code-input");
  }

  it("keeps a wrong/expired code error inside the step and creates no record", async () => {
    mockedVerifyOtpCode.mockRejectedValue(
      new ApiError(401, "Неверный код", "AUTH_INVALID_OTP"),
    );
    await openStep();

    fireEvent.change(screen.getByTestId("otp-code-input"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));

    const errorBlock = await screen.findByTestId("otp-step-error");
    expect(errorBlock).toHaveTextContent("Неверный код");
    // The step stays: the input is still there for a corrected code.
    expect(screen.getByTestId("otp-code-input")).toBeInTheDocument();
    expect(mockedCreateMyRecord).not.toHaveBeenCalled();
  });

  it("recovers from a wrong code and still auto-submits", async () => {
    mockedVerifyOtpCode
      .mockRejectedValueOnce(new ApiError(401, "Неверный код", "AUTH_INVALID_OTP"))
      .mockResolvedValue({ phone: "+79991234567", name: null });
    await openStep();

    const input = screen.getByTestId("otp-code-input");
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));
    await screen.findByTestId("otp-step-error");

    fireEvent.change(screen.getByTestId("otp-code-input"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));

    await waitFor(() => expect(mockedCreateMyRecord).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("booking-success")).toBeInTheDocument();
  });

  it("shows «Вход временно недоступен» when the transport is down (503)", async () => {
    mockedRequestOtpCode.mockRejectedValue(
      new ApiError(503, "notify transport unavailable", "NOTIFY_TRANSPORT_UNAVAILABLE"),
    );
    renderOverlay();

    fillContactForm();
    increaseTariffSeats("tariff-counter-tariff-adult", 1);
    await clickSubmit();
    fireEvent.click(screen.getByRole("button", { name: /Отправить код/i }));

    const errorBlock = await screen.findByTestId("otp-step-error");
    expect(errorBlock).toHaveTextContent("Вход временно недоступен");
    expect(mockedCreateMyRecord).not.toHaveBeenCalled();
  });
});

describe("BookingActivityOverlay — authenticated client", () => {
  it("prefills the phone from the session and locks it readonly", async () => {
    mockedGetMyClient.mockResolvedValue({ phone: "+79990001122", name: "Анна" });
    renderOverlay();

    const phoneInput = await screen.findByLabelText("Телефон");
    expect(phoneInput).toHaveValue("+79990001122");
    expect(phoneInput).toHaveAttribute("readonly");
  });

  it("submits directly without the OTP step", async () => {
    mockedGetMyClient.mockResolvedValue({ phone: "+79990001122", name: null });
    renderOverlay();

    await screen.findByDisplayValue("+79990001122");
    fillContactForm("Иван", null);
    increaseTariffSeats("tariff-counter-tariff-kid", 1);
    await clickSubmit();

    await waitFor(() => expect(mockedCreateMyRecord).toHaveBeenCalledTimes(1));
    expect(mockedCreateMyRecord).toHaveBeenCalledWith({
      activity_id: "act-1",
      // The session phone rides the wire, not whatever was typed before prefill.
      phone: "+79990001122",
      comment: null,
      visits: [{ name: null, age: null, tariff_id: "tariff-kid" }],
    });
    expect(mockedRequestOtpCode).not.toHaveBeenCalled();
    expect(await screen.findByTestId("booking-success")).toBeInTheDocument();
  });
});

describe("BookingActivityOverlay — booking refusal and retry (US-3)", () => {
  async function submitExpectingRefusal() {
    renderOverlay();
    fillContactForm();
    increaseTariffSeats("tariff-counter-tariff-adult", 1);
    await clickSubmit();

    // Anonymous: walk through the OTP step first.
    fireEvent.click(screen.getByRole("button", { name: /Отправить код/i }));
    fireEvent.change(await screen.findByTestId("otp-code-input"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));

    return await screen.findByTestId("booking-error");
  }

  it("renders the server message with a retry button; a retry resubmits and can succeed", async () => {
    mockedCreateMyRecord
      .mockRejectedValueOnce(new ApiError(409, "Недостаточно мест", "ACTIVITY_AT_CAPACITY"))
      .mockResolvedValue(createdResponse);

    const errorBlock = await submitExpectingRefusal();
    expect(errorBlock).toHaveTextContent("Недостаточно мест");
    expect(mockedCreateMyRecord).toHaveBeenCalledTimes(1);

    fireEvent.click(within(errorBlock).getByRole("button", { name: /Отправить еще раз/i }));

    await waitFor(() => expect(mockedCreateMyRecord).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("booking-success")).toBeInTheDocument();
  });

  it("clears the stale booking-error on overlay reopen — no leaked block, no dead retry", async () => {
    // The verify in this flow establishes the session: the first session check
    // is anonymous, every later one (post-verify refresh, reopen) is authenticated.
    mockedGetMyClient.mockReset();
    mockedGetMyClient.mockRejectedValueOnce(new ApiError(401, "unauthorized"));
    mockedGetMyClient.mockResolvedValue({ phone: "+79991234567", name: null });
    mockedCreateMyRecord.mockRejectedValue(
      new ApiError(409, "Недостаточно мест", "ACTIVITY_AT_CAPACITY"),
    );

    const { rerender } = renderOverlay();
    fillContactForm();
    increaseTariffSeats("tariff-counter-tariff-adult", 1);
    await clickSubmit();

    // Anonymous: walk through the OTP step to the refusal.
    fireEvent.click(screen.getByRole("button", { name: /Отправить код/i }));
    fireEvent.change(await screen.findByTestId("otp-code-input"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Подтвердить/i }));
    expect(await screen.findByTestId("booking-error")).toBeInTheDocument();
    // Snapshot AFTER the walkthrough's own code request.
    const otpCallsAfterWalkthrough = mockedRequestOtpCode.mock.calls.length;

    // Close and reopen the overlay (it stays mounted in the page tree).
    rerender(
      <BookingActivityOverlay
        isOpen={false}
        onClose={vi.fn()}
        activityId="act-1"
        activities={[mockActivity, mockActivityNoTariffs]}
      />,
    );
    rerender(
      <BookingActivityOverlay
        isOpen
        onClose={vi.fn()}
        activityId="act-1"
        activities={[mockActivity, mockActivityNoTariffs]}
      />,
    );

    // No stale error block after reopen…
    expect(screen.queryByTestId("booking-error")).not.toBeInTheDocument();

    // …and a fresh submit reaches the API again — directly, session reused.
    mockedCreateMyRecord.mockResolvedValue(createdResponse);
    await clickSubmit();
    await waitFor(() => expect(mockedCreateMyRecord).toHaveBeenCalledTimes(2));
    expect(mockedRequestOtpCode.mock.calls.length).toBe(otpCallsAfterWalkthrough);
    expect(await screen.findByTestId("booking-success")).toBeInTheDocument();
  });

  it("falls back to a connection hint on network failure", async () => {
    mockedCreateMyRecord.mockRejectedValue(new TypeError("fetch failed"));

    const errorBlock = await submitExpectingRefusal();
    expect(errorBlock).toHaveTextContent(
      "Не удалось отправить запись. Проверьте соединение и попробуйте еще раз",
    );
  });
});
