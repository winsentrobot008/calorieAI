/**
 * admin-session — 管理后台服务端会话令牌存储（防攻击保障）
 *
 * - 登录成功后签发随机令牌并落盘（os.tmpdir 文件回退，Postgres/KV 接入可替换）；
 * - 令牌 24 小时有效，前端所有 /api/v1/admin/* 请求必须携带 x-admin-token。
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export interface AdminSession {
  token: string;
  admin_id: string;
  username: string;
  role: string;
  display_name: string;
  created_at: string;
}

const DATA_DIR = path.join(os.tmpdir(), "calorieai-data");
const DATA_FILE = path.join(DATA_DIR, "admin-sessions.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error("[AdminSession] Error creating data dir:", err);
  }
}

function readStore(): Record<string, AdminSession> {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      return data.sessions || {};
    }
  } catch (err) {
    console.error("[AdminSession] Error reading store:", err);
  }
  return {};
}

function writeStore(sessions: Record<string, AdminSession>): void {
  ensureDataDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions }, null, 2), "utf-8");
  } catch (err) {
    console.error("[AdminSession] Error writing store:", err);
  }
}

export function createAdminSession(input: Omit<AdminSession, "token" | "created_at">): AdminSession {
  const session: AdminSession = {
    ...input,
    token: crypto.randomBytes(24).toString("hex"),
    created_at: new Date().toISOString(),
  };
  const sessions = readStore();
  sessions[session.token] = session;
  writeStore(sessions);
  return session;
}

export function getAdminSession(token: string): AdminSession | null {
  if (!token) return null;
  const sessions = readStore();
  const session = sessions[token];
  if (!session) return null;
  const age = Date.now() - new Date(session.created_at).getTime();
  if (!Number.isFinite(age) || age > TTL_MS) {
    delete sessions[token];
    writeStore(sessions);
    return null;
  }
  return session;
}

export function revokeAdminSession(token: string): void {
  const sessions = readStore();
  if (sessions[token]) {
    delete sessions[token];
    writeStore(sessions);
  }
}
