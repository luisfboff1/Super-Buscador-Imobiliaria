"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Search, Clock, Link2, Settings, Heart } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, section: "Principal" },
  { href: "/buscador", label: "Buscador", icon: Search, section: null },
  { href: "/historico", label: "Histórico", icon: Clock, section: null },
  { href: "/favoritos", label: "Favoritos", icon: Heart, section: null },
  { href: "/fontes", label: "Fontes", icon: Link2, section: "Configurações" },
  { href: "/configuracoes", label: "Configurações", icon: Settings, section: null },
];

interface SidebarProps {
  userName?: string;
  userPlan?: string;
  userInitial?: string;
  fontesUsed?: number;
  fontesTotal?: number;
  fontesErroCount?: number;
}

export function Sidebar({
  userName = "Usuário",
  userPlan = "Plano Gratuito",
  userInitial = "U",
  fontesUsed = 0,
  fontesTotal = 5,
  fontesErroCount = 0,
}: SidebarProps) {
  const pathname = usePathname();
  const fontesPercent = fontesTotal > 0 ? Math.round((fontesUsed / fontesTotal) * 100) : 0;

  let lastSection: string | null = null;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-mark">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        <div className="sidebar-logo-text">
          Super Buscador
          <span>Workspace</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const showSection = item.section && item.section !== lastSection;
          if (item.section) lastSection = item.section;

          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const showBadge = item.href === "/fontes" && fontesErroCount > 0;

          return (
            <div key={item.href}>
              {showSection && <div className="sidebar-section-title">{item.section}</div>}
              <Link href={item.href} className={`sidebar-item ${isActive ? "active" : ""}`}>
                <Icon />
                {item.label}
                {showBadge && <span className="sidebar-badge-danger">!</span>}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-progress">
          <div className="sidebar-progress-label">
            <span>Fontes cadastradas</span>
            <span>
              {fontesUsed}/{fontesTotal}
            </span>
          </div>
          <div className="sidebar-progress-bar">
            <div className="sidebar-progress-fill" style={{ width: `${fontesPercent}%` }} />
          </div>
        </div>
        <div className="sidebar-user">
          <div className="sidebar-avatar">{userInitial}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{userName}</div>
            <div className="sidebar-user-plan">{userPlan}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
