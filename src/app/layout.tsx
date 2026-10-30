import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Code Gladiators",
  description: "Four AI models race to build the same game, live, in isolated sandboxes. An AI judge picks the winner.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-stone-950 font-sans text-stone-200">{children}</body>
    </html>
  );
}
