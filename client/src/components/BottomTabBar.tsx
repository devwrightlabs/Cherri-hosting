import { NavLink, useLocation } from 'react-router-dom';

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}
function ProjectsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function AccountIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}
function DeployIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V6" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}

interface Tab {
  to: string;
  label: string;
  icon: (a: { active: boolean }) => JSX.Element;
  match: (path: string) => boolean;
}

const tabs: Tab[] = [
  { to: '/dashboard', label: 'Home',     icon: HomeIcon,     match: (p) => p === '/dashboard' },
  { to: '/projects',  label: 'Projects', icon: ProjectsIcon, match: (p) => p.startsWith('/projects') },
  { to: '/account',   label: 'Account',  icon: AccountIcon,  match: (p) => p === '/account' || p === '/pricing' },
];

/**
 * Bottom navigation bar.
 *
 * Layout rules:
 * - Four equal-width flex columns (flex: 1 1 0) — nothing can skew.
 * - All four labels sit on the same baseline: every column uses
 *   `justify-content: flex-end` so the label is anchored to the bottom
 *   of the 52 px content row.
 * - The raised Deploy circle lifts via a negative margin-top applied to
 *   the circle element alone; the column stays the same height as the
 *   others and its label stays on the shared baseline.
 * - `env(safe-area-inset-bottom)` padding is applied inline on the <nav>
 *   so the bar is never obscured by the home indicator on notched phones.
 */
export default function BottomTabBar() {
  const { pathname } = useLocation();
  const deployActive = pathname === '/deploy';

  const left  = tabs.slice(0, 2);
  const right = tabs.slice(2);

  return (
    <nav
      className="shrink-0 bg-surface-950/95 backdrop-blur-md border-t border-hairline overflow-visible"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-screen-sm mx-auto w-full flex overflow-visible" style={{ height: '52px' }}>
        {left.map((t) => (
          <TabButton key={t.to} tab={t} active={t.match(pathname)} />
        ))}

        {/* Centre column — same flex-1 width as the others.
            The circle lifts via -mt-6 on the element only; the column's
            height and the label's baseline position are unaffected. */}
        <NavLink
          to="/deploy"
          aria-label="Deploy"
          className="flex-1 flex flex-col items-center justify-end pb-2 overflow-visible"
        >
          <span
            className={[
              '-mt-6',
              'flex items-center justify-center',
              'w-14 h-14 rounded-full',
              'bg-gold-gradient text-surface-950',
              'transition-transform active:scale-95',
              deployActive ? 'shadow-gold ring-2 ring-gold/60' : 'shadow-gold-sm',
            ].join(' ')}
          >
            <DeployIcon />
          </span>
          <span className={`mt-1 text-[10px] font-medium ${deployActive ? 'text-gold' : 'text-ink-mut'}`}>
            Deploy
          </span>
        </NavLink>

        {right.map((t) => (
          <TabButton key={t.to} tab={t} active={t.match(pathname)} />
        ))}
      </div>
    </nav>
  );
}

/** Regular (non-raised) tab button. Labels aligned to pb-2 from row bottom. */
function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const Icon = tab.icon;
  return (
    <NavLink
      to={tab.to}
      className="flex-1 flex flex-col items-center justify-end gap-1 pb-2"
      style={{ minWidth: 0 }}
    >
      <span className={active ? 'text-gold' : 'text-ink-mut'}>
        <Icon active={active} />
      </span>
      <span className={`text-[10px] font-medium leading-none ${active ? 'text-gold' : 'text-ink-mut'}`}>
        {tab.label}
      </span>
    </NavLink>
  );
}
