import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Type for supported LLM providers (extensible for future)
export type LLMProvider = "openai";

// Configuration for agent creation
export interface AgentConfig {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// Default configuration
const DEFAULT_CONFIG: Required<AgentConfig> = {
  provider: "openai",
  model: "gpt-4o",
  temperature: 0.1,
  maxTokens: 4096,
};

/**
 * Create an LLM instance based on provider configuration
 */
export function createLLM(config: AgentConfig = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Currently supporting OpenAI (extensible)
  return new ChatOpenAI({
    model: mergedConfig.model,
    temperature: mergedConfig.temperature,
    maxTokens: mergedConfig.maxTokens,
    apiKey: Deno.env.get("OPENAI_API_KEY"),
  });
}

/**
 * Create a ReAct agent with the given tools and system prompt
 * The agent uses Reason + Act pattern for multi-step problem solving
 */
export function createAgent(
  tools: StructuredToolInterface[],
  systemPrompt: string,
  config: AgentConfig = {}
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
  query: string
): Promise<string> {
  try {
    const response = await agent.invoke({
      messages: [new HumanMessage(query)],
    });

    // Extract the final response from the agent's message history
    const messages = response.messages;
    const lastMessage = messages[messages.length - 1];

    // Handle different message types
    if (lastMessage instanceof AIMessage) {
      return typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    }

    return String(lastMessage.content);
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
  history: { role: "user" | "assistant"; content: string }[]
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

    if (lastMessage instanceof AIMessage) {
      return typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    }

    return String(lastMessage.content);
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
  query: string
): AsyncGenerator<string, void, unknown> {
  const stream = await agent.stream({
    messages: [new HumanMessage(query)],
  });

  for await (const chunk of stream) {
    // Yield intermediate results
    if (chunk.agent?.messages) {
      for (const msg of chunk.agent.messages) {
        if (msg instanceof AIMessage && typeof msg.content === "string") {
          yield msg.content;
        }
      }
    }
  }
}
