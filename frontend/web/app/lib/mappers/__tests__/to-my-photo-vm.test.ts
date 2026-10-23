import { toMyPhotoCardView } from "../to-my-photo-vm";
import { myPhotoItem } from "@/app/__tests__/fixtures/cabinet";

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
