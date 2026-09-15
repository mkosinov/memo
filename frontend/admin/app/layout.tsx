import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from './providers';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Memo — ColourMountains Studio Manager",
  description: "Studio management system for Colour Mountains art studio",
};

// #262 §5.4: apply the persisted theme BEFORE React hydrates so a dark-theme
// reload never flashes light. Keep in sync with THEME_STORAGE_KEY in
// contexts/UIContext.tsx.
const themeBootstrapScript = `try{var t=localStorage.getItem("memo-theme");if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${inter.variable} antialiased`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
