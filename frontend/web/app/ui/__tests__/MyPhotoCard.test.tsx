import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyPhotoCard } from "../MyPhotoCard";
import type { MyPhotoCardView } from "@/app/lib/model/view/my-photos";

/** View-model card as produced by toMyPhotoCardView. */
function photo(overrides: Partial<MyPhotoCardView> = {}): MyPhotoCardView {
  return {
    id: "ph-1",
    url: "/images/client-work-1.jpg",
    isPublic: true,
    isPublicLabel: "Опубликовано",
    ...overrides,
  };
}

describe("MyPhotoCard", () => {
  it("renders the photo image by the guest-gallery mechanism (plain img with the allowlisted url)", () => {
    render(<MyPhotoCard photo={photo()} />);

    const img = screen.getByRole("img", { name: "Моё фото" });
    expect(img).toHaveAttribute("src", "/images/client-work-1.jpg");
  });

  it("shows the «Опубликовано» badge for a public photo", () => {
    render(<MyPhotoCard photo={photo()} />);

    expect(screen.getByTestId("my-photo-badge")).toHaveTextContent("Опубликовано");
  });

  it("shows the «Не опубликовано» badge for a NON-public photo", () => {
    render(
      <MyPhotoCard
        photo={photo({
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
    render(<MyPhotoCard photo={photo()} />);

    expect(screen.getByTestId("my-photo-card")).toBeInTheDocument();
  });
});
