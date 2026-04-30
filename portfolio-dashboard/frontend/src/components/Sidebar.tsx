import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Grid3X3,
  ArrowRightLeft,
  Shield,
  TrendingUp,
  FlaskConical,
  List,
  CandlestickChart,
  Upload,
  ChevronLeft,
  ChevronRight,
  PenLine,
  GitCompare,
  PlugZap,
} from 'lucide-react';
import { usePortfolioStore } from '../stores/portfolioStore';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/holdings', icon: Grid3X3, label: 'Holdings' },
  { to: '/cashflow', icon: ArrowRightLeft, label: 'Cash Flow' },
  { to: '/risk', icon: Shield, label: 'Risk' },
  { to: '/benchmark', icon: TrendingUp, label: 'Benchmark' },
  { to: '/simulator', icon: FlaskConical, label: 'Simulator' },
  { to: '/charts', icon: CandlestickChart, label: 'Charts' },
  { to: '/transactions', icon: List, label: 'Transactions' },
  { to: '/brokerage-pickup', icon: PlugZap, label: 'Pickup' },
  { to: '/webull-diff', icon: GitCompare, label: 'CSV vs API' },
];

export function Sidebar({ onReupload }: { onReupload: () => void }) {
  const { sidebarCollapsed, toggleSidebar, manualEntryCount, fundTransferCount, hasCashAnchor, setManualEntryModalOpen } = usePortfolioStore();
  const totalManualCount = manualEntryCount + fundTransferCount + (hasCashAnchor ? 1 : 0);
  const width = sidebarCollapsed ? 56 : 220;

  return (
    <aside style={{
      width,
      minWidth: width,
      height: '100vh',
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.2s ease',
      position: 'fixed',
      left: 0,
      top: 0,
      zIndex: 100,
    }}>
      <div style={{
        padding: sidebarCollapsed ? '16px 8px' : '16px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        {!sidebarCollapsed && (
          <div style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 700,
            fontSize: 14,
            color: 'var(--text-primary)',
            letterSpacing: '-0.3px',
            whiteSpace: 'nowrap',
          }}>
            INDIGO
          </div>
        )}
        <button
          onClick={toggleSidebar}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            marginLeft: sidebarCollapsed ? 'auto' : 0,
            marginRight: sidebarCollapsed ? 'auto' : 0,
          }}
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav style={{ flex: 1, padding: '8px 0' }}>
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: sidebarCollapsed ? '10px 0' : '10px 20px',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              textDecoration: 'none',
              fontSize: 13,
              fontFamily: 'var(--font-body)',
              fontWeight: isActive ? 500 : 400,
              borderLeft: isActive ? '3px solid var(--accent-blue)' : '3px solid transparent',
              background: isActive ? 'var(--bg-tertiary)' : 'transparent',
              transition: 'all 0.15s ease',
            })}
          >
            <Icon size={18} />
            {!sidebarCollapsed && label}
          </NavLink>
        ))}
      </nav>

      <div style={{
        padding: sidebarCollapsed ? '12px 8px' : '12px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <button
          onClick={() => setManualEntryModalOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            width: '100%',
            padding: '8px 12px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            transition: 'border-color 0.15s ease',
            position: 'relative',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-active)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <PenLine size={14} />
          {!sidebarCollapsed && 'Manual Entries'}
          {totalManualCount > 0 && (
            <span style={{
              marginLeft: 'auto',
              background: 'var(--accent-blue)',
              color: '#fff',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: 8,
              lineHeight: '14px',
            }}>
              {totalManualCount}
            </span>
          )}
        </button>
        <button
          onClick={onReupload}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            width: '100%',
            padding: '8px 12px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            transition: 'border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-active)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <Upload size={14} />
          {!sidebarCollapsed && 'Re-upload CSV'}
        </button>
      </div>
    </aside>
  );
}
