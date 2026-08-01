#!/usr/bin/env node
/**
 * bind-domain.mjs — 一键把自定义域名接入 Vercel 项目, 并将 DNS/SSL 托管到 Cloudflare。
 *
 * 自动化流程:
 *   1) Cloudflare: 确保 DNS 记录存在 (apex A → 76.76.21.21, www CNAME → cname.vercel-dns.com, 均开启代理橙云)
 *   2) Vercel: 把域名 (apex + www) 加入项目并触发证书签发 (需 VERCEL_TOKEN)
 *   3) 输出访问地址与后续检查步骤
 *
 * 用法:
 *   node scripts/bind-domain.mjs example.com                # dry-run: 只打印计划
 *   node scripts/bind-domain.mjs example.com --apply        # 真正执行
 *   node scripts/bind-domain.mjs example.com --apply --project calorie-ai
 *
 * 环境变量:
 *   CLOUDFLARE_API_TOKEN  必填 (Zone.DNS:Edit + Zone.Zone:Read)
 *   CLOUDFLARE_ZONE_ID    必填
 *   VERCEL_TOKEN          可选 (不提供则跳过 Vercel 域名添加, 仅输出指引)
 *   VERCEL_PROJECT        可选, 默认 "calorie-ai"
 *
 * 幂等: 已存在的 DNS 记录 / 已添加的域名会自动跳过。
 */
import { env } from "node:process";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
let domain = null;
let project = env.VERCEL_PROJECT || "calorie-ai";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--project") {
    project = args[i + 1] || project;
    i++;
  } else if (!a.startsWith("--")) {
    domain = a;
  }
}

const CF_TOKEN = env.CLOUDFLARE_API_TOKEN || "";
const CF_ZONE = env.CLOUDFLARE_ZONE_ID || "";
const VERCEL_TOKEN = env.VERCEL_TOKEN || "";

const VERCEL_IP = "76.76.21.21";
const VERCEL_CNAME = "cname.vercel-dns.com";

if (!domain) {
  console.error("❌ 用法: node scripts/bind-domain.mjs <domain> [--apply] [--project <name>]");
  console.error("   环境变量: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID (必填), VERCEL_TOKEN / VERCEL_PROJECT (可选)");
  process.exit(1);
}
if (!CF_TOKEN || !CF_ZONE) {
  console.error("❌ 缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID");
  process.exit(1);
}

const log = (...a) => console.log(...a);
const step = (s) => log(`\n── ${s} ──`);

async function cfRequest(path, options = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`Cloudflare API ${res.status}: ${JSON.stringify(data.errors || data)}`.slice(0, 500));
  }
  return data;
}

async function ensureDnsRecord(name, type, content, proxied) {
  const records = await cfRequest(`/zones/${CF_ZONE}/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
  const existing = (records.result || []).find((r) => r.type === type && r.name === name);
  if (existing) {
    log(`   · ${type} ${name} → ${existing.content}  (已存在, 跳过${existing.proxied ? ", proxied" : ""})`);
    return;
  }
  const body = { type, name, content, proxied, ttl: 1 };
  if (APPLY) {
    await cfRequest(`/zones/${CF_ZONE}/dns_records`, { method: "POST", body: JSON.stringify(body) });
    log(`   ✔ 已创建 ${type} ${name} → ${content}${proxied ? " (proxied)" : ""}`);
  } else {
    log(`   · [dry-run] 将创建 ${type} ${name} → ${content}${proxied ? " (proxied)" : ""}`);
  }
}

async function addVercelDomains() {
  if (!VERCEL_TOKEN) {
    log("   · 未提供 VERCEL_TOKEN, 跳过 Vercel 域名添加。");
    log(`   · 请手动在 Vercel 控制台为项目 ${project} 添加: ${domain} 与 www.${domain}`);
    return;
  }
  const base = "https://api.vercel.com";
  const headers = { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" };
  for (const name of [domain, `www.${domain}`]) {
    const add = await fetch(`${base}/v9/projects/${project}/domains`, { method: "POST", headers, body: JSON.stringify({ name }) });
    const addData = await add.json().catch(() => ({}));
    if (!add.ok) {
      if (/already/i.test(JSON.stringify(addData))) log(`   · ${name} 已存在于 Vercel 项目 ${project}, 跳过添加`);
      else throw new Error(`Vercel add domain ${add.status}: ${JSON.stringify(addData)}`.slice(0, 500));
    } else {
      log(`   ✔ 已将 ${name} 加入 Vercel 项目 ${project}`);
    }
    if (APPLY) {
      const verify = await fetch(`${base}/v10/projects/${project}/domains/${name}/verify`, { method: "POST", headers });
      log(`   · 证书签发触发 verify(${name}): HTTP ${verify.status}`);
    } else {
      log(`   · [dry-run] 将触发证书签发 verify(${name})`);
    }
  }
}

async function main() {
  log(`域名: ${domain}  |  项目: ${project}  |  模式: ${APPLY ? "APPLY" : "dry-run"}`);
  step("1/3 Cloudflare DNS 记录");
  await ensureDnsRecord(domain, "A", VERCEL_IP, true);
  await ensureDnsRecord(`www.${domain}`, "CNAME", VERCEL_CNAME, true);
  step("2/3 Vercel 项目域名");
  await addVercelDomains();
  step("3/3 完成");
  log(`访问: https://${domain}  (DNS 传播 + 证书签发后生效)`);
  log(`提示: 可访问 https://${domain} 验证; 证书签发通常几分钟内完成。`);
  if (!APPLY) log("（以上为 dry-run, 确认无误后加 --apply 执行）");
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
