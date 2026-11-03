import { assertEquals } from "@std/assert";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { localhostAllowedHostnames } from "@modelcontextprotocol/server";
import { createHttpHandler } from "../src/mcp/http.ts";
import { createAcademicServer } from "../src/mcp/server.ts";
import { sampleData } from "./helpers.ts";

const TOKEN = "test-token";
const MCP_URL = "http://127.0.0.1:3000/mcp";

// Real HTTP requests carry a Host header, which test-built Requests lack
function withHost(input: string | URL | Request, init?: RequestInit) {
  const request = new Request(input, init);
  request.headers.set("host", new URL(request.url).host);
  return request;
}

// The handler is called directly, so these tests need no open port or network permission
const handler = createHttpHandler({
  createServer: () => createAcademicServer({ data: sampleData, role: "dean" }),
  authToken: TOKEN,
  allowedHostnames: localhostAllowedHostnames(),
});

const initializeRequest = (headers: Record<string, string>) =>
  withHost(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw", version: "1" },
      },
    }),
  });

Deno.test("HTTP /health answers without a token", async () => {
  const response = await handler(withHost("http://127.0.0.1:3000/health"));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "ok" });
});

Deno.test("HTTP /mcp rejects a missing or wrong bearer token", async () => {
  for (
    const headers of [
      {},
      { authorization: "Bearer wrong" },
      { authorization: TOKEN },
    ] as Record<string, string>[]
  ) {
    const response = await handler(initializeRequest(headers));
    assertEquals(response.status, 401, JSON.stringify(headers));
    await response.body?.cancel();
  }
});

Deno.test("HTTP /mcp rejects a request from another website", async () => {
  const response = await handler(initializeRequest({
    authorization: `Bearer ${TOKEN}`,
    origin: "https://evil.example",
  }));

  assertEquals(response.status, 403);
  await response.body?.cancel();
});

Deno.test("HTTP rejects a Host header that isn't localhost", async () => {
  const response = await handler(
    withHost("http://attacker.example/health"),
  );

  assertEquals(response.status, 403);
  await response.body?.cancel();
});

Deno.test("HTTP unknown paths are not found", async () => {
  const response = await handler(withHost("http://127.0.0.1:3000/other"));

  assertEquals(response.status, 404);
  await response.body?.cancel();
});

Deno.test("an MCP client with the token can call tools over HTTP", async () => {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    // Routes the client's requests straight into the handler instead of the network
    fetch: (url, init) => handler(withHost(url, init)),
  });
  const client = new Client({ name: "http-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assertEquals(tools.length, 6);

    const overview = await client.callTool({
      name: "get_institution_overview",
      arguments: {},
    });
    assertEquals(
      (overview.structuredContent as { totalStudents: number }).totalStudents,
      6,
    );
  } finally {
    await client.close();
  }
});
