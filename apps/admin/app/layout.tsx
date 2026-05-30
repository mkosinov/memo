import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';
import { ToastContainer } from './components/toast/ToastContainer';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

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
        <QueryClientProvider client={queryClient}>
          <UIProvider>
            <ScheduleProvider>
              {children}
            </ScheduleProvider>
            <ToastContainer />
          </UIProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
