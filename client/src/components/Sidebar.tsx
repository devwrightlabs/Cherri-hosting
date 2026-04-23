import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';
import Badge from './ui/Badge';

interface NavItem {
  label: string;
  to: string;
  icon: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: '⬛' },
  { label: 'Projects', to: '/projects', icon: '📦' },
  { label: 'Deploy', to: '/deploy', icon: '🚀' },
  { label: 'Pricing', to: '/pricing', icon: '💎' },
];

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const location = useLocation();

  return (
    <aside className="w-60 shrink-0 bg-surface-900 border-r border-surface-700/50 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-surface-700/50">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-2xl">🍒</span>
          <span className="font-bold text-white text-lg">Cherri</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                ${isActive
                  ? 'bg-cherry-500/15 text-cherry-400 border border-cherry-500/25'
                  : 'text-surface-400 hover:text-white hover:bg-surface-700'
                }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      {user && (
        <div className="px-3 py-4 border-t border-surface-700/50">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-800">
            <div className="w-8 h-8 rounded-full bg-cherry-gradient flex items-center justify-center text-white font-bold text-sm">
              {user.username[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.username}</p>
              <Badge variant={user.tier === 'PREMIUM' ? 'premium' : 'default'}>
                {user.tier}
              </Badge>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full mt-2 text-left px-3 py-2 text-sm text-surface-500 hover:text-white transition-colors rounded-lg hover:bg-surface-700"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
