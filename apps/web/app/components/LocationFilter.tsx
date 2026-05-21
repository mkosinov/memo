export interface LocationFilterProps {
  locations: { id: string; name: string }[];
  selectedLocation: string | null;
  onSelectLocation: (locationId: string | null) => void;
}

export function LocationFilter({
  locations,
  selectedLocation,
  onSelectLocation,
}: LocationFilterProps) {
  return (
    <div className="relative inline-flex items-center flex-shrink-0">
      {/* Location pin icon */}
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555555] pointer-events-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <select
        className="rounded-lg border py-2 pl-9 pr-3 text-sm appearance-none cursor-pointer"
        style={{
          borderColor: "#E0E0E1",
          backgroundColor: "#ffffff",
          color: "#555555",
        }}
        value={selectedLocation ?? ""}
        onChange={(e) =>
          onSelectLocation(e.target.value === "" ? null : e.target.value)
        }
      >
        <option value="">Все локации</option>
        {locations.map((loc) => (
          <option key={loc.id} value={loc.id}>
            {loc.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default LocationFilter;
