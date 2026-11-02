import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Type for supported LLM providers
export type LLMProvider = "openai" | "anthropic";

// Configuration for agent creation
export interface AgentConfig {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// Per-provider defaults. Claude's thinking counts toward maxTokens, so it gets more room.
const PROVIDER_DEFAULTS: Record<
  LLMProvider,
  { model: string; maxTokens: number; apiKeyEnvVar: string }
> = {
  openai: { model: "gpt-4o", maxTokens: 4096, apiKeyEnvVar: "OPENAI_API_KEY" },
  anthropic: {
    model: "claude-opus-5-5",
    maxTokens: 16000,
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
  },
};

const DEFAULT_TEMPERATURE = 0.1;

/**
 * Resolve the provider and model from config, then LLM_PROVIDER and LLM_MODEL
 * Blank environment values count as unset, since .env files often leave them empty
 */
export function getLLMSelection(config: AgentConfig = {}) {
  const provider = config.provider ??
    (Deno.env.get("LLM_PROVIDER") || "openai");
  if (!Object.hasOwn(PROVIDER_DEFAULTS, provider)) {
    throw new Error(
      `Unknown LLM_PROVIDER "${provider}": use "openai" or "anthropic"`,
    );
  }

  const defaults = PROVIDER_DEFAULTS[provider as LLMProvider];
  return {
    provider: provider as LLMProvider,
    model: config.model ?? (Deno.env.get("LLM_MODEL") || defaults.model),
    maxTokens: config.maxTokens ?? defaults.maxTokens,
    apiKeyEnvVar: defaults.apiKeyEnvVar,
  };
}

/**
 * Create an LLM instance based on provider configuration
 * This is the only place a chat provider is chosen
 */
export function createLLM(config: AgentConfig = {}): BaseChatModel {
  const { provider, model, maxTokens, apiKeyEnvVar } = getLLMSelection(config);
  const apiKey = Deno.env.get(apiKeyEnvVar);

  if (provider === "anthropic") {
    return new ChatAnthropic({
      model,
      maxTokens,
      apiKey,
      // @langchain/anthropic 0.3 always sends these, and current Claude models reject them
      invocationKwargs: {
        temperature: undefined,
        top_p: undefined,
        top_k: undefined,
      },
    });
  }

  return new ChatOpenAI({
    model,
    temperature: config.temperature ?? DEFAULT_TEMPERATURE,
    maxTokens,
    apiKey,
  });
}

/**
 * Create a ReAct agent with the given tools and system prompt
 * The agent uses Reason + Act pattern for multi-step problem solving
 */
export function createAgent(
  tools: StructuredToolInterface[],
  systemPrompt: string,
  config: AgentConfig = {},
) {
  const llm = createLLM(config);

  // Create the ReAct agent using LangGraph
  // Type assertion needed due to LangChain type compatibility
  const agent = createReactAgent({
    // deno-lint-ignore no-explicit-any
    llm: llm as any,
    tools,
    // messageModifier prepends the system prompt to conversations
    messageModifier: systemPrompt,
  });

  return agent;
}

/**
 * Execute a query against an agent and return the response
 */
export async function executeQuery(
  // deno-lint-ignore no-explicit-any
  agent: any,
  query: string,
): Promise<string> {
  try {
    const response = await agent.invoke({
      messages: [new HumanMessage(query)],
    });

    // Extract the final response from the agent's message history
    const messages = response.messages;
    const lastMessage = messages[messages.length - 1];

    // .text covers OpenAI's plain strings and Claude's content blocks
    return lastMessage.text;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Agent execution failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Execute a query with conversation history (for multi-turn conversations)
 */
export async function executeQueryWithHistory(
  // deno-lint-ignore no-explicit-any
  agent: any,
  query: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  // Convert history to LangChain message format
  const messages = history.map((msg) =>
    msg.role === "user"
      ? new HumanMessage(msg.content)
      : new AIMessage(msg.content)
  );

  // Add the current query
  messages.push(new HumanMessage(query));

  try {
    const response = await agent.invoke({ messages });

    const responseMessages = response.messages;
    const lastMessage = responseMessages[responseMessages.length - 1];

    return lastMessage.text;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Agent execution failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Stream responses from an agent (for long-running queries)
 */
export async function* streamQuery(
  // deno-lint-ignore no-explicit-any
  agent: any,
  query: string,
): AsyncGenerator<string, void, unknown> {
  const stream = await agent.stream({
    messages: [new HumanMessage(query)],
  });

  for await (const chunk of stream) {
    // Yield intermediate results
    if (chunk.agent?.messages) {
      for (const msg of chunk.agent.messages) {
        if (msg instanceof AIMessage) {
          yield msg.text;
        }
      }
    }
  }
}
