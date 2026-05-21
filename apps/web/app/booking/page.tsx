"use client";

import { useState } from "react";
import { Header } from "../components/Header";
import { BookingOverlay } from "../components/BookingOverlay";

const mockActivity = {
  imageUrl: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=400&fit=crop",
  title: "Акварельный пейзаж",
  time: "20 мая, 14:00",
  location: "Студия на Арбате",
  tariffs: [
    { label: "Взрослый", price: 2500 },
    { label: "Детский (5–11 лет)", price: 1800 },
  ],
};

export default function BookingPage() {
  const [isOpen, setIsOpen] = useState(true);

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <main className="min-h-screen bg-surface">
      <Header />
      <div className="px-4 py-8 pt-20">
        <BookingOverlay isOpen={isOpen} onClose={handleClose} activity={mockActivity} />
      </div>
    </main>
  );
}
