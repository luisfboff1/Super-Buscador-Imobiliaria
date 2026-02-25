import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Rotas que exigem autenticação
const protectedPrefixes = [
  "/dashboard",
  "/buscador",
  "/fontes",
  "/historico",
  "/favoritos",
  "/configuracoes",
];

// Rotas públicas (não redireciona se já autenticado)
const authRoutes = ["/sign-in", "/sign-up"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const session = await auth();
  const isLoggedIn = !!session?.user;

  // Redireciona rotas de auth se já estiver logado
  if (isLoggedIn && authRoutes.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Protege rotas do app
  if (protectedPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    if (!isLoggedIn) {
      const signInUrl = new URL("/sign-in", request.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
