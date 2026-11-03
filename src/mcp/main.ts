import { parseArgs } from "@std/cli/parse-args";
import { load } from "@std/dotenv";
import { fromFileUrl } from "@std/path/from-file-url";
import { localhostAllowedHostnames } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadAcademicData } from "../data/loader.ts";
import type { AcademicData } from "../types/academic.ts";
import { createAcademicServer, type ServerRole } from "./server.ts";
import { createHttpHandler } from "./http.ts";

// Resolved from this file, because MCP clients may launch the server from any directory
const DATA_PATH = fromFileUrl(
  new URL("../../data/academic_data.json", import.meta.url),
);
const ENV_PATH = fromFileUrl(new URL("../../.env", import.meta.url));
const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "::1"];

export interface StartupOptions {
  role: ServerRole;
  studentId?: string;
  transport: "stdio" | "http";
  hostname: string;
  port: number;
  authToken?: string;
}

/**
 * Parse and validate command-line flags, failing on anything the server can't run with
 */
export function parseStartupOptions(
  args: string[],
  data: AcademicData,
  env: { MCP_AUTH_TOKEN?: string } = {},
): StartupOptions {
  const flags = parseArgs(args, {
    string: ["role", "student", "transport", "hostname", "port"],
    default: { transport: "stdio", hostname: "127.0.0.1", port: "3000" },
  });

  if (flags.role !== "student" && flags.role !== "dean") {
    throw new Error('--role must be "student" or "dean"');
  }
  // Exact IDs only: a partial name could pin the session to the wrong student
  if (
    flags.role === "student" &&
    !data.students.some((student) => student.id === flags.student)
  ) {
    throw new Error(
      `--student must be a student ID, such as ${data.students[0]?.id}`,
    );
  }
  if (flags.transport !== "stdio" && flags.transport !== "http") {
    throw new Error('--transport must be "stdio" or "http"');
  }

  const port = Number(flags.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be a whole number from 0 to 65535");
  }
  if (flags.transport === "http" && !env.MCP_AUTH_TOKEN) {
    throw new Error("MCP_AUTH_TOKEN must be set to use --transport=http");
  }

  return {
    role: flags.role,
    studentId: flags.role === "student" ? flags.student : undefined,
    transport: flags.transport,
    hostname: flags.hostname,
    port,
    authToken: env.MCP_AUTH_TOKEN,
  };
}

async function main() {
  // Over stdio, stdout carries the protocol, so every log (including the vector store's) goes to stderr
  console.log = console.error;

  await load({ envPath: ENV_PATH, export: true });
  const data = await loadAcademicData(DATA_PATH);

  let options: StartupOptions;
  try {
    options = parseStartupOptions(Deno.args, data, {
      MCP_AUTH_TOKEN: Deno.env.get("MCP_AUTH_TOKEN"),
    });
  } catch (error) {
    console.error(`academic-agent MCP: ${(error as Error).message}`);
    Deno.exit(1);
  }

  const createServer = () =>
    createAcademicServer({
      data,
      role: options.role,
      studentId: options.studentId,
    });

  if (options.transport === "stdio") {
    await createServer().connect(new StdioServerTransport());
    return;
  }

  const handler = createHttpHandler({
    createServer,
    authToken: options.authToken!,
    // Host checks block DNS rebinding locally; a public hostname is left to the proxy in front
    allowedHostnames: LOOPBACK_HOSTNAMES.includes(options.hostname)
      ? localhostAllowedHostnames()
      : undefined,
  });
  Deno.serve({
    hostname: options.hostname,
    port: options.port,
    onListen: ({ hostname, port }) =>
      console.error(
        `academic-agent MCP listening on http://${hostname}:${port}/mcp`,
      ),
  }, handler);
}

if (import.meta.main) await main();
