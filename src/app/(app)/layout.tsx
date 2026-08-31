import type { ReactNode } from 'react';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">{children}</main>
  );
}
