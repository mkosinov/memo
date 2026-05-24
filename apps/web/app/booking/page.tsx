"use client";

import { useState } from "react";
import type { ActivityView } from "../lib/model/view/activity";
import { Header } from "../ui/Header";
import { BookingActivityOverlay } from "../ui/BookingActivityOverlay";

const mockActivity: ActivityView = {
  id: "act-1",
  title: "Акварельный пейзаж",
  imageUrl: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=400&fit=crop",
  category: "вместе",
  time: "14:00 – 16:00",
  duration: "2 ч",
  guestsCount: 8,
  material: "Акварель",
  size: "30×40 см",
  priceMin: 2500,
  priceMax: 3500,
  teacherName: "Анна Иванова",
  date: "2026-05-20",
  dateFormatted: "20 мая",
  priceFormatted: "2 500 – 3 500 ₽",
  categoryColor: "#5B8C7A",
  location: { id: "loc-1", name: "Студия на Таганке", address: "ул. Таганская, д. 10" },
  guestPhotos: [],
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
        <BookingActivityOverlay
          isOpen={isOpen}
          onClose={handleClose}
          activityId="act-1"
          activities={[mockActivity]}
        />
      </div>
    </main>
  );
}
