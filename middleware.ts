import { NextRequest, NextResponse } from "next/server";
import { verifySessionAuth } from "@/src/session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authenticated = await verifySessionAuth(req);

  // Redirect authenticated users away from the login page.
  if (pathname === "/graph/login") {
    if (authenticated) {
      const graphUrl = req.nextUrl.clone();
      graphUrl.pathname = "/graph";
      return NextResponse.redirect(graphUrl);
    }
    return NextResponse.next();
  }

  if (!authenticated) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/graph/login";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/graph", "/graph/:path*"],
};
