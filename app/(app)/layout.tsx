import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/layout/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/sign-in");
  }

  const user = session.user;
  const userName = user.name ?? user.email ?? "Usuário";
  const userInitial = (user.name ?? user.email ?? "U")[0].toUpperCase();

  return (
    <div className="app-layout">
      <Sidebar
        userName={userName}
        userPlan="Plano Gratuito"
        userInitial={userInitial}
        aiSearchesUsed={0}
        aiSearchesTotal={10}
      />
      <main className="main-content">{children}</main>
    </div>
  );
}
