/**
 * email-verify — 邮箱真实性校验与 OTP 验证码服务
 *
 * 能力：
 *   - 常用一次性临时邮箱域名黑名单拦截；
 *   - 6 位 OTP 验证码：10 分钟有效、单码最多 5 次尝试；
 *   - 验证通过后签发 email_verified_token（15 分钟有效），注册时绑定邮箱；
 *   - 邮件发送：配置 RESEND_API_KEY 走 Resend API；未配置时仅在非生产环境
 *     打印到服务端日志并返回 dev_code（测试/演示模式可绕过）。
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// ─── 一次性临时邮箱域名黑名单（常见来源）────────────────────────────
const DISPOSABLE_DOMAINS = [
  "mailinator.com", "10minutemail.com", "10minutemail.net", "guerrillamail.com",
  "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "grr.la",
  "temp-mail.org", "tempmail.com", "tempmail.net", "throwawaymail.com",
  "yopmail.com", "yopmail.fr", "getnada.com", "nada.email", "maildrop.cc",
  "mailnesia.com", "mailcatch.com", "mintemail.com", "spamgourmet.com",
  "dispostable.com", "mailtemp.net", "mohmal.com", "emailfake.com",
  "fakeinbox.com", "mailforspam.com", "trashmail.com", "trashmail.de",
  "burnermail.io", "inboxbear.com", "luxusmail.org", "mailmetrash.com",
  "mytemp.email", "spambox.us", "tmpmail.org", "tmail.ws", "tempinbox.com",
  "example.com", "example.org", "example.net",
];

export function isDisposableEmail(email: string): boolean {
  const domain = (email || "").trim().toLowerCase().split("@")[1] || "";
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.includes(domain)) return true;
  // 常见垃圾邮箱特征：包含 "mailinator"/"temp" 等子串
  return /(mailinator|10minute|guerrilla|temp-?mail|yopmail|throwaway|disposable|fakeinbox|trash-?mail|sharklasers|getnada)/i.test(
    domain
  );
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email || "").trim());
}

// ─── OTP / 验证令牌存储（文件 + 内存，参考 admin-session）─────────────
interface OtpRecord {
  email: string;
  code: string;
  expires_at: number;
  attempts: number;
}

interface VerifiedRecord {
  email: string;
  expires_at: number;
}

const DATA_DIR = path.join(os.tmpdir(), "calorieai-data");
const OTP_FILE = path.join(DATA_DIR, "otp-codes.json");
const VERIFIED_FILE = path.join(DATA_DIR, "email-verified.json");

const memoryOtps = new Map<string, OtpRecord>();
const memoryVerified = new Map<string, VerifiedRecord>();

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function readOtps(): Map<string, OtpRecord> {
  ensureDataDir();
  const map = new Map<string, OtpRecord>();
  try {
    if (fs.existsSync(OTP_FILE)) {
      const data = JSON.parse(fs.readFileSync(OTP_FILE, "utf-8"));
      for (const [k, v] of Object.entries(data.otps || {})) map.set(k, v as OtpRecord);
    }
  } catch (err) {
    console.error("[EmailVerify] 读取 OTP 存储失败:", err);
  }
  for (const [k, v] of memoryOtps) map.set(k, v);
  return map;
}

function writeOtps(map: Map<string, OtpRecord>): void {
  ensureDataDir();
  try {
    fs.writeFileSync(
      OTP_FILE,
      JSON.stringify({ otps: Object.fromEntries(map.entries()) }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("[EmailVerify] 写入 OTP 存储失败:", err);
  }
}

function readVerified(): Map<string, VerifiedRecord> {
  ensureDataDir();
  const map = new Map<string, VerifiedRecord>();
  try {
    if (fs.existsSync(VERIFIED_FILE)) {
      const data = JSON.parse(fs.readFileSync(VERIFIED_FILE, "utf-8"));
      for (const [k, v] of Object.entries(data.verified || {})) map.set(k, v as VerifiedRecord);
    }
  } catch (err) {
    console.error("[EmailVerify] 读取 verified 存储失败:", err);
  }
  for (const [k, v] of memoryVerified) map.set(k, v);
  return map;
}

function writeVerified(map: Map<string, VerifiedRecord>): void {
  ensureDataDir();
  try {
    fs.writeFileSync(
      VERIFIED_FILE,
      JSON.stringify({ verified: Object.fromEntries(map.entries()) }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("[EmailVerify] 写入 verified 存储失败:", err);
  }
}

// ─── OTP 生命周期 ────────────────────────────────────────────────────
const OTP_TTL_MS = 10 * 60 * 1000; // 10 分钟
const OTP_MAX_ATTEMPTS = 5;

export async function createOtp(email: string): Promise<string> {
  const code = crypto.randomInt(100000, 1000000).toString();
  const record: OtpRecord = {
    email: email.trim().toLowerCase(),
    code,
    expires_at: Date.now() + OTP_TTL_MS,
    attempts: 0,
  };
  const map = readOtps();
  map.set(record.email, record);
  memoryOtps.set(record.email, record);
  writeOtps(map);
  return code;
}

export async function verifyOtp(
  email: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = email.trim().toLowerCase();
  const map = readOtps();
  const record = map.get(key) || memoryOtps.get(key);
  if (!record) return { ok: false, error: "验证码不存在或已过期，请重新发送" };
  if (Date.now() > record.expires_at) {
    map.delete(key);
    memoryOtps.delete(key);
    writeOtps(map);
    return { ok: false, error: "验证码已过期，请重新发送" };
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    map.delete(key);
    memoryOtps.delete(key);
    writeOtps(map);
    return { ok: false, error: "尝试次数过多，请重新发送验证码" };
  }
  if (record.code !== code.trim()) {
    record.attempts += 1;
    map.set(key, record);
    memoryOtps.set(key, record);
    writeOtps(map);
    return { ok: false, error: `验证码错误（剩余 ${OTP_MAX_ATTEMPTS - record.attempts} 次机会）` };
  }
  map.delete(key);
  memoryOtps.delete(key);
  writeOtps(map);
  return { ok: true };
}

// ─── 邮箱验证令牌（注册绑定）────────────────────────────────────────
const VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 分钟

export async function createEmailVerifiedToken(email: string): Promise<string> {
  const token = crypto.randomBytes(24).toString("hex");
  const record: VerifiedRecord = {
    email: email.trim().toLowerCase(),
    expires_at: Date.now() + VERIFIED_TTL_MS,
  };
  const map = readVerified();
  map.set(token, record);
  memoryVerified.set(token, record);
  writeVerified(map);
  return token;
}

export async function consumeEmailVerifiedToken(
  email: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "缺少邮箱验证令牌，请先完成邮箱验证" };
  const map = readVerified();
  const record = map.get(token) || memoryVerified.get(token);
  if (!record) return { ok: false, error: "邮箱验证令牌无效或已过期，请重新验证" };
  if (Date.now() > record.expires_at) {
    map.delete(token);
    memoryVerified.delete(token);
    writeVerified(map);
    return { ok: false, error: "邮箱验证令牌已过期，请重新验证" };
  }
  if (record.email !== email.trim().toLowerCase()) {
    return { ok: false, error: "邮箱验证令牌与注册邮箱不匹配" };
  }
  map.delete(token);
  memoryVerified.delete(token);
  writeVerified(map);
  return { ok: true };
}

// ─── 邮件发送 ────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "CalorieAI <noreply@calorieai.app>";

export async function sendOtpEmail(
  email: string,
  code: string
): Promise<{ sent: "resend" | "dev"; devCode?: string }> {
  if (RESEND_API_KEY && RESEND_API_KEY !== "YOUR_RESEND_API_KEY_HERE") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email],
        subject: "CalorieAI 邮箱验证码",
        html: `<p>你的 CalorieAI 注册验证码为：<b style="font-size:20px">${code}</b></p>
               <p>验证码 10 分钟内有效，请勿泄露给他人。</p>`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`邮件发送失败（HTTP ${res.status}）: ${body.slice(0, 200)}`);
    }
    return { sent: "resend" };
  }

  // 测试/演示模式：非生产环境或显式开启 EMAIL_DEV_MODE 时，
  // 将验证码打印到服务端日志并返回 dev_code，便于本地联调与自动化演示。
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.EMAIL_DEV_MODE === "true"
  ) {
    // 测试/演示模式：打印到服务端日志并返回 dev_code，便于本地联调与自动化演示
    console.log(`[EmailVerify][dev] 验证码 ${email} → ${code}`);
    return { sent: "dev", devCode: code };
  }
  throw new Error("邮件服务未配置（RESEND_API_KEY），无法发送验证码");
}
