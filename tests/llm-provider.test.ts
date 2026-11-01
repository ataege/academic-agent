import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { createLLM, executeQuery } from "../src/agents/base-agent.ts";
import { createStudentAgent } from "../src/agents/student-agent.ts";
import { clearVectorStore } from "../src/rag/course-retriever.ts";
import {
  generateAIReport,
  generateReportHeader,
} from "../src/scheduler/report-agent.ts";
import { sampleData } from "./helpers.ts";

const LLM_ENV_VARS = [
  "LLM_PROVIDER",
  "LLM_MODEL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

const OPENAI_SETTINGS = { OPENAI_API_KEY: "test-key" };
const ANTHROPIC_SETTINGS = {
  LLM_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "test-key",
};

interface MessagesRequest {
  model: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools: { name: string; input_schema: { type: string } }[];
  messages: { role: string; content: unknown[] }[];
}

// Runs with exactly these settings, whatever the developer's shell has exported
async function withLLMEnv(
  settings: Record<string, string>,
  run: () => void | Promise<void>,
) {
  const savedValues = LLM_ENV_VARS.map((name) =>
    [name, Deno.env.get(name)] as const
  );
  LLM_ENV_VARS.forEach((name) => Deno.env.delete(name));
  Object.entries(settings).forEach(([name, value]) =>
    Deno.env.set(name, value)
  );
  try {
    await run();
  } finally {
    for (const [name, value] of savedValues) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

// Answers Messages API calls with scripted replies and records them, so nothing leaves the process
async function withFakeAnthropicApi(
  replies: unknown[][],
  run: (requests: MessagesRequest[]) => Promise<void>,
) {
  const requests: MessagesRequest[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const content = replies[requests.length - 1] as { type: string }[];
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: `msg_${requests.length}`,
          type: "message",
          role: "assistant",
          model: "fake-model",
          content,
          stop_reason: content.some((block) => block.type === "tool_use")
            ? "tool_use"
            : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = realFetch;
  }
}

function assertNoSamplingParameters(request: MessagesRequest) {
  assertEquals(request.temperature, undefined);
  assertEquals(request.top_p, undefined);
  assertEquals(request.top_k, undefined);
}

Deno.test("createLLM defaults to OpenAI with its usual settings", async () => {
  await withLLMEnv(OPENAI_SETTINGS, () => {
    const llm = createLLM() as ChatOpenAI;

    assertInstanceOf(llm, ChatOpenAI);
    assertEquals(llm.model, "gpt-4o");
    assertEquals(llm.temperature, 0.1);
    assertEquals(llm.maxTokens, 4096);
  });
});

Deno.test("createLLM passes a caller's temperature to OpenAI", async () => {
  await withLLMEnv(OPENAI_SETTINGS, () => {
    const llm = createLLM({ temperature: 0.3 }) as ChatOpenAI;

    assertEquals(llm.temperature, 0.3);
  });
});

Deno.test("createLLM selects Anthropic with a Claude model, never OpenAI's", async () => {
  await withLLMEnv(ANTHROPIC_SETTINGS, () => {
    const llm = createLLM() as ChatAnthropic;

    assertInstanceOf(llm, ChatAnthropic);
    assertEquals(llm.model, "claude-opus-5-5");
  });
});

Deno.test("createLLM reads the model from LLM_MODEL for either provider", async () => {
  await withLLMEnv({ ...OPENAI_SETTINGS, LLM_MODEL: "gpt-custom" }, () => {
    assertEquals((createLLM() as ChatOpenAI).model, "gpt-custom");
  });
  await withLLMEnv(
    { ...ANTHROPIC_SETTINGS, LLM_MODEL: "claude-custom" },
    () => {
      assertEquals((createLLM() as ChatAnthropic).model, "claude-custom");
    },
  );
});

Deno.test("createLLM lets explicit config override the environment", async () => {
  await withLLMEnv(
    {
      ...OPENAI_SETTINGS,
      ANTHROPIC_API_KEY: "test-key",
      LLM_MODEL: "gpt-custom",
    },
    () => {
      const llm = createLLM({
        provider: "anthropic",
        model: "claude-custom",
      }) as ChatAnthropic;

      assertInstanceOf(llm, ChatAnthropic);
      assertEquals(llm.model, "claude-custom");
    },
  );
});

Deno.test("createLLM treats blank settings from .env as unset", async () => {
  await withLLMEnv(
    { ...OPENAI_SETTINGS, LLM_PROVIDER: "", LLM_MODEL: "" },
    () => {
      const llm = createLLM() as ChatOpenAI;

      assertInstanceOf(llm, ChatOpenAI);
      assertEquals(llm.model, "gpt-4o");
    },
  );
});

Deno.test("createLLM rejects an unknown provider by name", async () => {
  for (const unknownProvider of ["gemini", "constructor"]) {
    await withLLMEnv({ LLM_PROVIDER: unknownProvider }, () => {
      assertThrows(() => createLLM(), Error, unknownProvider);
    });
  }
});

Deno.test("a student agent runs its tool loop against the Anthropic API", async () => {
  const thinkingBlock = { type: "thinking", thinking: "", signature: "sig-1" };

  await withLLMEnv(ANTHROPIC_SETTINGS, () =>
    withFakeAnthropicApi(
      [
        [thinkingBlock, {
          type: "tool_use",
          id: "toolu_1",
          name: "get_student_profile",
          input: {},
        }],
        [thinkingBlock, { type: "text", text: "You are in good standing." }],
      ],
      async (requests) => {
        const agent = createStudentAgent(sampleData, "STU001");

        const answer = await executeQuery(agent, "How am I doing?");

        // Plain text, not the JSON of Claude's content blocks
        assertEquals(answer, "You are in good standing.");
        assertEquals(requests.length, 2);
        requests.forEach(assertNoSamplingParameters);
        assertEquals(requests[0].model, "claude-opus-5-5");
        assertEquals(requests[0].tools.length, 7);
        for (const tool of requests[0].tools) {
          assertEquals(tool.input_schema.type, "object", tool.name);
        }

        const [, assistantTurn, toolResultTurn] = requests[1].messages;
        // Claude requires its thinking blocks back unchanged
        assertEquals(assistantTurn.content[0], thinkingBlock);
        // The real tool ran and its output was sent back
        assertStringIncludes(
          JSON.stringify(toolResultTurn.content),
          "Emily Johnson",
        );
      },
    ));
});

Deno.test("a Claude agent still answers when course search has no OpenAI key", async () => {
  clearVectorStore();

  await withLLMEnv(ANTHROPIC_SETTINGS, () =>
    withFakeAnthropicApi(
      [
        [{
          type: "tool_use",
          id: "toolu_1",
          name: "search_courses_by_topic",
          input: { query: "machine learning" },
        }],
        [{ type: "text", text: "Course search is unavailable." }],
      ],
      async (requests) => {
        const agent = createStudentAgent(sampleData, "STU001");

        const answer = await executeQuery(agent, "Any AI courses?");

        assertEquals(answer, "Course search is unavailable.");
        // The failure reached the model as a tool result instead of ending the run
        assertStringIncludes(
          JSON.stringify(requests[1].messages[2].content),
          "Error",
        );
      },
    ));
});

Deno.test("generateAIReport uses the selected provider and returns plain text", async () => {
  await withLLMEnv(ANTHROPIC_SETTINGS, () =>
    withFakeAnthropicApi(
      [[
        { type: "thinking", thinking: "", signature: "sig-1" },
        { type: "text", text: "## Findings" },
      ]],
      async (requests) => {
        assertEquals(
          await generateAIReport("at-risk", sampleData),
          "## Findings",
        );
        assertNoSamplingParameters(requests[0]);
      },
    ));
});

Deno.test("generateReportHeader names the model that wrote the report", async () => {
  await withLLMEnv(ANTHROPIC_SETTINGS, () => {
    assertStringIncludes(generateReportHeader("Report"), "claude-opus-5-5");
  });
  await withLLMEnv({ LLM_MODEL: "gpt-custom" }, () => {
    assertStringIncludes(generateReportHeader("Report"), "gpt-custom");
  });
});
