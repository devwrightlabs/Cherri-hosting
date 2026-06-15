import { NavLink, useLocation } from 'react-router-dom';

/** Inline stroke icons (no emoji) sized for a 24px tab glyph. */
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
  { to: '/dashboard', label: 'Home', icon: HomeIcon, match: (p) => p === '/dashboard' },
  {
    to: '/projects',
    label: 'Projects',
    icon: ProjectsIcon,
    match: (p) => p.startsWith('/projects'),
  },
  { to: '/account', label: 'Account', icon: AccountIcon, match: (p) => p === '/account' || p === '/pricing' },
];

/**
 * Sole bottom navigation (the sidebar is gone). Four destinations with a
 * raised gold Deploy action in the centre. Safe-area aware.
 */
export default function BottomTabBar() {
  const { pathname } = useLocation();
  const deployActive = pathname === '/deploy';

  // Insert the raised Deploy button between Projects and Account.
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  return (
    <nav className="safe-bottom shrink-0 bg-surface-950/95 backdrop-blur-md border-t border-hairline">
      <div className="max-w-screen-sm mx-auto w-full px-2">
        <div className="h-16 grid grid-cols-5 items-center">
          {left.map((t) => (
            <TabButton key={t.to} tab={t} active={t.match(pathname)} />
          ))}

          {/* Centre raised Deploy button */}
          <div className="flex justify-center">
            <NavLink
              to="/deploy"
              aria-label="Deploy"
              className="tap-target -mt-7 flex flex-col items-center"
            >
              <span
                className={`flex items-center justify-center w-14 h-14 rounded-full bg-gold-gradient text-surface-950 transition-transform active:scale-95 ${
                  deployActive ? 'shadow-gold ring-2 ring-gold/60' : 'shadow-gold-sm'
                }`}
              >
                <DeployIcon />
              </span>
              <span
                className={`mt-1 text-[10px] font-medium ${
                  deployActive ? 'text-gold' : 'text-ink-mut'
                }`}
              >
                Deploy
              </span>
            </NavLink>
          </div>

          {right.map((t) => (
            <TabButton key={t.to} tab={t} active={t.match(pathname)} />
          ))}
        </div>
      </div>
    </nav>
  );
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const Icon = tab.icon;
  return (
    <NavLink
      to={tab.to}
      className="tap-target flex flex-col items-center justify-center gap-1 h-full"
    >
      <span className={active ? 'text-gold' : 'text-ink-mut'}>
        <Icon active={active} />
      </span>
      <span className={`text-[10px] font-medium ${active ? 'text-gold' : 'text-ink-mut'}`}>
        {tab.label}
      </span>
    </NavLink>
  );
}
