// 只读 GPT 产品模型上游预检。
//
// direct OpenAI 使用两个精确 GET /v1/models/{id}；Vercel AI Gateway 使用
// 一个 GET /v1/models 并原子确认两个 creator/model slug。两个上游独立探测，
// Gateway 原子通过时优先；否则选 direct。该选择用于后续单一 GPT 上游路由，
// 每个用户请求不跨上游重试。脚本不会调用生成端点、输出密钥或输出上游正文。
//
// 用法：在本机/服务器环境中设置以下任一或两个变量后运行：
//   npm run preflight:openai-models
//
// OPENAI_API_KEY 与 AI_GATEWAY_API_KEY 均只能通过安全的服务端环境配置。

import { pathToFileURL } from 'node:url';

export const OPENAI_MODEL_IDS = Object.freeze(['gpt-5.5', 'gpt-5.6-luna']);
export const OPENAI_GATEWAY_SLUGS = Object.freeze({
  'gpt-5.5': 'openai/gpt-5.5',
  'gpt-5.6-luna': 'openai/gpt-5.6-luna',
});
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
export const AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
export const DEFAULT_PREFLIGHT_TIMEOUT_MS = 5_000;

const classifyStatus = (status) => {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'http-error';
};

const statusRows = (upstream, status, reason) =>
  OPENAI_MODEL_IDS.map((model) => ({ upstream, model, status, reason }));

const probeOneDirectModel = async ({ model, apiKey, fetchImpl, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${OPENAI_API_BASE_URL}/models/${encodeURIComponent(model)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { upstream: 'direct', model, status: 'failed', reason: classifyStatus(response.status) };
    }
    let metadata;
    try {
      metadata = await response.json();
    } catch {
      return { upstream: 'direct', model, status: 'failed', reason: 'malformed-metadata' };
    }
    if (!metadata || metadata.id !== model) {
      return { upstream: 'direct', model, status: 'failed', reason: 'model-id-mismatch' };
    }
    return { upstream: 'direct', model, status: 'ok', reason: 'exact-model-id' };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : 'network';
    return { upstream: 'direct', model, status: 'failed', reason };
  } finally {
    clearTimeout(timer);
  }
};

const probeDirect = async ({ apiKey, fetchImpl, timeoutMs }) => {
  if (!apiKey) return { ok: false, results: statusRows('direct', 'skipped', 'missing-key') };
  const results = await Promise.all(
    OPENAI_MODEL_IDS.map((model) => probeOneDirectModel({ model, apiKey, fetchImpl, timeoutMs }))
  );
  return { ok: results.every((entry) => entry.status === 'ok'), results };
};

const probeGateway = async ({ apiKey, fetchImpl, timeoutMs }) => {
  if (!apiKey) return { ok: false, results: statusRows('gateway', 'skipped', 'missing-key') };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${AI_GATEWAY_BASE_URL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, results: statusRows('gateway', 'failed', classifyStatus(response.status)) };
    }
    let metadata;
    try {
      metadata = await response.json();
    } catch {
      return { ok: false, results: statusRows('gateway', 'failed', 'malformed-metadata') };
    }
    const ids = new Set(
      metadata && Array.isArray(metadata.data)
        ? metadata.data.map((entry) => entry && entry.id).filter((id) => typeof id === 'string')
        : []
    );
    const results = OPENAI_MODEL_IDS.map((model) => ({
      upstream: 'gateway',
      model,
      status: ids.has(OPENAI_GATEWAY_SLUGS[model]) ? 'ok' : 'failed',
      reason: ids.has(OPENAI_GATEWAY_SLUGS[model]) ? 'exact-gateway-slug' : 'model-id-mismatch',
    }));
    return { ok: results.every((entry) => entry.status === 'ok'), results };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, results: statusRows('gateway', 'failed', reason) };
  } finally {
    clearTimeout(timer);
  }
};

export const probeAIModelUpstreams = async ({
  openAIKey = process.env.OPENAI_API_KEY || '',
  gatewayKey = process.env.AI_GATEWAY_API_KEY || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      selectedUpstream: null,
      upstreams: {
        direct: { ok: false, results: statusRows('direct', 'failed', 'fetch-unavailable') },
        gateway: { ok: false, results: statusRows('gateway', 'failed', 'fetch-unavailable') },
      },
    };
  }
  const [gateway, direct] = await Promise.all([
    probeGateway({ apiKey: gatewayKey, fetchImpl, timeoutMs }),
    probeDirect({ apiKey: openAIKey, fetchImpl, timeoutMs }),
  ]);
  const selectedUpstream = gateway.ok ? 'gateway' : direct.ok ? 'direct' : null;
  return {
    ok: selectedUpstream !== null,
    selectedUpstream,
    upstreams: { direct, gateway },
  };
};

// 保留原脚本导出名，供已有自动化调用；返回值现包含两个上游的独立证据。
export const probeOpenAIModels = probeAIModelUpstreams;

const main = async () => {
  const result = await probeAIModelUpstreams();
  for (const upstreamName of ['gateway', 'direct']) {
    for (const entry of result.upstreams[upstreamName].results) {
      console.log(
        `${entry.status === 'ok' ? 'PASS' : 'FAIL'} ${entry.upstream} ${entry.model}: ${entry.reason}`
      );
    }
  }
  console.log(
    result.ok
      ? `PASS 原子模型访问；下一缓存周期选用唯一 GPT 上游：${result.selectedUpstream}`
      : 'FAIL 任一上游均未原子证明两个模型'
  );
  if (!result.ok) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('FAIL 模型预检：内部错误');
    process.exitCode = 1;
  });
}
