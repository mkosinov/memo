import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

// ── Hook mocks: the page is the composition layer (#513); the auth
// wiring is covered by cabinet.test.tsx, the payments data flow by
// useMyPayments.test.tsx and to-my-payment-vm.test.ts.
vi.mock("../hooks/useCabinetAuth", () => ({
  useCabinetAuth: vi.fn(),
}));
vi.mock("../hooks/useMyPayments", () => ({
  useMyPayments: vi.fn(),
}));

import CabinetPaymentsPage from "../cabinet/payments/page";
import { useCabinetAuth } from "../hooks/useCabinetAuth";
import { useMyPayments } from "../hooks/useMyPayments";
import {
  myPaymentRowView,
  cabinetAuthValue,
  type CabinetSessionStatus,
  mockCabinetListHook,
} from "./fixtures/cabinet";

const mockedUseCabinetAuth = useCabinetAuth as unknown as Mock;
const mockedUseMyPayments = useMyPayments as unknown as Mock;

function mockSession(status: CabinetSessionStatus) {
  mockedUseCabinetAuth.mockReturnValue(cabinetAuthValue(status));
}

/** useMyPayments mock — returns the given state; call args are asserted on
 *  the mock itself. */
function mockPayments(state: Partial<ReturnType<typeof useMyPayments>> = {}) {
  return mockCabinetListHook(mockedUseMyPayments, state);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession("authenticated");
  mockPayments();
});

// ── Anonymous: login form, no data (spec С5) ───────────────────

describe("Cabinet payments page — anonymous", () => {
  it("shows the phone login form and no section data", async () => {
    mockSession("anonymous");

    render(<CabinetPaymentsPage />);

    expect(
      await screen.findByLabelText("Номер телефона"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /войти/i })).toBeInTheDocument();
  });

  it("renders neither the cabinet nav nor payment rows nor session phone", async () => {
    mockSession("anonymous");

    render(<CabinetPaymentsPage />);

    await screen.findByLabelText("Номер телефона");
    expect(screen.queryByTestId("cabinet-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("my-payment-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-phone")).not.toBeInTheDocument();
  });

  it("never requests payments while anonymous (enabled=false)", async () => {
    mockSession("anonymous");

    render(<CabinetPaymentsPage />);

    await screen.findByLabelText("Номер телефона");
    expect(mockedUseMyPayments).toHaveBeenCalledWith(1, false);
  });
});

// ── Session check in flight ────────────────────────────────────

describe("Cabinet payments page — checking", () => {
  it("shows the loader while the session is being checked", () => {
    mockSession("checking");

    render(<CabinetPaymentsPage />);

    expect(screen.getByTestId("cabinet-checking")).toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-nav")).not.toBeInTheDocument();
  });
});

// ── Authenticated: nav + phone + rows (spec С4) ────────────────

describe("Cabinet payments page — authenticated", () => {
  it("shows the section nav with «Мои платежи» active and the session phone", async () => {
    render(<CabinetPaymentsPage />);

    const nav = screen.getByTestId("cabinet-nav");
    expect(nav).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Мои платежи" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("cabinet-phone")).toHaveTextContent("+79001234567");
    expect(screen.getByRole("button", { name: /выйти/i })).toBeInTheDocument();
  });

  it("renders the payment rows with amount, method labels (incl. null), date and lesson context", async () => {
    mockPayments({
      rows: [
        myPaymentRowView(),
        myPaymentRowView({
          id: "pay-cash",
          amountFormatted: "2 000 ₽",
          methodLabel: "Наличные",
          dateFormatted: "15 июня",
          serviceTitle: "Морской пейзаж",
          lessonDateFormatted: "15 июня",
        }),
        myPaymentRowView({
          id: "pay-null",
          amountFormatted: "4 800 ₽",
          methodLabel: "Способ не указан",
        }),
      ],
      total: 3,
      pageCount: 1,
    });

    render(<CabinetPaymentsPage />);

    const rows = await screen.findAllByTestId("my-payment-row");
    expect(rows).toHaveLength(3);

    const methods = screen.getAllByTestId("my-payment-method");
    expect(
      methods.map((badge) => badge.textContent),
    ).toEqual(["Карта", "Наличные", "Способ не указан"]);
    expect(screen.getAllByTestId("my-payment-amount").map((a) => a.textContent)).toEqual([
      "6 000 ₽",
      "2 000 ₽",
      "4 800 ₽",
    ]);
    const lesson = screen.getAllByTestId("my-payment-lesson");
    expect(lesson[1]).toHaveTextContent("Морской пейзаж, 15 июня");
  });

  it("shows the loader while payments are pending", () => {
    mockPayments({ isPending: true });

    render(<CabinetPaymentsPage />);

    expect(screen.getByTestId("my-payments-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("my-payment-row")).not.toBeInTheDocument();
  });

  it("shows an error message when the payments request fails", () => {
    mockPayments({ error: new Error("network down") });

    render(<CabinetPaymentsPage />);

    expect(screen.getByTestId("my-payments-error")).toBeInTheDocument();
    expect(screen.queryByTestId("my-payment-row")).not.toBeInTheDocument();
  });
});

// ── Empty state + pagination (component-level DoD) ─────────────

describe("Cabinet payments page — empty state and pagination", () => {
  it("shows «У вас пока нет платежей» when the client has no payments", () => {
    mockPayments({ rows: [], total: 0, pageCount: 1 });

    render(<CabinetPaymentsPage />);

    expect(screen.getByTestId("my-payments-empty")).toBeInTheDocument();
    expect(screen.getByText("У вас пока нет платежей")).toBeInTheDocument();
    expect(screen.queryByTestId("list-pagination")).not.toBeInTheDocument();
  });

  it("renders pagination when the list spills past one page and switches pages", async () => {
    mockPayments({ rows: [myPaymentRowView()], total: 45, page: 1, pageCount: 3 });

    render(<CabinetPaymentsPage />);

    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
    expect(screen.getByTestId("list-pagination-info")).toHaveTextContent(
      "Страница 1 из 3",
    );

    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));

    await waitFor(() =>
      expect(mockedUseMyPayments).toHaveBeenLastCalledWith(2, true),
    );
  });
});
