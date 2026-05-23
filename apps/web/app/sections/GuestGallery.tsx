export interface GuestPhoto {
  url: string;
  technique: string;
}

export interface GuestGalleryProps {
  photos: GuestPhoto[];
  onPhotoClick?: (photo: GuestPhoto) => void;
}

export function GuestGallery({ photos, onPhotoClick }: GuestGalleryProps) {
  return (
    <section className="py-1 px-4">
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
              alt={`Guest photo — ${photo.technique}`}
              className="w-full h-full object-cover rounded-lg"
            />
            <span className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
              {photo.technique}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default GuestGallery;
