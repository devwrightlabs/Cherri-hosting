import React from 'react';
import TopBar from './TopBar';
import BottomTabBar from './BottomTabBar';

interface AppShellProps {
  children: React.ReactNode;
  /** Right-aligned slot in the top bar (env toggle lives here in Phase 5). */
  topRight?: React.ReactNode;
  /** Brand/title text in the top bar. */
  title?: string;
  /**
   * Removes the default content padding/width frame when a screen wants to
   * own its full-bleed layout.
   */
  bare?: boolean;
}

/**
 * The single mobile app shell: a fixed-height column with a sticky top bar, a
 * scrollable content area, and the bottom tab bar. Used page-by-page in place
 * of the old desktop Sidebar layout.
 */
export default function AppShell({ children, topRight, title, bare = false }: AppShellProps) {
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-surface-950">
      <TopBar right={topRight} title={title} />

      <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain">
        {bare ? (
          children
        ) : (
          <div className="mx-auto w-full max-w-screen-sm px-4 pt-4 pb-8 space-y-5 animate-fade-in">
            {children}
          </div>
        )}
      </main>

      <BottomTabBar />
    </div>
  );
}
