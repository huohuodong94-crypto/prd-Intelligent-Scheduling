import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config";

// 简化鉴权：手机号 + 固定验证码登录，签发 JWT 存 httpOnly cookie。
// 不接真实短信服务，验证码写死（见 config.auth.fixedOtp）。

const COOKIE_NAME = "wfm_session";
const secretKey = new TextEncoder().encode(config.auth.secret);

export type SessionUser = {
  id: string;
  name: string;
  role: "employee" | "manager" | "admin";
  storeId: string | null;
  phone: string;
};

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey);

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSession() {
  cookies().set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return {
      id: payload.id as string,
      name: payload.name as string,
      role: payload.role as SessionUser["role"],
      storeId: (payload.storeId as string) ?? null,
      phone: payload.phone as string,
    };
  } catch {
    return null;
  }
}

// 供 API 路由使用：要求已登录，可选限定角色
export async function requireSession(
  roles?: SessionUser["role"][]
): Promise<{ user: SessionUser } | { error: string; status: number }> {
  const user = await getSession();
  if (!user) return { error: "未登录", status: 401 };
  if (roles && !roles.includes(user.role))
    return { error: "无权限访问该功能", status: 403 };
  return { user };
}
