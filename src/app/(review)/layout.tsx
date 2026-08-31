import type { ReactNode } from 'react';

/** The review screens get a wider shell than the capture flow (two panes on
 *  desktop, single column on the truck-sized screen). */
export default function ReviewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-28 pt-4 sm:px-5">{children}</div>
  );
}
