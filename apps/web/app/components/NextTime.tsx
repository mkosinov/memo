import { Overlay } from "./Overlay";
import { Button } from "./Button";

export interface NextTimeProps {
  isOpen: boolean;
  onClose: () => void;
  options: { date: string; time: string; location: string; onBook?: () => void }[];
}

export function NextTime({ isOpen, onClose, options }: NextTimeProps) {
  return (
    <Overlay isOpen={isOpen} onClose={onClose} size="half">
      <h2 className="text-xl font-semibold text-ink mb-4">В следующий раз</h2>
      <div className="space-y-3">
        {options.slice(0, 3).map((option, index) => (
          <div
            key={index}
            data-testid={`next-time-option-${index}`}
            className="border border-line rounded-lg p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-ink font-medium">{option.date}</p>
                <p className="text-sm text-ink-mid">{option.time}</p>
                <p className="text-sm text-ink-light mt-1">{option.location}</p>
              </div>
              <Button variant="primary" size="sm" onClick={option.onBook}>
                Записаться
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Overlay>
  );
}

export default NextTime;
