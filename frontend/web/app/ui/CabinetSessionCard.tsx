"use client";

import type { MyClient } from "@memo/api-client";
import { Button } from "./Button";

export interface CabinetSessionCardProps {
  client: MyClient;
  onLogout: () => void;
}

/** The authenticated session block of the #523 shell: the session phone
 * (GET /my/client data) + «Выйти». Shared by every cabinet section (#513). */
export function CabinetSessionCard({ client, onLogout }: CabinetSessionCardProps) {
  return (
    <div className="space-y-4" data-testid="cabinet-logged-in">
      <div className="rounded-lg border border-line bg-white px-4 py-3">
        <p className="text-sm text-ink-mid mb-1">Ваш телефон</p>
        <p data-testid="cabinet-phone" className="text-lg font-medium text-ink">
          {client.phone}
        </p>
      </div>
      <Button variant="outline" size="lg" className="w-full" onClick={onLogout}>
        Выйти
      </Button>
    </div>
  );
}

export default CabinetSessionCard;
