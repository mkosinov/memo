import { Header } from "../ui/Header";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20">
        <h1 className="text-2xl font-bold text-ink">О нас</h1>
        <p className="mt-4 text-ink-mid">Страница «О нас» в разработке. Здесь будет информация о нашей студии и команде.</p>
      </div>
    </main>
  );
}
