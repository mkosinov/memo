import { Header } from "../components/Header";

export default function ShopPage() {
  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20">
        <h1 className="text-2xl font-bold text-ink">Магазин</h1>
        <p className="mt-4 text-ink-mid">Страница магазина в разработке. Здесь будут товары для рисования и сувениры.</p>
      </div>
    </main>
  );
}
