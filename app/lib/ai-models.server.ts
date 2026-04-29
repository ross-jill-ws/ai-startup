import {
  AI_GATEWAY_EXTERNAL_MODELS,
  DEFAULT_CHAT_MODEL,
  FALLBACK_CHAT_MODELS,
  toWorkersAiGatewayModelName,
  type ChatModelInfo,
  type ModelPricing,
} from "./ai-models";

type AiModelsEnv = Env & {
  CLOUDFLARE_API_TOKEN?: string;
  CF_API_TOKEN?: string;
};

type CloudflareListResponse = {
  success?: boolean;
  result?: CloudflareModel[];
  errors?: Array<{ message?: string }>;
};

type CloudflareModel = {
  id?: string;
  name?: string;
  description?: string;
  task?: { name?: string };
  properties?: Array<{ property_id?: string; value?: unknown }>;
};

const MAX_MODELS = 200;
const PAGE_SIZE = 100;

export async function listChatModels(env: Env): Promise<ChatModelInfo[]> {
  const token = getCloudflareApiToken(env);
  if (!token) return FALLBACK_CHAT_MODELS;

  try {
    const models: ChatModelInfo[] = [];

    for (let page = 1; page <= 4 && models.length < MAX_MODELS; page += 1) {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${env.AI_GATEWAY_ACCOUNT_ID}/ai/models/search`,
      );
      url.searchParams.set("per_page", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));

      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        console.warn(
          `Cloudflare AI model catalog request failed: ${response.status} ${response.statusText}`,
        );
        return FALLBACK_CHAT_MODELS;
      }

      const body = (await response.json()) as CloudflareListResponse;
      const result = Array.isArray(body.result) ? body.result : [];
      models.push(...result.flatMap(normalizeCloudflareModel));

      if (result.length < PAGE_SIZE) break;
    }

    return mergeWithFallbacks([...models, ...AI_GATEWAY_EXTERNAL_MODELS]);
  } catch (error) {
    console.warn("Failed to load Cloudflare AI model catalog:", error);
    return FALLBACK_CHAT_MODELS;
  }
}

function normalizeCloudflareModel(model: CloudflareModel): ChatModelInfo[] {
  if (!model.name) return [];
  if (!model.name.startsWith("@cf/") && !model.name.startsWith("@hf/")) return [];
  if (model.task?.name !== "Text Generation") return [];

  const properties = model.properties ?? [];
  const propertyValue = (id: string) =>
    properties.find((property) => property.property_id === id)?.value;
  const contextWindow = Number(propertyValue("context_window"));
  const supportsImages = propertyValue("vision") === "true" || propertyValue("vision") === true;
  const pricing = parseWorkersAiPricing(propertyValue("price"));

  return [
    {
      id: toWorkersAiGatewayModelName(model.name),
      name: model.name,
      description: model.description ?? "Workers AI text generation model.",
      task: model.task.name,
      provider: "Workers AI",
      contextWindow: Number.isFinite(contextWindow) ? contextWindow : undefined,
      supportsImages,
      source: "cloudflare",
      pricing,
    },
  ];
}

export async function getWorkersAiModelPricing(
  env: Env,
  gatewayModelName: string,
): Promise<ModelPricing | undefined> {
  const token = getCloudflareApiToken(env);
  if (!token) return undefined;

  const workersAiModelName = gatewayModelName.startsWith("workers-ai/")
    ? gatewayModelName.slice("workers-ai/".length)
    : gatewayModelName;

  try {
    for (let page = 1; page <= 4; page += 1) {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${env.AI_GATEWAY_ACCOUNT_ID}/ai/models/search`,
      );
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));

      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) return undefined;

      const body = (await response.json()) as CloudflareListResponse;
      const result = Array.isArray(body.result) ? body.result : [];
      const found = result.find((model) => model.name === workersAiModelName);
      if (found) {
        return parseWorkersAiPricing(
          found.properties?.find((property) => property.property_id === "price")?.value,
        );
      }
      if (result.length < 100) break;
    }
  } catch (error) {
    console.warn("Failed to fetch Workers AI model pricing:", error);
  }

  return undefined;
}

function parseWorkersAiPricing(value: unknown): ModelPricing | undefined {
  if (!Array.isArray(value)) return undefined;

  const pricing: ModelPricing = {};
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { unit, price } = item as { unit?: unknown; price?: unknown };
    if (typeof unit !== "string" || typeof price !== "number") continue;

    if (unit === "per M input tokens") pricing.inputPerMillion = price;
    if (unit === "per M output tokens") pricing.outputPerMillion = price;
    if (unit === "per M cached input tokens") pricing.cachedInputPerMillion = price;
  }

  return pricing.inputPerMillion !== undefined ||
    pricing.outputPerMillion !== undefined ||
    pricing.cachedInputPerMillion !== undefined
    ? pricing
    : undefined;
}

function mergeWithFallbacks(models: ChatModelInfo[]) {
  const byName = new Map<string, ChatModelInfo>();

  for (const model of [...models, ...FALLBACK_CHAT_MODELS]) {
    if (!byName.has(model.id)) byName.set(model.id, model);
  }

  return [...byName.values()]
    .sort((a, b) => {
      if (a.id === DEFAULT_CHAT_MODEL) return -1;
      if (b.id === DEFAULT_CHAT_MODEL) return 1;
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      if (a.supportsImages !== b.supportsImages) return a.supportsImages ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_MODELS);
}

function getCloudflareApiToken(env: Env) {
  const token = (env as AiModelsEnv).CLOUDFLARE_API_TOKEN || (env as AiModelsEnv).CF_API_TOKEN;
  return token || null;
}
