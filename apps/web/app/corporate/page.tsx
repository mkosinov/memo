import { Header } from "../components/Header";

export default function CorporatePage() {
  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20">
        <h1 className="text-2xl font-bold text-ink">Корпоративы</h1>
        <p className="mt-4 text-ink-mid">Страница корпоративных мероприятий в разработке. Здесь будет информация о тимбилдингах и корпоративных мастер-классах.</p>
      </div>
    </main>
  );
}
