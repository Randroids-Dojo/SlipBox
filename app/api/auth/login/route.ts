import { NextRequest, NextResponse } from "next/server";
import { getSlipBoxUiPassword, getSessionSecret } from "@/src/config";
import { SESSION_COOKIE, createSessionToken, timingSafeEqual } from "@/src/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body.password !== "string") {
    return NextResponse.json({ error: "Missing password" }, { status: 400 });
  }

  if (!timingSafeEqual(body.password, getSlipBoxUiPassword())) {
    return NextResponse.json({ error: "Invalid password" }, { status: 403 });
  }

  const token = await createSessionToken(getSessionSecret());
  const response = NextResponse.json({ ok: true });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
