import { Pill } from "./Pill";

const CATEGORIES = ["вместе", "взрослым", "детям"] as const;

export interface FilterPillsProps {
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
}

export function FilterPills({
  selectedCategory,
  onSelectCategory,
}: FilterPillsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar py-2 px-4">
      {CATEGORIES.map((category) => (
        <Pill
          key={category}
          active={selectedCategory === category}
          onClick={() =>
            onSelectCategory(selectedCategory === category ? null : category)
          }
        >
          {category}
        </Pill>
      ))}
    </div>
  );
}

export default FilterPills;
