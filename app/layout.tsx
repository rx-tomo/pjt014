import '../styles/globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'GBP Ops — pjt014',
  description: 'Google Business Profile ops system'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-white text-gray-900">
        <div className="max-w-6xl mx-auto p-6">{children}</div>
      </body>
    </html>
  );
}

