export interface GuestPhoto {
  url: string;
  /** Tag titles joined with " · "; empty when the photo has no tags. */
  caption: string;
}

export interface GuestGalleryProps {
  photos: GuestPhoto[];
  onPhotoClick?: (photo: GuestPhoto) => void;
}

/** Uniform no-data rule (GH #479): loading, a failed fetch and an empty result
 * all arrive as an empty photo list — the section is then not rendered at all. */
export function GuestGallery({ photos, onPhotoClick }: GuestGalleryProps) {
  if (photos.length === 0) return null;

  return (
    <section className="py-1 px-4" data-testid="guest-gallery">
      <div className="flex gap-3 overflow-x-auto no-scrollbar">
        {photos.map((photo, index) => (
          <div
            key={index}
            className="relative w-32 h-32 flex-shrink-0 rounded-lg overflow-hidden cursor-pointer"
            onClick={() => onPhotoClick?.(photo)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPhotoClick?.(photo);
              }
            }}
          >
            <img
              src={photo.url}
              alt={photo.caption ? `Guest photo — ${photo.caption}` : "Guest photo"}
              className="w-full h-full object-cover rounded-lg"
            />
            {photo.caption && (
              <span
                data-testid="guest-gallery-caption"
                className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full"
              >
                {photo.caption}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default GuestGallery;
