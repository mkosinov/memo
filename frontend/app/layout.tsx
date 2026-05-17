import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Memo — Цветные Горы',
  description: 'Система управления студией рисования',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
