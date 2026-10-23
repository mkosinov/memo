import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

// ── Hook mocks: the page is the composition layer (#513); the auth
// wiring is covered by cabinet.test.tsx, the photos data flow by
// useMyPhotos.test.tsx and to-my-photo-vm.test.ts.
vi.mock("../hooks/useCabinetAuth", () => ({
  useCabinetAuth: vi.fn(),
}));
vi.mock("../hooks/useMyPhotos", () => ({
  useMyPhotos: vi.fn(),
}));

import CabinetPhotosPage from "../cabinet/photos/page";
import { useCabinetAuth } from "../hooks/useCabinetAuth";
import { useMyPhotos } from "../hooks/useMyPhotos";
import {
  myPhotoCardView,
  cabinetAuthValue,
  type CabinetSessionStatus,
  mockCabinetListHook,
} from "./fixtures/cabinet";

const mockedUseCabinetAuth = useCabinetAuth as unknown as Mock;
const mockedUseMyPhotos = useMyPhotos as unknown as Mock;

function mockSession(status: CabinetSessionStatus) {
  mockedUseCabinetAuth.mockReturnValue(cabinetAuthValue(status));
}

/** useMyPhotos mock — returns the given state; call args are asserted on
 *  the mock itself. */
function mockPhotos(state: Partial<ReturnType<typeof useMyPhotos>> = {}) {
  return mockCabinetListHook(mockedUseMyPhotos, state);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession("authenticated");
  mockPhotos();
});

// ── Anonymous: login form, no data (spec С5) ───────────────────

describe("Cabinet photos page — anonymous", () => {
  it("shows the phone login form and no section data", async () => {
    mockSession("anonymous");

    render(<CabinetPhotosPage />);

    expect(
      await screen.findByLabelText("Номер телефона"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /войти/i })).toBeInTheDocument();
  });

  it("renders neither the cabinet nav nor photo cards nor session phone", async () => {
    mockSession("anonymous");

    render(<CabinetPhotosPage />);

    await screen.findByLabelText("Номер телефона");
    expect(screen.queryByTestId("cabinet-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("my-photo-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-phone")).not.toBeInTheDocument();
  });

  it("never requests photos while anonymous (enabled=false)", async () => {
    mockSession("anonymous");

    render(<CabinetPhotosPage />);

    await screen.findByLabelText("Номер телефона");
    expect(mockedUseMyPhotos).toHaveBeenCalledWith(1, false);
  });
});

// ── Session check in flight ────────────────────────────────────

describe("Cabinet photos page — checking", () => {
  it("shows the loader while the session is being checked", () => {
    mockSession("checking");

    render(<CabinetPhotosPage />);

    expect(screen.getByTestId("cabinet-checking")).toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-nav")).not.toBeInTheDocument();
  });
});

// ── Authenticated: nav + phone + photo grid (spec С3) ──────────

describe("Cabinet photos page — authenticated", () => {
  it("shows the section nav with «Мои фото» active and the session phone", async () => {
    render(<CabinetPhotosPage />);

    const nav = screen.getByTestId("cabinet-nav");
    expect(nav).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Мои фото" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("cabinet-phone")).toHaveTextContent("+79001234567");
    expect(screen.getByRole("button", { name: /выйти/i })).toBeInTheDocument();
  });

  it("renders the photo grid with both badge kinds", async () => {
    mockPhotos({
      cards: [
        myPhotoCardView(),
        myPhotoCardView({ id: "ph-2", url: "/images/client-work-2.jpg" }),
        myPhotoCardView({
          id: "ph-priv",
          url: "/images/cabinet-draft.jpg",
          isPublic: false,
          isPublicLabel: "Не опубликовано",
        }),
      ],
      total: 3,
      pageCount: 1,
    });

    render(<CabinetPhotosPage />);

    const cards = await screen.findAllByTestId("my-photo-card");
    expect(cards).toHaveLength(3);

    const badges = screen.getAllByTestId("my-photo-badge");
    expect(badges).toHaveLength(3);
    expect(
      badges.filter((badge) => badge.textContent === "Опубликовано"),
    ).toHaveLength(2);
    expect(
      badges.filter((badge) => badge.textContent === "Не опубликовано"),
    ).toHaveLength(1);

    const imgs = screen.getAllByRole("img", { name: "Моё фото" });
    expect(imgs[2]).toHaveAttribute("src", "/images/cabinet-draft.jpg");
  });

  it("shows the loader while photos are pending", () => {
    mockPhotos({ isPending: true });

    render(<CabinetPhotosPage />);

    expect(screen.getByTestId("my-photos-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("my-photo-card")).not.toBeInTheDocument();
  });

  it("shows an error message when the photos request fails", () => {
    mockPhotos({ error: new Error("network down") });

    render(<CabinetPhotosPage />);

    expect(screen.getByTestId("my-photos-error")).toBeInTheDocument();
    expect(screen.queryByTestId("my-photo-card")).not.toBeInTheDocument();
  });
});

// ── Empty state + pagination (component-level DoD) ─────────────

describe("Cabinet photos page — empty state and pagination", () => {
  it("shows «У вас пока нет фото» when the client has no photos", () => {
    mockPhotos({ cards: [], total: 0, pageCount: 1 });

    render(<CabinetPhotosPage />);

    expect(screen.getByTestId("my-photos-empty")).toBeInTheDocument();
    expect(screen.getByText("У вас пока нет фото")).toBeInTheDocument();
    expect(screen.queryByTestId("list-pagination")).not.toBeInTheDocument();
  });

  it("renders pagination when the list spills past one page and switches pages", async () => {
    mockPhotos({ cards: [myPhotoCardView()], total: 45, page: 1, pageCount: 3 });

    render(<CabinetPhotosPage />);

    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
    expect(screen.getByTestId("list-pagination-info")).toHaveTextContent(
      "Страница 1 из 3",
    );

    fireEvent.click(screen.getByRole("button", { name: "Вперёд" }));

    await waitFor(() =>
      expect(mockedUseMyPhotos).toHaveBeenLastCalledWith(2, true),
    );
  });
});
