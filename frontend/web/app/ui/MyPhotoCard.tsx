import type { MyPhotoCardView } from "@/app/lib/model/view/my-photos";

export interface MyPhotoCardProps {
  photo: MyPhotoCardView;
}

/** Badge tint per publication state (#513) — the label text comes
 * pre-translated from the view model; this only picks the color. */
const badgeColorClass = (isPublic: boolean): string =>
  isPublic ? "text-[#3e6b58]" : "text-ink-mid";

/** One photo card on «Мои фото» (#513): the image renders by the SAME
 * mechanism as the guest gallery (a plain <img> with the allowlisted
 * filename — static file serving; is_public filters only lists, never
 * bytes), with the publication badge (my-photo-card is pinned by the
 * Visual Compliance Checks). */
export function MyPhotoCard({ photo }: MyPhotoCardProps) {
  return (
    <li
      data-testid="my-photo-card"
      className="relative overflow-hidden rounded-2xl border border-line bg-white shadow-[0_2px_16px_rgba(0,0,0,.05)]"
    >
      <img
        src={photo.url}
        alt="Моё фото"
        className="aspect-square w-full object-cover"
      />
      <span
        data-testid="my-photo-badge"
        className={[
          "absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-medium backdrop-blur",
          badgeColorClass(photo.isPublic),
        ].join(" ")}
      >
        {photo.isPublicLabel}
      </span>
    </li>
  );
}

export default MyPhotoCard;
