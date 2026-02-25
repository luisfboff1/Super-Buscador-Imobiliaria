import { Sidebar } from "@/components/layout/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-layout">
      <Sidebar
        userName="Mateus Rimoldi"
        userPlan="Plano Gratuito"
        userInitial="M"
        aiSearchesUsed={6}
        aiSearchesTotal={10}
      />
      <main className="main-content">{children}</main>
    </div>
  );
}
