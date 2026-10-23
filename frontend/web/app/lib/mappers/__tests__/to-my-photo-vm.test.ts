import { toMyPhotoCardView } from "../to-my-photo-vm";
import type { MyPhotoItem } from "@memo/api-client";

/** Contract row factory — the exact GET /my/photos items[] shape (#513):
 *  no owner ids (the requester IS the client), tags resolved to names. */
function myPhotoItem(overrides: Partial<MyPhotoItem> = {}): MyPhotoItem {
  return {
    id: "ph-1",
    filename: "/images/client-work-1.jpg",
    is_public: true,
    tags: ["масло"],
    created_at: "2026-06-15T12:00:00",
    ...overrides,
  };
}

describe("toMyPhotoCardView (GET /my/photos item → «Мои фото» card view)", () => {
  it("maps a public photo: url verbatim, isPublic true, label «Опубликовано»", () => {
    const vm = toMyPhotoCardView(myPhotoItem());

    expect(vm).toEqual({
      id: "ph-1",
      url: "/images/client-work-1.jpg",
      isPublic: true,
      isPublicLabel: "Опубликовано",
    });
  });

  it("maps a NON-public photo with the label «Не опубликовано»", () => {
    const vm = toMyPhotoCardView(
      myPhotoItem({ id: "ph-private", filename: "/images/cabinet-draft.jpg", is_public: false }),
    );

    expect(vm).toEqual({
      id: "ph-private",
      url: "/images/cabinet-draft.jpg",
      isPublic: false,
      isPublicLabel: "Не опубликовано",
    });
  });

  it("keeps the url allowlist of the guest gallery (the same render mechanism): a foreign scheme is dropped", () => {
    expect(toMyPhotoCardView(myPhotoItem({ filename: "javascript:alert(1)" }))).toBeNull();
  });

  it("drops an empty filename", () => {
    expect(toMyPhotoCardView(myPhotoItem({ filename: "" }))).toBeNull();
  });

  it("keeps a full http(s) url (allowlist passes external https)", () => {
    const vm = toMyPhotoCardView(
      myPhotoItem({ filename: "https://cdn.example.com/work.jpg" }),
    );

    expect(vm?.url).toBe("https://cdn.example.com/work.jpg");
  });
});
