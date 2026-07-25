'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookMarked,
  Database,
  FlaskConical,
  LayoutDashboard,
  Moon,
  Settings,
  Sun,
  Trophy,
  History,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { usePersistedFlag } from '@/lib/utils/use-persisted-flag';
import { useTheme } from '@/components/theme-provider';
import { Badge } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/overlays';
import type { RuntimeMode } from '@/lib/env';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Navigation ordered by the actual workflow: write a prompt, compare models,
 * save what worked, run it at scale, read the numbers. Settings sits apart at
 * the bottom because it is not part of that loop.
 */
const NAV_PRIMARY: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/playground', label: 'Playground', icon: FlaskConical },
  { href: '/prompts', label: 'Prompts', icon: BookMarked },
  { href: '/datasets', label: 'Datasets', icon: Database },
];

const NAV_ANALYSIS: NavItem[] = [
  { href: '/runs', label: 'Run history', icon: History },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
];

export interface AppShellProps {
  children: React.ReactNode;
  workspaceName: string;
  mode: RuntimeMode;
}

export function AppShell({ children, workspaceName, mode }: AppShellProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  // Persisted so the rail state survives navigation and reloads.
  const [collapsed, setCollapsed] = usePersistedFlag('promptbench-rail-collapsed');

  const toggleRail = React.useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  return (
    <div className="bg-canvas flex min-h-dvh">
      <aside
        className={cn(
          'border-line bg-surface/40 sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-200 ease-[var(--ease-out-quint)] md:flex',
          collapsed ? 'w-[60px]' : 'w-[228px]',
        )}
      >
        <div
          className={cn(
            'border-line flex h-14 shrink-0 items-center border-b',
            collapsed ? 'justify-center px-2' : 'px-4',
          )}
        >
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 overflow-hidden"
            aria-label="PromptBench AI home"
          >
            <Logo />
            {!collapsed ? (
              <span className="text-ink truncate text-[13px] font-semibold tracking-tight">
                PromptBench
              </span>
            ) : null}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
          <NavGroup items={NAV_PRIMARY} pathname={pathname} collapsed={collapsed} />
          <div className="my-3 px-2">
            <div className="bg-line h-px" />
          </div>
          {!collapsed ? (
            <p className="text-ink-faint mb-1.5 px-3 text-[10px] font-semibold tracking-[0.12em] uppercase">
              Analysis
            </p>
          ) : null}
          <NavGroup items={NAV_ANALYSIS} pathname={pathname} collapsed={collapsed} />
        </nav>

        <div className="border-line shrink-0 border-t px-2 py-2">
          <NavLink
            item={{ href: '/settings', label: 'Settings', icon: Settings }}
            active={pathname.startsWith('/settings')}
            collapsed={collapsed}
          />
          <button
            type="button"
            onClick={toggleRail}
            className={cn(
              'text-ink-subtle hover:bg-surface-raised hover:text-ink mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors',
              collapsed && 'justify-center px-0',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeft className="size-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="size-4 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard"
              className="md:hidden"
              aria-label="PromptBench AI home"
            >
              <Logo />
            </Link>
            <span className="text-ink-muted truncate text-[13px] font-medium">
              {workspaceName}
            </span>
            <ModeBadge mode={mode} />
          </div>

          <div className="flex items-center gap-1">
            <Tooltip content={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
              <button
                type="button"
                onClick={toggleTheme}
                className="text-ink-subtle hover:bg-surface-raised hover:text-ink rounded-md p-2 transition-colors"
                aria-label={
                  theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
                }
              >
                {theme === 'dark' ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
              </button>
            </Tooltip>
          </div>
        </header>

        {/* Mobile nav — the rail is hidden below md, so every destination moves
            to a horizontal scroller. Settings is included: it lives in the rail
            footer on desktop, and omitting it here would leave mobile users
            with no route to workspace configuration at all. */}
        <nav
          className="border-line flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden"
          aria-label="Main"
        >
          {[
            ...NAV_PRIMARY,
            ...NAV_ANALYSIS,
            { href: '/settings', label: 'Settings', icon: Settings },
          ].map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors',
                  active
                    ? 'bg-surface-overlay text-ink font-medium'
                    : 'text-ink-subtle hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main id="main" className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavGroup({
  items,
  pathname,
  collapsed,
}: {
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.href}>
          <NavLink
            item={item}
            active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            collapsed={collapsed}
          />
        </li>
      ))}
    </ul>
  );
}

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-surface-raised text-ink font-medium'
          : 'text-ink-subtle hover:bg-surface-raised/60 hover:text-ink',
      )}
    >
      {/* Copper marker on the active item — the signal colour marking
          "you are here", consistent with its use elsewhere. */}
      {active ? (
        <span
          className="bg-signal absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r-full"
          aria-hidden
        />
      ) : null}
      <Icon className="size-4 shrink-0" />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function ModeBadge({ mode }: { mode: RuntimeMode }) {
  if (mode === 'full') {
    return (
      <Badge tone="good" className="hidden sm:inline-flex">
        Live models
      </Badge>
    );
  }

  if (mode === 'hybrid') {
    return (
      <Tooltip content="Connected to live models. Data is stored in memory and resets when the server restarts.">
        <Badge tone="info" className="hidden cursor-help sm:inline-flex">
          Live · in-memory
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Tooltip content="Responses come from the deterministic local driver, not real models. Set OPENROUTER_API_KEY to run against live models.">
      <Badge tone="warn" className="cursor-help">
        Local driver
      </Badge>
    </Tooltip>
  );
}

/**
 * Mark: an aperture of measurement ticks. Reads as a lens or a dial at small
 * sizes, and is drawn rather than imported so it inherits the signal colour.
 */
function Logo() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[22px] shrink-0"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="9.25"
        stroke="var(--color-line-strong)"
        strokeWidth="1.5"
      />
      <path
        d="M12 3.5V7"
        stroke="var(--color-signal)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M12 17v3.5"
        stroke="var(--color-ink-faint)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M3.5 12H7"
        stroke="var(--color-ink-faint)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M17 12h3.5"
        stroke="var(--color-ink-faint)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M8.5 14.5L12 8l3.5 6.5"
        stroke="var(--color-signal)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
