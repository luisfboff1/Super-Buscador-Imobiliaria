"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";

interface ClientLayoutProps {
  userName: string;
  userPlan: string;
  userInitial: string;
  fontesUsed: number;
  fontesTotal: number;
  fontesErroCount: number;
  children: React.ReactNode;
}

export function ClientLayout({ children, ...sidebarProps }: ClientLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-layout">
      {sidebarOpen && (
        <div
          className="sidebar-overlay active"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label="Abrir menu"
      >
        <Menu size={18} />
      </button>

      <Sidebar
        {...sidebarProps}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main-content">{children}</main>
    </div>
  );
}
