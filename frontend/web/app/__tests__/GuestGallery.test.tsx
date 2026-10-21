import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuestGallery } from "../sections/GuestGallery";

/** View-model photos as mapped from PhotoResponse (GH #479):
 * url = allowlisted filename, caption = tag titles joined with " · ". */
const SAMPLE_PHOTOS = [
  { url: "/images/gallery/p1.jpg", caption: "масло · акварель" },
  { url: "/images/gallery/p2.jpg", caption: "акрил" },
  { url: "https://cdn.example.com/p3.jpg", caption: "" },
];

describe("GuestGallery", () => {
  it("renders the section with data-testid=guest-gallery", () => {
    render(<GuestGallery photos={SAMPLE_PHOTOS} />);
    expect(screen.getByTestId("guest-gallery")).toBeInTheDocument();
  });

  it("renders all photos", () => {
    render(<GuestGallery photos={SAMPLE_PHOTOS} />);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(3);
  });

  it("renders tag-based captions as badges on photos", () => {
    render(<GuestGallery photos={SAMPLE_PHOTOS} />);
    expect(screen.getByText("масло · акварель")).toBeInTheDocument();
    expect(screen.getByText("акрил")).toBeInTheDocument();
  });

  it("renders no caption badge for a photo without tags", () => {
    render(<GuestGallery photos={SAMPLE_PHOTOS} />);
    // Only the two tagged photos carry a caption badge.
    const badges = screen.queryAllByTestId("guest-gallery-caption");
    expect(badges).toHaveLength(2);
    expect(badges.map((b) => b.textContent)).toEqual(["масло · акварель", "акрил"]);
  });

  it("does not render the section at all when photos are empty (loading/error/empty rule)", () => {
    render(<GuestGallery photos={[]} />);
    expect(screen.queryByTestId("guest-gallery")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("calls onPhotoClick when a photo is clicked", () => {
    const handleClick = vi.fn();
    render(<GuestGallery photos={SAMPLE_PHOTOS} onPhotoClick={handleClick} />);
    const images = screen.getAllByRole("img");
    fireEvent.click(images[0]);
    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick).toHaveBeenCalledWith(SAMPLE_PHOTOS[0]);
  });

  it("does not crash when onPhotoClick is not provided", () => {
    render(<GuestGallery photos={SAMPLE_PHOTOS} />);
    const images = screen.getAllByRole("img");
    expect(() => fireEvent.click(images[0])).not.toThrow();
  });

  it("photos have correct styling (object-cover, rounded)", () => {
    render(<GuestGallery photos={SAMPLE_PHOTOS} />);
    const images = screen.getAllByRole("img");
    images.forEach((img) => {
      expect(img).toHaveClass("object-cover");
      expect(img).toHaveClass("rounded-lg");
    });
  });
});
