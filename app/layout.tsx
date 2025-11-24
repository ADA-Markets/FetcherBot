import type { Metadata } from 'next';
import './globals.css';

// Note: Metadata is static. For dynamic profile-based metadata,
// we would need to use generateMetadata() which requires server components
// For now, this provides a sensible default that covers both profiles
export const metadata: Metadata = {
  title: 'Multi-Project Fetcher Bot',
  description: 'Mining application for blockchain projects',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white min-h-screen flex flex-col">
        <div className="flex-1">
          {children}
        </div>
        <div className="bg-gradient-to-r from-orange-500/80 via-red-500/80 to-pink-500/80 text-white py-2 px-4 text-center text-sm">
          <p>
            Join our community!
            <a
              href="https://ada.markets/discord"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 font-semibold underline hover:text-yellow-200 transition-colors"
            >
              Discord
            </a>
            <span className="mx-2">•</span>
            Follow
            <a
              href="https://x.com/cwpaulm"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 font-semibold underline hover:text-yellow-200 transition-colors"
            >
              Paul
            </a>
            <span className="mx-1">&</span>
            <a
              href="https://x.com/PoolShamrock"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline hover:text-yellow-200 transition-colors"
            >
              Paddy
            </a>
            <span className="ml-1">on X</span>
          </p>
        </div>
      </body>
    </html>
  );
}
