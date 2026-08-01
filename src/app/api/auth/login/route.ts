import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { createSession } from "@/lib/auth";
import { ok, fail, readJson } from "@/lib/api";

// 登录：手机号 + 固定验证码（123456）。不接真实短信。
export async function POST(req: Request) {
  const { phone, code } = await readJson<{ phone: string; code: string }>(req);
  if (!phone || !code) return fail("请输入手机号和验证码");
  if (code !== config.auth.fixedOtp) return fail("验证码错误（MVP 固定为 123456）");

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return fail("该手机号未注册，请使用 seed 中的测试账号", 404);

  await createSession({
    id: user.id,
    name: user.name,
    role: user.role as any,
    storeId: user.storeId,
    phone: user.phone,
  });

  return ok({ id: user.id, name: user.name, role: user.role, storeId: user.storeId });
}
