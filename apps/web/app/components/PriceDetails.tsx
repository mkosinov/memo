import { Overlay } from "./Overlay";

export interface PriceDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  tariffs: { name: string; price: number; description?: string }[];
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(price);
}

export function PriceDetails({ isOpen, onClose, tariffs }: PriceDetailsProps) {
  return (
    <Overlay isOpen={isOpen} onClose={onClose} size="half">
      <h2 className="text-xl font-semibold text-ink mb-4">Стоимость</h2>
      <ul className="divide-y divide-line">
        {tariffs.map((tariff, index) => (
          <li
            key={index}
            className="flex items-center justify-between py-3 border-b border-line"
          >
            <div>
              <span className="text-ink font-medium">{tariff.name}</span>
              {tariff.description && (
                <p className="text-sm text-ink-light mt-0.5">{tariff.description}</p>
              )}
            </div>
            <span className="text-ink font-semibold whitespace-nowrap">
              {formatPrice(tariff.price)}
            </span>
          </li>
        ))}
      </ul>
    </Overlay>
  );
}

export default PriceDetails;
