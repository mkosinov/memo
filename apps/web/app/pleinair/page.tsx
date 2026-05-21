import { Header } from "../components/Header";

export default function PleinairPage() {
  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20">
        <h1 className="text-2xl font-bold text-ink">Пленэр</h1>
        <p className="mt-4 text-ink-mid">Страница пленэров в разработке. Здесь будет информация о выездных мастер-классах на природе.</p>
      </div>
    </main>
  );
}
