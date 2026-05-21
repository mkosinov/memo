import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuestGallery } from "../sections/GuestGallery";

const SAMPLE_PHOTOS = [
  { url: "/photo1.jpg", technique: "Масло" },
  { url: "/photo2.jpg", technique: "Акварель" },
  { url: "/photo3.jpg", technique: "Гуашь" },
];

describe("GuestGallery", () => {
  it("renders all photos", () => {
    render(<GuestGallery photos={SAMPLE_PHOTOS} />);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(3);
  });

  it("renders technique badges on each photo", () => {
    render(<GuestGallery photos={SAMPLE_PHOTOS} />);
    expect(screen.getByText("Масло")).toBeInTheDocument();
    expect(screen.getByText("Акварель")).toBeInTheDocument();
    expect(screen.getByText("Гуашь")).toBeInTheDocument();
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

  it("renders empty state with no photos", () => {
    render(<GuestGallery photos={[]} />);
    const images = screen.queryAllByRole("img");
    expect(images).toHaveLength(0);
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
