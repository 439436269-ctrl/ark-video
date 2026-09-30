#!/usr/bin/env node
'use strict';

/**
 * ark-video — 火山方舟 Seedance 文生视频原子 CLI（零依赖）
 * 能力边界：单条视频的 创建 / 查询 / 用量 / 估价。不含批量编排、剪辑合成、多平台发布。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '1.0.0';
const BASE = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
const DEFAULT_MODEL = 'doubao-seedance-2-0-mini-260615';

// 刊例价（元/百万 token），来源：volcengine model-pricing 2026-09-30
// promo = 限时活动价（Seedance 2.0 mini 4折 / fast 75折，企业用户，~2026-10-07）
const PRICE_TIERS = [
  { match: 'seedance-2.5', list: 70, promo: null, note: '' },
  { match: 'seedance-2.0-mini', list: 23, promo: 9.2, note: '限时4折(企业用户,~2026-10-07)' },
  { match: 'seedance-2.0-fast', list: 37, promo: 27.75, note: '限时75折(企业用户,~2026-10-07)' },
  { match: 'seedance-2.0', list: 46, promo: null, note: '' },
  { match: 'seedance-1.0-pro-fast', list: 4.2, promo: null, note: '' },
  { match: 'seedance-1.0-pro', list: 15, promo: null, note: '' },
];

// 720p/9:16/mini 实测公式（EP11 十三条对账）：tokens = 21600*秒 + 900
function estimateTokens(seconds) {
  return Math.round(21600 * seconds + 900);
}

function normalizeModel(m) {
  // doubao-seedance-2-0-mini-xxx → doubao-seedance-2.0-mini-xxx
  return String(m).replace(/-(\d)-(\d)-/g, '-$1.$2-');
}

function priceTier(model) {
  const m = normalizeModel(model);
  for (const t of PRICE_TIERS) {
    if (m.includes(t.match)) return t;
  }
  return null;
}

function costOf(tokens, tier) {
  if (!tier) return { list: null, promo: null };
  return {
    list: +(tokens / 1e6 * tier.list).toFixed(3),
    promo: tier.promo == null ? null : +(tokens / 1e6 * tier.promo).toFixed(3),
  };
}

function loadKey() {
  const env = process.env.ARK_API_KEY || process.env.ARK_STD_KEY;
  if (env && env.trim()) return env.trim();
  const cfg = path.join(os.homedir(), '.ark-video', 'config.json');
  try {
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    if (j.apiKey && String(j.apiKey).trim()) return String(j.apiKey).trim();
  } catch (_) { /* no config */ }
  return null;
}

function die(msg, code) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code == null ? 1 : code);
}

async function api(method, url, body, key) {
  const headers = { 'Authorization': 'Bearer ' + key };
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    die('网络错误: ' + e.message);
  }
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (_) {
    die(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const msg = (j.error && (j.error.message || j.error.code)) || j.message || text.slice(0, 300);
    die(`API ${res.status}: ${msg}` + (res.status === 401 ? '\n（提示: 标准 key 打 /api/v3；Agent Plan key 应走 /api/plan/v3，混用必 401）' : ''));
  }
  return j;
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { args.flags[k] = next; i++; }
      else args.flags[k] = true;
    } else args._.push(a);
  }
  return args;
}

function help() {
  process.stdout.write(`ark-video v${VERSION} — 火山方舟 Seedance 文生视频（原子能力，单条为限）

用法:
  ark-video create --prompt <文字描述> [选项]   创建并等待下载一条视频
  ark-video task <taskId> [--json]              查询任务状态（含 usage）
  ark-video usage <taskId>                      查任务 token 用量与金额
  ark-video price [--seconds N] [--model M]     离线估算 token 与金额（不联网）

create 选项:
  --prompt <s>        必填，画面与镜头描述（文字不要画进画面）
  --duration <n>      秒数，默认 5（实测 5~14 OK，2 秒被 400 拒；上限以报错为准）
  --ratio <s>         默认 9:16（可选 16:9 / 1:1）
  --resolution <s>    默认 720p（可选 480p）
  --model <s>         默认 ${DEFAULT_MODEL}
  --out <file>        输出文件，默认 video-<taskId>.mp4
  --audio             附带生成音频（默认关）
  --timeout <s>       轮询超时秒数，默认 1200
  --json              机器可读输出

Key 配置（三选一，优先级从高到低）:
  1) 环境变量 ARK_API_KEY（或 ARK_STD_KEY）
  2) ~/.ark-video/config.json  {"apiKey": "..."}

说明: 本工具只有单条生成的原子命令——批量请在外层循环调用；
      剪辑合成/多平台发布不在此工具范围。
`);
}

async function cmdCreate(args) {
  const key = loadKey();
  if (!key) die('缺少 API key：设置 ARK_API_KEY 或创建 ~/.ark-video/config.json');
  const prompt = args.flags.prompt;
  if (!prompt || prompt === true) die('缺少 --prompt');
  const model = args.flags.model || DEFAULT_MODEL;
  const duration = Number(args.flags.duration || 5);
  if (!Number.isFinite(duration) || duration <= 0) die('--duration 须为正数');
  const body = {
    model,
    content: [{ type: 'text', text: prompt }],
    generate_audio: !!args.flags.audio,
    resolution: args.flags.resolution || '720p',
    ratio: args.flags.ratio || '9:16',
    duration,
    watermark: false,
  };

  const created = await api('POST', BASE, body, key);
  const taskId = created.id || (created.data && created.data.id);
  if (!taskId) die('创建失败: ' + JSON.stringify(created).slice(0, 300));
  if (args.flags.json) process.stderr.write(`task=${taskId}\n`);
  else process.stderr.write(`任务已创建: ${taskId}（模型 ${model} / ${duration}s），轮询中...\n`);

  const timeoutMs = Number(args.flags.timeout || 1200) * 1000;
  const deadline = Date.now() + timeoutMs;
  let st;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    st = await api('GET', `${BASE}/${taskId}`, null, key);
    const s = st.status;
    if (!args.flags.json) process.stderr.write(`  status=${s}\n`);
    if (s === 'succeeded' || s === 'success' || s === 'done' || s === 'finished') break;
    if (s === 'failed' || s === 'cancelled' || s === 'error') {
      const err = st.error || st.message || '';
      die(`生成失败（不计费）: ${typeof err === 'string' ? err : JSON.stringify(err)}`, 2);
    }
    st = null;
  }
  if (!st) die('轮询超时（任务可能仍在排队，可用 ark-video task <id> 继续查）', 2);

  const url = (st.content && st.content.video_url) ||
    ((JSON.stringify(st).match(/https:\/\/[^\s"]+?\.(?:mp4|mov)[^\s"]*/) || [])[0]);
  if (!url) die('succeeded 但未找到 video_url', 2);

  const out = args.flags.out && args.flags.out !== true
    ? args.flags.out
    : `video-${taskId}.mp4`;
  const res = await fetch(url);
  if (!res.ok) die(`下载失败 HTTP ${res.status}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));

  const tokens = st.usage && (st.usage.completion_tokens || st.usage.total_tokens) || null;
  const tier = priceTier(model);
  const cost = tokens ? costOf(tokens, tier) : { list: null, promo: null };
  const info = { taskId, out, model, duration, tokens, costCNY: cost, bytes: fs.statSync(out).size };
  if (args.flags.json) process.stdout.write(JSON.stringify(info) + '\n');
  else {
    process.stdout.write(`完成: ${out} (${info.bytes} B)\n`);
    if (tokens != null) {
      process.stdout.write(`tokens=${tokens}  刊例≈¥${cost.list}` +
        (cost.promo != null ? `  活动价≈¥${cost.promo}` : '') + '\n');
    }
  }
}

async function cmdTask(args, jsonFlag) {
  const key = loadKey();
  if (!key) die('缺少 API key：设置 ARK_API_KEY 或创建 ~/.ark-video/config.json');
  const id = args._[1];
  if (!id) die('用法: ark-video task <taskId>');
  const st = await api('GET', `${BASE}/${id}`, null, key);
  if (jsonFlag || args.flags.json) {
    process.stdout.write(JSON.stringify(st) + '\n');
    return;
  }
  const tokens = st.usage && (st.usage.completion_tokens || st.usage.total_tokens);
  process.stdout.write([
    `id       : ${st.id}`,
    `model    : ${st.model}`,
    `status   : ${st.status}`,
    `duration : ${st.duration}s  ${st.resolution || ''} ${st.ratio || ''}`,
    tokens != null ? `tokens   : ${tokens}` : null,
    st.content && st.content.video_url ? `video_url: ${st.content.video_url.slice(0, 120)}...` : null,
  ].filter(Boolean).join('\n') + '\n');
}

async function cmdUsage(args) {
  const key = loadKey();
  if (!key) die('缺少 API key：设置 ARK_API_KEY 或创建 ~/.ark-video/config.json');
  const id = args._[1];
  if (!id) die('用法: ark-video usage <taskId>');
  const st = await api('GET', `${BASE}/${id}`, null, key);
  const tokens = st.usage && (st.usage.completion_tokens || st.usage.total_tokens);
  if (tokens == null) die('该任务无 usage（' + st.status + '）', 2);
  const tier = priceTier(st.model);
  const cost = costOf(tokens, tier);
  const out = { taskId: st.id, model: st.model, status: st.status, duration: st.duration, tokens };
  if (tier) {
    out.priceCNYperM = { list: tier.list, promo: tier.promo, note: tier.note };
    out.costCNY = cost;
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

function cmdPrice(args) {
  const seconds = Number(args.flags.seconds || 5);
  const model = args.flags.model || DEFAULT_MODEL;
  const tokens = estimateTokens(seconds);
  const tier = priceTier(model);
  const cost = costOf(tokens, tier);
  const out = {
    model, seconds, estTokens: tokens,
    formula: 'tokens = 21600*seconds + 900 (720p/9:16/mini 实测)',
    priceCNYperM: tier ? { list: tier.list, promo: tier.promo, note: tier.note } : null,
    estCostCNY: cost,
  };
  if (args.flags.json) process.stdout.write(JSON.stringify(out) + '\n');
  else {
    process.stdout.write(`模型 ${model} / ${seconds}s ≈ ${tokens} tokens\n`);
    if (tier) {
      process.stdout.write(`刊例 ${tier.list} 元/百万token ≈ ¥${cost.list}` +
        (cost.promo != null ? ` ｜ 活动价 ${tier.promo} 元/百万 ≈ ¥${cost.promo} (${tier.note})` : '') + '\n');
    } else process.stdout.write('（该模型不在价格表内）\n');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0] || (args.flags.prompt ? 'create' : 'help');
  switch (cmd) {
    case 'create': return cmdCreate(args);
    case 'task': return cmdTask(args);
    case 'usage': return cmdUsage(args);
    case 'price': return cmdPrice(args);
    case 'version': case '--version': case '-v':
      process.stdout.write(VERSION + '\n'); return;
    case 'help': case '--help': case '-h':
      help(); return;
    default:
      die(`未知命令: ${cmd}（ark-video help 查看用法）`);
  }
}

main().catch(e => die('错误: ' + (e && e.message || e)));
