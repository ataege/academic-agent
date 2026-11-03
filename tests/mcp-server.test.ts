import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createAcademicServer, type ServerRole } from "../src/mcp/server.ts";
import { parseStartupOptions } from "../src/mcp/main.ts";
import {
  DEAN_TOOL_SCHEMAS,
  STUDENT_TOOL_SCHEMAS,
} from "../src/mcp/tool-schemas.ts";
import {
  clearVectorStore,
  initializeCourseVectorStore,
} from "../src/rag/course-retriever.ts";
import { localEmbeddings, sampleData } from "./helpers.ts";

const STUDENT_TOOL_NAMES = [
  "get_student_profile",
  "get_current_courses",
  "get_at_risk_courses",
  "get_graduation_progress",
  "get_course_history",
  "get_recommendations",
  "search_courses_by_topic",
];
const DEAN_TOOL_NAMES = [
  "get_all_at_risk_students",
  "get_department_statistics",
  "get_institution_overview",
  "get_course_performance_report",
  "get_student_details",
  "get_intervention_recommendations",
];

// Valid arguments for the tools that take any
const SAMPLE_ARGUMENTS: Record<string, Record<string, string>> = {
  search_courses_by_topic: { query: "machine learning neural networks" },
  get_department_statistics: { departmentId: "CENG" },
  get_course_performance_report: { courseId: "MATH102" },
  get_student_details: { studentId: "STU003" },
};

// Connects a real MCP client to the server in memory, so every call goes through the protocol
async function withClient(
  role: ServerRole,
  run: (client: Client) => Promise<void>,
  studentId = "STU001",
) {
  const server = createAcademicServer({ data: sampleData, role, studentId });
  const [clientTransport, serverTransport] = InMemoryTransport
    .createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  return await client.callTool({ name, arguments: args });
}

async function readJson(client: Client, uri: string) {
  const [contents] = (await client.readResource({ uri })).contents;
  return JSON.parse("text" in contents ? contents.text : "");
}

function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])
    .map((block) => block.text)
    .join("");
}

Deno.test("student mode lists only the student tools, all read-only", async () => {
  await withClient("student", async (client) => {
    const { tools } = await client.listTools();

    assertEquals(tools.map((tool) => tool.name), STUDENT_TOOL_NAMES);
    for (const tool of tools) {
      assertEquals(tool.annotations?.readOnlyHint, true, tool.name);
      assertEquals(tool.annotations?.openWorldHint, false, tool.name);
      assertEquals(tool.outputSchema?.type, "object", tool.name);
    }
  });
});

Deno.test("dean mode lists only the dean tools", async () => {
  await withClient("dean", async (client) => {
    const { tools } = await client.listTools();

    assertEquals(tools.map((tool) => tool.name), DEAN_TOOL_NAMES);
    assert(tools.every((tool) => tool.annotations?.readOnlyHint === true));
  });
});

Deno.test("every student tool returns structured output matching its schema", async () => {
  clearVectorStore();
  await initializeCourseVectorStore(sampleData, localEmbeddings);

  for (const studentId of ["STU001", "STU003", "STU005"]) {
    await withClient("student", async (client) => {
      for (const name of STUDENT_TOOL_NAMES) {
        const result = await callTool(client, name, SAMPLE_ARGUMENTS[name]);

        assert(!result.isError, `${studentId} ${name}: ${textOf(result)}`);
        // Strict schemas, so a field the schema doesn't list fails here
        STUDENT_TOOL_SCHEMAS[name].output.parse(result.structuredContent);
        assertEquals(JSON.parse(textOf(result)), result.structuredContent);
      }
    }, studentId);
  }
  clearVectorStore();
});

Deno.test("every dean tool returns structured output matching its schema", async () => {
  await withClient("dean", async (client) => {
    for (const name of DEAN_TOOL_NAMES) {
      const result = await callTool(client, name, SAMPLE_ARGUMENTS[name]);

      assert(!result.isError, `${name}: ${textOf(result)}`);
      DEAN_TOOL_SCHEMAS[name].output.parse(result.structuredContent);
    }
  });
});

Deno.test("a student session is pinned to its student", async () => {
  await withClient("student", async (client) => {
    const profile = await callTool(client, "get_student_profile");
    assertEquals(
      (profile.structuredContent as { id: string }).id,
      "STU005",
    );

    // The same numbers the agent sees: 82% on the MATH 102 final to pass
    const atRisk = await callTool(client, "get_at_risk_courses");
    const courses = (atRisk.structuredContent as {
      courses: { courseCode: string; requiredFinalForPass: number }[];
    }).courses;
    assertEquals(courses[0], {
      ...courses[0],
      courseCode: "MATH 102",
      requiredFinalForPass: 82,
    });
  }, "STU005");
});

Deno.test("student mode can't reach dean tools or student records", async () => {
  await withClient("student", async (client) => {
    // An unregistered tool is a protocol error, so the call never reaches the data
    await assertRejects(
      () => callTool(client, "get_student_details", { studentId: "STU003" }),
      Error,
      "not found",
    );

    const { resourceTemplates } = await client.listResourceTemplates();
    assertEquals(
      resourceTemplates.map((template) => template.uriTemplate),
      ["academic://courses/{code}"],
    );
    await assertRejects(() =>
      client.readResource({ uri: "academic://students/STU003" })
    );
  });
});

Deno.test("bad tool input comes back as a tool error, not a crash", async () => {
  await withClient("dean", async (client) => {
    const unknownCourse = await callTool(
      client,
      "get_course_performance_report",
      { courseId: "NOPE999" },
    );
    assert(unknownCourse.isError);
    assertStringIncludes(textOf(unknownCourse), "NOPE999");

    const badDepartment = await callTool(
      client,
      "get_department_statistics",
      { departmentId: "ARTS" },
    );
    assert(badDepartment.isError);

    const blankStudent = await callTool(client, "get_student_details", {
      studentId: "   ",
    });
    assert(blankStudent.isError);

    const unknownStudent = await callTool(client, "get_student_details", {
      studentId: "Nobody",
    });
    assert(unknownStudent.isError);
    assertStringIncludes(textOf(unknownStudent), "Nobody");

    // The server keeps answering after the errors
    const overview = await callTool(client, "get_institution_overview");
    assert(!overview.isError);
  });
});

Deno.test("course search without an OpenAI key is a tool error", async () => {
  clearVectorStore();
  const savedKey = Deno.env.get("OPENAI_API_KEY");
  Deno.env.delete("OPENAI_API_KEY");
  try {
    await withClient("student", async (client) => {
      const result = await callTool(client, "search_courses_by_topic", {
        query: "databases",
      });
      assert(result.isError);
    });
  } finally {
    if (savedKey !== undefined) Deno.env.set("OPENAI_API_KEY", savedKey);
    clearVectorStore();
  }
});

Deno.test("resources expose the catalogue, one course and the grading scale", async () => {
  await withClient("student", async (client) => {
    const { resources } = await client.listResources();
    const uris = resources.map((resource) => resource.uri);
    assert(uris.includes("academic://courses"));
    assert(uris.includes("academic://grading-scale"));
    assert(uris.includes("academic://courses/CENG350"));

    const catalogue = await readJson(client, "academic://courses");
    assertEquals(
      catalogue.length,
      23,
    );

    const course = await readJson(client, "academic://courses/CENG350");
    assertEquals(
      course.name,
      "Artificial Intelligence",
    );

    const scale = await readJson(client, "academic://grading-scale");
    assertEquals(scale.gradeWeights, {
      midterm: 0.4,
      final: 0.6,
    });

    await assertRejects(() =>
      client.readResource({ uri: "academic://courses/NOPE999" })
    );
  });
});

Deno.test("dean mode can read one student's full record", async () => {
  await withClient("dean", async (client) => {
    const record = await readJson(client, "academic://students/STU003");
    const student = record;

    assertEquals(student.name, "David Wilson");
    assertEquals(student.enrollments.length, 10);
    await assertRejects(() =>
      client.readResource({ uri: "academic://students/STU999" })
    );
  });
});

Deno.test("each role offers its own prompt", async () => {
  await withClient("student", async (client) => {
    const { prompts } = await client.listPrompts();
    assertEquals(prompts.map((prompt) => prompt.name), ["advising-session"]);

    const prompt = await client.getPrompt({ name: "advising-session" });
    assertStringIncludes(
      JSON.stringify(prompt.messages),
      "get_recommendations",
    );
  });

  await withClient("dean", async (client) => {
    const { prompts } = await client.listPrompts();
    assertEquals(prompts.map((prompt) => prompt.name), ["at-risk-review"]);

    const forDepartment = await client.getPrompt({
      name: "at-risk-review",
      arguments: { department: "CENG" },
    });
    assertStringIncludes(JSON.stringify(forDepartment.messages), "CENG");

    const forEveryone = await client.getPrompt({ name: "at-risk-review" });
    assert(!JSON.stringify(forEveryone.messages).includes("CENG"));

    await assertRejects(() =>
      client.getPrompt({
        name: "at-risk-review",
        arguments: { department: "ARTS" },
      })
    );
  });
});

Deno.test("createAcademicServer refuses a student session without a valid ID", () => {
  assertThrows(
    () => createAcademicServer({ data: sampleData, role: "student" }),
    Error,
    "Unknown student ID",
  );
  assertThrows(
    () =>
      createAcademicServer({
        data: sampleData,
        role: "student",
        studentId: "Emily",
      }),
    Error,
    "Emily",
  );
});

Deno.test("parseStartupOptions accepts valid flags with stdio defaults", () => {
  assertEquals(
    parseStartupOptions(["--role=student", "--student", "STU001"], sampleData),
    {
      role: "student",
      studentId: "STU001",
      transport: "stdio",
      hostname: "127.0.0.1",
      port: 3000,
      authToken: undefined,
    },
  );
  assertEquals(
    parseStartupOptions(
      ["--role=dean", "--transport=http", "--port=8080"],
      sampleData,
      { MCP_AUTH_TOKEN: "secret" },
    ).port,
    8080,
  );
});

Deno.test("parseStartupOptions fails fast on bad flags", () => {
  const badFlags: [string[], string][] = [
    [[], "--role"],
    [["--role=admin"], "--role"],
    [["--role=student"], "--student"],
    [["--role=student", "--student=Emily"], "--student"],
    [["--role=dean", "--transport=sse"], "--transport"],
    [["--role=dean", "--port=99999"], "--port"],
    [["--role=dean", "--transport=http"], "MCP_AUTH_TOKEN"],
  ];

  for (const [args, message] of badFlags) {
    assertThrows(
      () => parseStartupOptions(args, sampleData),
      Error,
      message,
      args.join(" "),
    );
  }
});
