/**
 * credits-store — 服务端积分存储（文件适配器实现）
 *
 * 通过统一数据库访问层 (src/lib/db) 读写；
 * 此文件仅作为无 Postgres/KV 配置时的本地文件回退实现。
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { CreditProfile } from "@git008/commercial-engine/middleware/credits";

export interface CreditRecord {
  user_id: string;
  credits: number;
  updated_at: string;
  /** 上次每日免费额度重置时间（epoch ms，UTC 日边界） */
  last_reset_timestamp?: number;
  /** 本自然日已消耗的免费额度 */
  daily_free_used?: number;
  /** 本自然日已领取的激励广告次数 */
  daily_ad_views_today?: number;
}

const DATA_DIR = path.join(os.tmpdir(), "calorieai-data");
const DATA_FILE = path.join(DATA_DIR, "credits.json");

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error("[CreditsStore] Error creating data dir:", err);
  }
}

function readStore(): Record<string, CreditRecord> {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      return data.credits || {};
    }
  } catch (err) {
    console.error("[CreditsStore] Error reading store:", err);
  }
  return {};
}

function writeStore(store: Record<string, CreditRecord>): void {
  ensureDataDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ credits: store }, null, 2), "utf-8");
  } catch (err) {
    console.error("[CreditsStore] Error writing store:", err);
  }
}

/** 读取用户积分（无记录返回 null） */
export function getCredits(userId: string): number | null {
  const record = readStore()[userId];
  return record ? record.credits : null;
}

/** 写入用户积分（不低于 0） */
export function setCredits(userId: string, credits: number): CreditRecord {
  const store = readStore();
  const record: CreditRecord = {
    user_id: userId,
    credits: Math.max(0, Math.floor(credits)),
    updated_at: new Date().toISOString(),
  };
  store[userId] = record;
  writeStore(store);
  return record;
}

/** 增减积分并返回新余额 */
export function addCredits(userId: string, delta: number): number {
  const current = getCredits(userId) ?? 0;
  const next = Math.max(0, current + delta);
  setCredits(userId, next);
  return next;
}

/** 读取用户积分档案（无记录返回 null；老记录缺失的每日字段按 0 补齐） */
export function getCreditProfile(userId: string): CreditProfile | null {
  const record = readStore()[userId];
  if (!record) return null;
  return {
    user_id: record.user_id,
    credits: Math.max(0, Math.floor(record.credits)),
    last_reset_timestamp: Math.max(0, Math.floor(Number(record.last_reset_timestamp) || 0)),
    daily_free_used: Math.max(0, Math.floor(Number(record.daily_free_used) || 0)),
    daily_ad_views_today: Math.max(0, Math.floor(Number(record.daily_ad_views_today) || 0)),
    updated_at: record.updated_at,
  };
}

/** 写入用户积分档案（余额与每日计数一并落盘，保持单一真相） */
export function setCreditProfile(profile: CreditProfile): CreditRecord {
  const store = readStore();
  const record: CreditRecord = {
    user_id: profile.user_id,
    credits: Math.max(0, Math.floor(profile.credits)),
    last_reset_timestamp: Math.max(0, Math.floor(profile.last_reset_timestamp)),
    daily_free_used: Math.max(0, Math.floor(profile.daily_free_used)),
    daily_ad_views_today: Math.max(0, Math.floor(profile.daily_ad_views_today)),
    updated_at: profile.updated_at || new Date().toISOString(),
  };
  store[profile.user_id] = record;
  writeStore(store);
  return record;
}
