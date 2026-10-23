import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyRecordCard } from "../MyRecordCard";
import type { MyRecordCardView } from "@/app/lib/model/view/my-records";

/** View-model card as produced by toMyRecordCardView (#513). */
function myRecordCard(overrides: Partial<MyRecordCardView> = {}): MyRecordCardView {
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

describe("MyRecordCard", () => {
  it("renders the card with date, time, service and the card testid", () => {
    render(<MyRecordCard record={myRecordCard()} />);
    const card = screen.getByTestId("my-record-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("my-record-date")).toHaveTextContent("16 июня");
    expect(screen.getByTestId("my-record-time")).toHaveTextContent("15:00–16:00");
    expect(screen.getByTestId("my-record-service")).toHaveTextContent(
      "Мини-картина акрилом",
    );
  });

  it("renders the client's own comment when present", () => {
    render(<MyRecordCard record={myRecordCard({ comment: "Позвать за 15 минут" })} />);
    expect(screen.getByTestId("my-record-comment")).toHaveTextContent(
      "Позвать за 15 минут",
    );
  });

  it("hides the comment block when comment is null", () => {
    render(<MyRecordCard record={myRecordCard({ comment: null })} />);
    expect(screen.queryByTestId("my-record-comment")).not.toBeInTheDocument();
  });

  it("renders visitor rows: name, status (my-visit-status) and price", () => {
    render(<MyRecordCard record={myRecordCard()} />);
    expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
    const status = screen.getByTestId("my-visit-status");
    expect(status).toHaveTextContent("Состоялось");
    expect(screen.getByText("2 000 ₽")).toBeInTheDocument();
  });

  it("renders one row per visitor with individual statuses and prices", () => {
    render(
      <MyRecordCard
        record={myRecordCard({
          visits: [
            {
              id: "vis-1",
              visitorName: "Анна Иванова",
              status: "visited",
              statusLabel: "Состоялось",
              priceFormatted: "3 500 ₽",
            },
            {
              id: "vis-2",
              visitorName: "Софья Иванова",
              status: "waiting",
              statusLabel: "Ожидает",
              priceFormatted: "2 500 ₽",
            },
          ],
        })}
      />,
    );
    const statuses = screen.getAllByTestId("my-visit-status");
    expect(statuses).toHaveLength(2);
    expect(statuses.map((s) => s.textContent)).toEqual(["Состоялось", "Ожидает"]);
    expect(screen.getByText("3 500 ₽")).toBeInTheDocument();
    expect(screen.getByText("2 500 ₽")).toBeInTheDocument();
  });

  it("shows «Посетитель» for an anonymous seat (the view already resolved the label)", () => {
    render(
      <MyRecordCard
        record={myRecordCard({
          visits: [
            {
              id: "vis-anon",
              visitorName: "Посетитель",
              status: "missed",
              statusLabel: "Пропущено",
              priceFormatted: "1 500 ₽",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Посетитель")).toBeInTheDocument();
    expect(screen.getByTestId("my-visit-status")).toHaveTextContent("Пропущено");
  });
});
