import Image from "next/image";
import { Overlay } from "./Overlay";

export interface LocationDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  photoUrl?: string;
  address: string;
  hours?: string;
  mapUrl?: string;
  directions?: string;
}

export function LocationDetails({
  isOpen,
  onClose,
  name,
  photoUrl,
  address,
  hours,
  mapUrl,
  directions,
}: LocationDetailsProps) {
  return (
    <Overlay isOpen={isOpen} onClose={onClose} size="half">
      <h2 className="text-xl font-semibold text-ink mb-4">Локация</h2>

      {photoUrl && (
        <div className="mb-4 rounded-lg overflow-hidden aspect-video relative">
          <Image
            src={photoUrl}
            alt={name}
            fill
            className="object-cover"
          />
        </div>
      )}

      <h3 className="text-lg font-semibold text-ink mb-3">{name}</h3>

      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <svg
            className="w-5 h-5 text-brand mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <p className="text-ink">{address}</p>
        </div>

        {hours && (
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-brand mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-ink">{hours}</p>
          </div>
        )}
      </div>

      <div
        className="mt-4 rounded-lg h-48 flex items-center justify-center bg-surface"
      >
        <span className="text-ink-light text-sm">Карта</span>
      </div>

      {directions && (
        <div className="mt-4">
          <p className="text-sm text-ink-mid">{directions}</p>
        </div>
      )}
    </Overlay>
  );
}

export default LocationDetails;
