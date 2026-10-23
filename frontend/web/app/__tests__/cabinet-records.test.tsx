import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

// ── Hook mocks: the page is the composition layer (#513); the auth
// wiring is covered by cabinet.test.tsx (through the /cabinet page), the
// records data flow by useMyRecords.test.tsx and to-my-record-vm.test.ts.
vi.mock("../hooks/useCabinetAuth", () => ({
  useCabinetAuth: vi.fn(),
}));
vi.mock("../hooks/useMyRecords", () => ({
  useMyRecords: vi.fn(),
}));

import CabinetRecordsPage from "../cabinet/records/page";
import { useCabinetAuth } from "../hooks/useCabinetAuth";
import { useMyRecords } from "../hooks/useMyRecords";
import type { MyRecordCardView } from "../lib/model/view/my-records";

const mockedUseCabinetAuth = useCabinetAuth as unknown as Mock;
const mockedUseMyRecords = useMyRecords as unknown as Mock;

const CLIENT = { phone: "+79001234567", name: "Анна Иванова" };

/** View-model card as produced by toMyRecordCardView. */
function card(overrides: Partial<MyRecordCardView> = {}): MyRecordCardView {
  return {
    id: "rec-1",
    dateFormatted: "16 июня",
    timeFormatted: "15:00–16:00",
    serviceTitle: "Мини-картина акрилом",
    comment: null,
    visits: [
      {
        id: "vis-1",
        visitorName: "Анна Иванова",
        status: "visited",
        statusLabel: "Состоялось",
        priceFormatted: "2 000 ₽",
      },
    ],
    ...overrides,
  };
}

function mockSession(status: "checking" | "anonymous" | "authenticated" | "error") {
  mockedUseCabinetAuth.mockReturnValue({
    session: { status, client: status === "authenticated" ? CLIENT : null, refresh: vi.fn() },
    handleLogout: vi.fn(),
  });
}

/** useMyRecords mock — captures (page, enabled) args, returns given state. */
function mockRecords(state: Partial<ReturnType<typeof useMyRecords>> = {}) {
  return mockedUseMyRecords.mockImplementation(
    (...args: Parameters<typeof useMyRecords>) => ({
      cards: [],
      total: 0,
      page: 1,
      pageCount: 1,
      isPending: false,
      error: null,
      ...state,
      lastArgs: args,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession("authenticated");
  mockRecords();
});

// ── Anonymous: login form, no data (spec С5) ───────────────────

describe("Cabinet records page — anonymous", () => {
  it("shows the phone login form and no section data", async () => {
    mockSession("anonymous");

    render(<CabinetRecordsPage />);

    expect(
      await screen.findByLabelText("Номер телефона"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /войти/i })).toBeInTheDocument();
  });

  it("renders neither the cabinet nav nor record cards nor session phone", async () => {
    mockSession("anonymous");

    render(<CabinetRecordsPage />);

    await screen.findByLabelText("Номер телефона");
    expect(screen.queryByTestId("cabinet-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("my-record-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-phone")).not.toBeInTheDocument();
  });

  it("never requests records while anonymous (enabled=false)", async () => {
    mockSession("anonymous");

    render(<CabinetRecordsPage />);

    await screen.findByLabelText("Номер телефона");
    expect(mockedUseMyRecords).toHaveBeenCalledWith(1, false);
  });
});

// ── Session check in flight ────────────────────────────────────

describe("Cabinet records page — checking", () => {
  it("shows the loader while the session is being checked", () => {
    mockSession("checking");

    render(<CabinetRecordsPage />);

    expect(screen.getByTestId("cabinet-checking")).toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-nav")).not.toBeInTheDocument();
  });
});

// ── Authenticated: nav + phone + cards (spec С1) ───────────────

describe("Cabinet records page — authenticated", () => {
  it("shows the section nav with «Мои записи» active and the session phone", async () => {
    render(<CabinetRecordsPage />);

    const nav = screen.getByTestId("cabinet-nav");
    expect(nav).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Мои записи" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("cabinet-phone")).toHaveTextContent("+79001234567");
    expect(screen.getByRole("button", { name: /выйти/i })).toBeInTheDocument();
  });

  it("renders the lesson cards with all fields and the visitor rows", async () => {
    mockRecords({
      cards: [
        card({ comment: "Позвать за 15 минут" }),
        card({
          id: "rec-2",
          dateFormatted: "15 июня",
          timeFormatted: "10:00–12:00",
          serviceTitle: "Морской пейзаж",
          visits: [
            {
              id: "vis-a",
              visitorName: "Анна Иванова",
              status: "visited",
              statusLabel: "Состоялось",
              priceFormatted: "3 500 ₽",
            },
            {
              id: "vis-b",
              visitorName: "Софья Иванова",
              status: "visited",
              statusLabel: "Состоялось",
              priceFormatted: "2 500 ₽",
            },
          ],
        }),
      ],
      total: 2,
      pageCount: 1,
    });

    render(<CabinetRecordsPage />);

    const cards = await screen.findAllByTestId("my-record-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByTestId("my-record-comment")).toHaveTextContent(
      "Позвать за 15 минут",
    );
    const statuses = screen.getAllByTestId("my-visit-status");
    expect(statuses).toHaveLength(3);
    expect(screen.getByText("Софья Иванова")).toBeInTheDocument();
    expect(screen.getByText("3 500 ₽")).toBeInTheDocument();
  });

  it("shows the loader while records are pending", () => {
    mockRecords({ isPending: true });

    render(<CabinetRecordsPage />);

    expect(screen.getByTestId("my-records-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("my-record-card")).not.toBeInTheDocument();
  });

  it("shows an error message when the records request fails", () => {
    mockRecords({ error: new Error("network down") });

    render(<CabinetRecordsPage />);

    expect(screen.getByTestId("my-records-error")).toBeInTheDocument();
    expect(screen.queryByTestId("my-record-card")).not.toBeInTheDocument();
  });
});

// ── Empty state + pagination (component-level DoD) ─────────────

describe("Cabinet records page — empty state and pagination", () => {
  it("shows «У вас пока нет записей» with a link to the booking page when empty", () => {
    mockRecords({ cards: [], total: 0, pageCount: 1 });

    render(<CabinetRecordsPage />);

    expect(screen.getByTestId("my-records-empty")).toBeInTheDocument();
    expect(screen.getByText("У вас пока нет записей")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /бронирован/i });
    expect(link).toHaveAttribute("href", "/");
    expect(screen.queryByTestId("list-pagination")).not.toBeInTheDocument();
  });

  it("renders pagination when the list spills past one page and switches pages", async () => {
    mockRecords({ cards: [card()], total: 45, page: 1, pageCount: 3 });

    render(<CabinetRecordsPage />);

    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
    expect(screen.getByTestId("list-pagination-info")).toHaveTextContent(
      "Страница 1 из 3",
    );

    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));

    await waitFor(() =>
      expect(mockedUseMyRecords).toHaveBeenLastCalledWith(2, true),
    );
  });
});
