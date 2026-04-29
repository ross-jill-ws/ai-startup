import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { callable } from "agents";
import {
  convertToModelMessages,
  streamText,
  type LanguageModelUsage,
  type OnFinishEvent,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { getWorkersAiModelPricing } from "../app/lib/ai-models.server";
import {
  DEFAULT_CHAT_MODEL,
  isGatewayChatModelName,
  isWorkersAiGatewayModelName,
  stripWorkersAiGatewayPrefix,
} from "../app/lib/ai-models";

type GatewayEnv = Env & {
  CF_AIG_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BYOK_ALIAS?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BYOK_ALIAS?: string;
  GOOGLE_BYOK_ALIAS?: string;
  GEMINI_API_KEY?: string;
  GEMINI_BYOK_ALIAS?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BYOK_ALIAS?: string;
};

export type ChatUsageState = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  pricedTokens: number;
  unpricedTokens: number;
  turns: number;
  lastModel?: string;
  lastInputTokens?: number;
  lastOutputTokens?: number;
  lastEstimatedCostUsd?: number;
};

const initialUsageState: ChatUsageState = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
  pricedTokens: 0,
  unpricedTokens: 0,
  turns: 0,
};

export class ChatAgent extends AIChatAgent<Env, ChatUsageState> {
  initialState: ChatUsageState = initialUsageState;

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions,
  ) {
    const requestedModel = options?.body?.model;
    const modelName = isGatewayChatModelName(requestedModel)
      ? requestedModel
      : DEFAULT_CHAT_MODEL;

    const result = streamText({
      model: createModel(this.env, modelName),
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      onFinish: async (event) => {
        await onFinish(event);
        await this.recordUsage(modelName, event);
      },
    });

    return result.toUIMessageStreamResponse();
  }

  @callable()
  resetUsage() {
    this.setState(initialUsageState);
  }

  private async recordUsage(modelName: string, event: OnFinishEvent<ToolSet>) {
    const usage = event.totalUsage ?? event.usage;
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
    const estimatedCostUsd = await estimateCostUsd(this.env, modelName, usage);
    const pricedTokens = estimatedCostUsd === undefined ? 0 : totalTokens;
    const unpricedTokens = estimatedCostUsd === undefined ? totalTokens : 0;

    this.setState({
      inputTokens: this.state.inputTokens + inputTokens,
      outputTokens: this.state.outputTokens + outputTokens,
      totalTokens: this.state.totalTokens + totalTokens,
      estimatedCostUsd:
        this.state.estimatedCostUsd + (estimatedCostUsd ?? 0),
      pricedTokens: this.state.pricedTokens + pricedTokens,
      unpricedTokens: this.state.unpricedTokens + unpricedTokens,
      turns: this.state.turns + 1,
      lastModel: modelName,
      lastInputTokens: inputTokens,
      lastOutputTokens: outputTokens,
      lastEstimatedCostUsd: estimatedCostUsd,
    });
  }
}

function createModel(env: Env, modelName: string) {
  const gatewayToken = (env as GatewayEnv).CF_AIG_TOKEN;

  if (gatewayToken) {
    const { provider, providerHeaders } = getGatewayProviderAuth(env, modelName);
    const gateway = createOpenAICompatible({
      name: "cloudflare-ai-gateway",
      baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/compat`,
      headers: {
        "cf-aig-authorization": formatGatewayAuthorization(gatewayToken),
        ...providerHeaders,
      },
      includeUsage: true,
    });

    try {
      return gateway(modelName);
    } catch (error) {
      throw new Error(
        `Failed to create AI Gateway model for ${provider}/${modelName}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  if (isWorkersAiGatewayModelName(modelName)) {
    const workersai = createWorkersAI({ binding: env.AI });
    return workersai(stripWorkersAiGatewayPrefix(modelName));
  }

  throw new Error(
    "CF_AIG_TOKEN is required to use non-Workers-AI models through AI Gateway.",
  );
}

function getGatewayProviderAuth(env: Env, modelName: string): {
  provider: string;
  providerHeaders: Record<string, string>;
} {
  const gatewayEnv = env as GatewayEnv;
  const provider = modelName.split("/", 1)[0];

  if (provider === "workers-ai") {
    return { provider, providerHeaders: {} };
  }

  if (provider === "openai") {
    return {
      provider,
      providerHeaders: byokAliasHeaders(
        gatewayEnv.OPENAI_BYOK_ALIAS ?? gatewayEnv.OPENAI_API_KEY,
      ),
    };
  }

  if (provider === "anthropic") {
    return {
      provider,
      providerHeaders: {
        ...byokAliasHeaders(
          gatewayEnv.ANTHROPIC_BYOK_ALIAS ?? gatewayEnv.ANTHROPIC_API_KEY,
        ),
        "anthropic-version": "2023-06-01",
      },
    };
  }

  if (provider === "google-ai-studio" || provider === "google") {
    return {
      provider,
      providerHeaders: byokAliasHeaders(
        gatewayEnv.GOOGLE_BYOK_ALIAS ??
          gatewayEnv.GEMINI_BYOK_ALIAS ??
          gatewayEnv.GEMINI_API_KEY,
      ),
    };
  }

  if (provider === "deepseek") {
    return {
      provider,
      providerHeaders: byokAliasHeaders(
        gatewayEnv.DEEPSEEK_BYOK_ALIAS ?? gatewayEnv.DEEPSEEK_API_KEY,
      ),
    };
  }

  throw new Error(`Unsupported AI Gateway provider: ${provider}`);
}

function byokAliasHeaders(alias: string | undefined): Record<string, string> {
  return alias ? { "cf-aig-byok-alias": alias } : {};
}

function formatGatewayAuthorization(token: string) {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

type ModelPrice = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
};

const MODEL_PRICES: Record<string, ModelPrice> = {
  "openai/gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "openai/gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "anthropic/claude-haiku-4-5-20251001": {
    inputPerMillion: 1,
    outputPerMillion: 5,
  },
  "anthropic/claude-sonnet-4-6": {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  "anthropic/claude-sonnet-4-5-20250929": {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  "anthropic/claude-sonnet-4-20250514": {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  "google-ai-studio/gemini-2.5-flash": {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
  },
  "google-ai-studio/gemini-2.5-pro": {
    inputPerMillion: 1.25,
    outputPerMillion: 10,
  },
};

async function estimateCostUsd(
  env: Env,
  modelName: string,
  usage: LanguageModelUsage,
) {
  const price = isWorkersAiGatewayModelName(modelName)
    ? await getWorkersAiModelPricing(env, modelName)
    : MODEL_PRICES[modelName];
  if (!price) return undefined;

  const inputPerMillion = price.inputPerMillion;
  const outputPerMillion = price.outputPerMillion;
  if (inputPerMillion === undefined && outputPerMillion === undefined) {
    return undefined;
  }

  const cachedInputTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const inputTokens = Math.max((usage.inputTokens ?? 0) - cachedInputTokens, 0);
  const outputTokens = usage.outputTokens ?? 0;
  const inputCost = (inputTokens / 1_000_000) * (inputPerMillion ?? 0);
  const cachedInputCost =
    (cachedInputTokens / 1_000_000) *
    (price.cachedInputPerMillion ?? inputPerMillion ?? 0);
  const outputCost = (outputTokens / 1_000_000) * (outputPerMillion ?? 0);

  return inputCost + cachedInputCost + outputCost;
}
