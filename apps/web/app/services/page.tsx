import { Header } from "../components/Header";

export default function ServicesPage() {
  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20">
        <h1 className="text-2xl font-bold text-ink">Услуги</h1>
        <p className="mt-4 text-ink-mid">Страница услуг в разработке. Здесь будет список мастер-классов и мероприятий.</p>
      </div>
    </main>
  );
}
