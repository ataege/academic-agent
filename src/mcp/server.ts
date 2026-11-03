import {
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import type { StructuredToolInterface } from "@langchain/core/tools";
import * as z from "zod/v4";
import type { AcademicData } from "../types/academic.ts";
import { findCourse } from "../data/loader.ts";
import { createStudentTools } from "../tools/student-tools.ts";
import { createDeanTools } from "../tools/dean-tools.ts";
import {
  DEAN_TOOL_SCHEMAS,
  STUDENT_TOOL_SCHEMAS,
  type ToolSchemas,
} from "./tool-schemas.ts";

export type ServerRole = "student" | "dean";

export interface AcademicServerOptions {
  data: AcademicData;
  role: ServerRole;
  // Required for the student role: every student tool is bound to this ID
  studentId?: string;
}

const JSON_MIME = "application/json";

/**
 * Build an MCP server exposing one role's tools, resources and prompts
 * The tools are the agents' LangChain tools, so all logic stays in src/analysis
 */
export function createAcademicServer(
  { data, role, studentId }: AcademicServerOptions,
): McpServer {
  if (role === "student" && !data.students.some((s) => s.id === studentId)) {
    throw new Error(`Unknown student ID: ${studentId ?? "(none)"}`);
  }

  const server = new McpServer(
    { name: "academic-agent", version: "1.0.0" },
    {
      instructions: role === "student"
        ? `Academic advising tools for student ${studentId}. Every tool reads only this student's records. The data is synthetic.`
        : "Institution-wide academic analytics for a dean. All tools are read-only. The data is synthetic.",
    },
  );

  if (role === "student") {
    registerTools(
      server,
      createStudentTools(data, studentId!),
      STUDENT_TOOL_SCHEMAS,
    );
  } else {
    registerTools(server, createDeanTools(data), DEAN_TOOL_SCHEMAS);
  }
  registerResources(server, data, role);
  registerPrompts(server, data, role);

  return server;
}

/**
 * Re-register LangChain tools as MCP tools with the same names, descriptions and output
 */
function registerTools(
  server: McpServer,
  langchainTools: StructuredToolInterface[],
  schemasByName: Record<string, ToolSchemas>,
) {
  for (const langchainTool of langchainTools) {
    const schemas = schemasByName[langchainTool.name];
    if (!schemas) throw new Error(`No MCP schema for ${langchainTool.name}`);

    server.registerTool(
      langchainTool.name,
      {
        description: langchainTool.description,
        inputSchema: schemas.input,
        outputSchema: schemas.output,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args) => {
        const result = JSON.parse(await langchainTool.invoke(args));
        // Tools report a lookup miss as { error }, which the model should see as a failed call
        if (typeof result.error === "string") {
          return {
            content: [{ type: "text", text: result.error }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );
  }
}

function jsonContents(uri: URL, value: unknown) {
  return {
    contents: [{
      uri: uri.href,
      mimeType: JSON_MIME,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function registerResources(
  server: McpServer,
  data: AcademicData,
  role: ServerRole,
) {
  server.registerResource(
    "courses",
    "academic://courses",
    {
      title: "Course catalogue",
      description: "Every course with credits, prerequisites and description",
      mimeType: JSON_MIME,
    },
    (uri) => jsonContents(uri, data.courses),
  );

  server.registerResource(
    "course",
    new ResourceTemplate("academic://courses/{code}", {
      list: () => ({
        resources: data.courses.map((course) => ({
          uri: `academic://courses/${course.id}`,
          name: course.id,
          title: course.name,
          mimeType: JSON_MIME,
        })),
      }),
    }),
    {
      title: "Course",
      description: "One course by ID, such as CENG101",
      mimeType: JSON_MIME,
    },
    (uri, { code }) => {
      const course = findCourse(data, String(code));
      if (!course) throw new ResourceNotFoundError(uri.href);
      return jsonContents(uri, course);
    },
  );

  server.registerResource(
    "grading-scale",
    "academic://grading-scale",
    {
      title: "Grading scale",
      description:
        "Letter grade brackets with GPA points, and midterm and final weights",
      mimeType: JSON_MIME,
    },
    (uri) =>
      jsonContents(uri, {
        gradingScale: data.grading_scale,
        gradeWeights: data.grade_weights,
      }),
  );

  // Full student records are for the dean only; a student session never lists them
  if (role !== "dean") return;

  server.registerResource(
    "student",
    new ResourceTemplate("academic://students/{id}", {
      list: () => ({
        resources: data.students.map((student) => ({
          uri: `academic://students/${student.id}`,
          name: student.id,
          title: student.name,
          mimeType: JSON_MIME,
        })),
      }),
    }),
    {
      title: "Student record",
      description: "One student's full record, including every enrollment",
      mimeType: JSON_MIME,
    },
    (uri, { id }) => {
      const student = data.students.find((s) => s.id === String(id));
      if (!student) throw new ResourceNotFoundError(uri.href);
      return jsonContents(uri, student);
    },
  );
}

function userPrompt(text: string) {
  return {
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text },
    }],
  };
}

function registerPrompts(
  server: McpServer,
  data: AcademicData,
  role: ServerRole,
) {
  if (role === "student") {
    server.registerPrompt(
      "advising-session",
      {
        title: "Advising session",
        description:
          "Review my standing, flag risks and suggest next semester's courses",
      },
      () =>
        userPrompt(
          "Run an advising session for me. Use get_student_profile and get_current_courses to review my standing, " +
            "get_at_risk_courses to flag any course I could fail, and get_graduation_progress to check I'm on track. " +
            "Then use get_recommendations to suggest courses for next semester. " +
            "Quote numbers only from the tool results, and finish with two to four concrete next steps.",
        ),
    );
    return;
  }

  const departmentIds = data.departments.map((d) => d.id) as [
    string,
    ...string[],
  ];
  server.registerPrompt(
    "at-risk-review",
    {
      title: "At-risk review",
      description:
        "List at-risk students and propose interventions, optionally for one department",
      argsSchema: z.object({
        department: z.enum(departmentIds).optional().describe(
          `Department ID: ${departmentIds.join(" or ")}`,
        ),
      }),
    },
    ({ department }) =>
      userPrompt(
        `Review the at-risk students${
          department ? ` in the ${department} department` : ""
        }. ` +
          "Use get_all_at_risk_students to list them with their risk factors" +
          (department
            ? `, and get_department_statistics for ${department} to show the context. `
            : ". ") +
          "Then use get_intervention_recommendations to propose interventions, most urgent first. " +
          "Quote numbers only from the tool results.",
      ),
  );
}
