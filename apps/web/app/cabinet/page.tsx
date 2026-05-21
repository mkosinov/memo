"use client";

import { useState } from "react";
import { Header } from "../components/Header";

export default function CabinetPage() {
  const [phone, setPhone] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Auth logic to be implemented
  };

  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20">
        <h1 className="text-2xl font-bold text-ink">Личный кабинет</h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-ink-mid mb-1">
              Номер телефона
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 (999) 999-99-99"
              className="w-full px-4 py-3 rounded-lg border border-line bg-white text-ink placeholder-ink-light focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg bg-brand text-white font-medium hover:bg-brand-light transition-colors"
          >
            Войти
          </button>
        </form>
      </div>
    </main>
  );
}
