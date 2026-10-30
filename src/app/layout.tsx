import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: "./fonts/inter.ttf",
  weight: "100 900",
  variable: "--font-body",
  display: "swap",
});

const jakarta = localFont({
  src: "./fonts/plus-jakarta-sans.ttf",
  weight: "200 800",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hubog Shoot",
  description: "Turn one phone photo of your product into a ready-to-post listing pack.",
  icons: { apple: "/apple-touch-icon.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jakarta.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
