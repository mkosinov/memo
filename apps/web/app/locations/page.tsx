import { Header } from "../ui/Header";

export default function LocationsPage() {
  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20">
        <h1 className="text-2xl font-bold text-ink">Студии</h1>
        <p className="mt-4 text-ink-mid">Страница студий в разработке. Здесь будут адреса и описание наших студий.</p>
      </div>
    </main>
  );
}
