import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyPhotoCard } from "../MyPhotoCard";
import { myPhotoCardView } from "@/app/__tests__/fixtures/cabinet";

describe("MyPhotoCard", () => {
  it("renders the photo image by the guest-gallery mechanism (plain img with the allowlisted url)", () => {
    render(<MyPhotoCard photo={myPhotoCardView()} />);

    const img = screen.getByRole("img", { name: "Моё фото" });
    expect(img).toHaveAttribute("src", "/images/client-work-1.jpg");
  });

  it("shows the «Опубликовано» badge for a public photo", () => {
    render(<MyPhotoCard photo={myPhotoCardView()} />);

    expect(screen.getByTestId("my-photo-badge")).toHaveTextContent("Опубликовано");
  });

  it("shows the «Не опубликовано» badge for a NON-public photo", () => {
    render(
      <MyPhotoCard
        photo={myPhotoCardView({
          id: "ph-priv",
          url: "/images/cabinet-draft.jpg",
          isPublic: false,
          isPublicLabel: "Не опубликовано",
        })}
      />,
    );

    expect(screen.getByTestId("my-photo-badge")).toHaveTextContent("Не опубликовано");
  });

  it("carries the my-photo-card testid pinned by the Visual Compliance Checks", () => {
    render(<MyPhotoCard photo={myPhotoCardView()} />);

    expect(screen.getByTestId("my-photo-card")).toBeInTheDocument();
  });
});
