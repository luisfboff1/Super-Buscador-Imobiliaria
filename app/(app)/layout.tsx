import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ClientLayout } from "@/components/layout/ClientLayout";
import { getNavStats } from "@/lib/db/queries";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/sign-in");
  }

  const user = session.user;
  const userName = user.name ?? user.email ?? "Usuário";
  const userInitial = (user.name ?? user.email ?? "U")[0].toUpperCase();
  const { fontesUsed, fontesErroCount } = await getNavStats();

  return (
    <ClientLayout
      userName={userName}
      userPlan="Plano Gratuito"
      userInitial={userInitial}
      fontesUsed={fontesUsed}
      fontesTotal={5}
      fontesErroCount={fontesErroCount}
    >
      {children}
    </ClientLayout>
  );
}
