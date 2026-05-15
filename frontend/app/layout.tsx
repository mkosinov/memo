import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Memo — ColourMountains Studio Manager",
  description: "Studio management system for Colour Mountains art studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${inter.variable} antialiased`}>
        <UIProvider>
          <ScheduleProvider>
            {children}
          </ScheduleProvider>
        </UIProvider>
      </body>
    </html>
  );
}
