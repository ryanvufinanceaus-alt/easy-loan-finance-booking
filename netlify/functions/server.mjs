import { Readable } from "node:stream";
import { handleNodeRequest } from "../../server.mjs";

function originalPath(event) {
  const params = event.queryStringParameters || {};
  const raw = params.path || event.path || "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "path" || value == null) continue;
    search.append(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function requestFromEvent(event) {
  const body = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "");
  const req = Readable.from(body.length ? [body] : []);
  req.method = event.httpMethod || "GET";
  req.url = originalPath(event);
  req.headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  return req;
}

function responseCollector() {
  let statusCode = 200;
  const headers = {};
  const multiValueHeaders = {};
  const chunks = [];

  return {
    response: {
      writeHead(status, nextHeaders = {}) {
        statusCode = status;
        for (const [key, value] of Object.entries(nextHeaders)) {
          this.setHeader(key, value);
        }
      },
      setHeader(key, value) {
        const lowerKey = key.toLowerCase();
        if (Array.isArray(value)) {
          multiValueHeaders[lowerKey] = value.map(String);
        } else {
          headers[lowerKey] = String(value);
        }
      },
      end(chunk = "") {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    result() {
      return {
        statusCode,
        headers,
        multiValueHeaders,
        body: Buffer.concat(chunks).toString("utf8")
      };
    }
  };
}

export async function handler(event) {
  const req = requestFromEvent(event);
  const { response, result } = responseCollector();
  await handleNodeRequest(req, response);
  return result();
}
