import { Overlay } from "./Overlay";

export interface MaterialDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  material: string;
  included: string[];
  bringYourOwn?: string[];
  dryingTime?: string;
}

export function MaterialDetails({
  isOpen,
  onClose,
  material,
  included,
  bringYourOwn,
  dryingTime,
}: MaterialDetailsProps) {
  return (
    <Overlay isOpen={isOpen} onClose={onClose} size="half">
      <h2 className="text-xl font-semibold text-ink mb-4">Материал</h2>

      <p className="text-lg font-semibold text-ink mb-4">{material}</p>

      <section className="mb-4">
        <h3 className="text-sm font-semibold text-ink-mid uppercase tracking-wider mb-2">
          Что включено
        </h3>
        <ul className="list-disc list-inside space-y-1">
          {included.map((item, index) => (
            <li key={index} className="text-ink">
              {item}
            </li>
          ))}
        </ul>
      </section>

      {bringYourOwn && bringYourOwn.length > 0 && (
        <section className="mb-4">
          <h3 className="text-sm font-semibold text-ink-mid uppercase tracking-wider mb-2">
            Что взять с собой
          </h3>
          <ul className="list-disc list-inside space-y-1">
            {bringYourOwn.map((item, index) => (
              <li key={index} className="text-ink">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dryingTime && (
        <section>
          <h3 className="text-sm font-semibold text-ink-mid uppercase tracking-wider mb-1">
            Время сохнет
          </h3>
          <p className="text-ink">{dryingTime}</p>
        </section>
      )}
    </Overlay>
  );
}

export default MaterialDetails;
