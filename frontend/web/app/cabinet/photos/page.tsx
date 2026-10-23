"use client";

import { useState } from "react";
import { Header } from "../../ui/Header";
import { CabinetLogin } from "../../ui/CabinetLogin";
import { CabinetSessionCard } from "../../ui/CabinetSessionCard";
import { CabinetNav } from "../../ui/CabinetNav";
import { MyPhotoCard } from "../../ui/MyPhotoCard";
import { ListPagination } from "../../ui/ListPagination";
import { useCabinetAuth } from "../../hooks/useCabinetAuth";
import { useMyPhotos } from "../../hooks/useMyPhotos";

/**
 * «Мои фото» (#513 Task 8): the client's whole photo grid — public and
 * NON-public alike (is_public is a display badge here, never a filter) —
 * rendered by the same mechanism as the guest gallery: a plain <img> per
 * card whose src is the allowlisted filename served from the static
 * public/images dir (#513 render-path decision: is_public filters only
 * lists, never bytes). Anonymous on ANY cabinet section sees the login
 * form and no data (spec С5).
 */
export default function CabinetPhotosPage() {
  const auth = useCabinetAuth();
  const handleLogout = auth.handleLogout;
  const client = auth.session.client;
  const [page, setPage] = useState(1);
  const photos = useMyPhotos(page, client !== null);

  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20 max-w-2xl mx-auto">
        {client === null ? (
          <>
            <h1 className="text-2xl font-bold text-ink">Личный кабинет</h1>
            {auth.session.status === "checking" ? (
              <p className="mt-6 text-sm text-ink-mid" data-testid="cabinet-checking">
                Загрузка…
              </p>
            ) : (
              <CabinetLogin auth={auth} />
            )}
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-ink">Мои фото</h1>

            <div className="mt-6 space-y-4">
              <CabinetSessionCard
                client={client}
                onLogout={() => void handleLogout()}
              />
              <CabinetNav active="photos" />
            </div>

            <div className="mt-6">
              {photos.isPending ? (
                <p className="text-sm text-ink-mid" data-testid="my-photos-loading">
                  Загрузка…
                </p>
              ) : photos.error !== null ? (
                <p className="text-sm text-ink-mid" data-testid="my-photos-error">
                  Не удалось загрузить фото. Попробуйте позже
                </p>
              ) : photos.cards.length === 0 ? (
                <div
                  className="rounded-2xl border border-line bg-white px-4 py-12 text-center"
                  data-testid="my-photos-empty"
                >
                  <p className="text-ink-mid">У вас пока нет фото</p>
                </div>
              ) : (
                <>
                  <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {photos.cards.map((photo) => (
                      <MyPhotoCard key={photo.id} photo={photo} />
                    ))}
                  </ul>
                  <ListPagination
                    page={photos.page}
                    pageCount={photos.pageCount}
                    onChange={setPage}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
