import "./globals.css";

export const metadata = { title: "ゴミの日通知" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
