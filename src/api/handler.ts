import {
  documentAuthorizationEngine,
  type AuthorizationEngine,
  type AuthorizationResponse,
} from "../engine/authorization";
import { authorizationRequestSchema } from "./schemas";

export type ApiGatewayHttpEvent = { body: string | null };

export type ApiGatewayHttpResponse = {
  statusCode: number;
  headers: { "content-type": "application/json" };
  body: string;
};

const JSON_HEADERS = { "content-type": "application/json" } as const;

function response(statusCode: number, body: unknown): ApiGatewayHttpResponse {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

/** HTTP adapter around the engine. It contains no Cedar evaluation logic. */
export function createAuthorizeHandler(engine: AuthorizationEngine) {
  return async (event: ApiGatewayHttpEvent): Promise<ApiGatewayHttpResponse> => {
    let parsedBody: unknown;

    try {
      parsedBody = JSON.parse(event.body ?? "");
    } catch {
      return response(400, { error: "Invalid JSON request body." });
    }

    const request = authorizationRequestSchema.safeParse(parsedBody);
    if (!request.success) {
      return response(400, { error: "Invalid authorization request." });
    }

    try {
      const result: AuthorizationResponse = engine.authorize(request.data);
      return response(200, result);
    } catch {
      return response(500, { error: "Authorization evaluation failed." });
    }
  };
}

/** Lambda/API Gateway entry point for POST /authorize. */
export const handler = createAuthorizeHandler(documentAuthorizationEngine);
