import {
  hostHeaderValidationResponse,
  localhostAllowedOrigins,
  type McpServer,
  originValidationResponse,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { timingSafeEqual } from "node:crypto";

export interface HttpHandlerOptions {
  createServer: () => McpServer;
  authToken: string;
  // Host headers to accept; undefined skips the check, for a server behind a proxy
  allowedHostnames?: string[];
}

const encoder = new TextEncoder();

function hasValidToken(request: Request, authToken: string): boolean {
  const presented = encoder.encode(request.headers.get("authorization") ?? "");
  const expected = encoder.encode(`Bearer ${authToken}`);
  // Constant-time comparison, so response timing doesn't reveal the token
  return presented.length === expected.length &&
    timingSafeEqual(presented, expected);
}

/**
 * Fetch handler serving MCP over Streamable HTTP at /mcp, plus an unauthenticated /health
 * Stateless: each request gets its own server and transport
 */
export function createHttpHandler(
  { createServer, authToken, allowedHostnames }: HttpHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (allowedHostnames) {
      const rejected = hostHeaderValidationResponse(request, allowedHostnames);
      if (rejected) return rejected;
    }

    const { pathname } = new URL(request.url);
    if (pathname === "/health") return Response.json({ status: "ok" });
    if (pathname !== "/mcp") return new Response("Not found", { status: 404 });

    // The spec requires Origin checks, so a web page can't drive a local server
    const rejectedOrigin = originValidationResponse(
      request,
      localhostAllowedOrigins(),
    );
    if (rejectedOrigin) return rejectedOrigin;

    if (!hasValidToken(request, authToken)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await createServer().connect(transport);
    return transport.handleRequest(request);
  };
}
