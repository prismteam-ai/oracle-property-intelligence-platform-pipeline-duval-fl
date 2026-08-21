/**
 * Shell layout — T048
 * Fixed sidebar + topbar layout per plan.md wireframe.
 * Sidebar: nav items, bottom county summary stats.
 * Topbar: app title, IPNS health indicator, last run time.
 */

import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  Search,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useStats } from '@/services/api';

// ---------------------------------------------------------------------------
// Navigation items
// ---------------------------------------------------------------------------

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/pipeline-runs', label: 'Pipeline Runs', icon: Activity },
  { to: '/property-search', label: 'Property Search', icon: Search },
  { to: '/agent-chat', label: 'Agent Chat', icon: MessageSquare },
] as const;

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { data: stats } = useStats();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 flex h-screen flex-col border-r bg-background transition-all duration-200',
        collapsed ? 'w-16' : 'w-52',
      )}
    >
      {/* Toggle button */}
      <div className="flex items-center justify-end p-2">
        <button
          onClick={onToggle}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                collapsed && 'justify-center px-2',
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Bottom county summary */}
      <div className="px-3 pb-4">
        <Separator className="mb-3" />
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <span>FL</span>
            <span>{formatCompact(stats?.totalProperties ?? 0)}</span>
          </div>
        ) : (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Duval, FL</div>
            <div>{(stats?.totalProperties ?? 0).toLocaleString()} records</div>
            <div>{stats?.sourceCount ?? 0} sources</div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar() {
  const { data: stats } = useStats();

  const ipnsLabel =
    stats?.ipnsStatus === 'live' ? 'Live' : stats?.ipnsStatus === 'stale' ? 'Stale' : 'Pending';
  const ipnsColor =
    stats?.ipnsStatus === 'live' ? 'bg-green-500' : stats?.ipnsStatus === 'stale' ? 'bg-yellow-500' : 'bg-gray-400';

  const lastRunAgo = stats?.lastRun ? formatTimeAgo(new Date(stats.lastRun.started_at)) : 'Never';

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background px-6">
      <h1 className="text-sm font-bold tracking-wider text-foreground">
        ORACLE PIPELINE &mdash; DUVAL COUNTY
      </h1>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>IPNS:</span>
          <span className={cn('inline-block h-2 w-2 rounded-full', ipnsColor)} />
          <span>{ipnsLabel}</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <span>Last run: {lastRunAgo}</span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Shell (exported)
// ---------------------------------------------------------------------------

export function Shell() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div
        className={cn(
          'flex flex-col transition-all duration-200',
          collapsed ? 'ml-16' : 'ml-52',
        )}
      >
        <TopBar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
