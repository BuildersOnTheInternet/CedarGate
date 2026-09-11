import { describe, expect, it } from "vitest";
import { createAuthorizeHandler } from "../src/api/handler";
import { createDocumentAuthorizationEngine } from "../src/engine/authorization";

const engine = createDocumentAuthorizationEngine(process.cwd());

const request = (
  principal: string,
  action: string,
  resource: string,
  tenant = "tenant-a",
) => ({ principal, action, resource, context: { tenant } });

describe("document authorization", () => {
  it.each([
    ["owner reads", request("User::alice", "Action::read", "Document::doc-1")],
    ["owner edits", request("User::alice", "Action::edit", "Document::doc-1")],
    ["owner deletes", request("User::alice", "Action::delete", "Document::doc-1")],
  ])("allows %s", (_name, authorizationRequest) => {
    expect(engine.authorize(authorizationRequest)).toEqual({
      decision: "ALLOW",
      policy: "owner-full-access",
    });
  });

  it.each([
    ["editor reads", request("User::bob", "Action::read", "Document::doc-1")],
    ["editor edits", request("User::bob", "Action::edit", "Document::doc-1")],
  ])("allows %s", (_name, authorizationRequest) => {
    expect(engine.authorize(authorizationRequest)).toEqual({
      decision: "ALLOW",
      policy: "editor-can-read-and-edit",
    });
  });

  it("allows a viewer to read", () => {
    expect(engine.authorize(request("User::carol", "Action::read", "Document::doc-1"))).toEqual({
      decision: "ALLOW",
      policy: "viewer-can-read",
    });
  });

  it.each([
    ["editor deletes", request("User::bob", "Action::delete", "Document::doc-1")],
    ["viewer edits", request("User::carol", "Action::edit", "Document::doc-1")],
    ["viewer deletes", request("User::carol", "Action::delete", "Document::doc-1")],
  ])("denies %s", (_name, authorizationRequest) => {
    expect(engine.authorize(authorizationRequest)).toEqual({ decision: "DENY", policy: null });
  });

  it.each([
    ["owner", request("User::alice", "Action::read", "Document::doc-3", "tenant-b")],
    ["editor", request("User::bob", "Action::edit", "Document::doc-3", "tenant-b")],
    ["viewer", request("User::carol", "Action::read", "Document::doc-3", "tenant-b")],
    ["tenant-b editor", request("User::eve", "Action::edit", "Document::doc-1")],
  ])("denies cross-tenant access for %s", (_name, authorizationRequest) => {
    expect(engine.authorize(authorizationRequest)).toEqual({
      decision: "DENY",
      policy: "deny-cross-tenant-access",
    });
  });
});

describe("POST /authorize handler", () => {
  const handler = createAuthorizeHandler(engine);

  it("returns an authorization decision", async () => {
    const result = await handler({
      body: JSON.stringify(request("User::bob", "Action::edit", "Document::doc-1")),
    });

    expect(result).toEqual({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "ALLOW", policy: "editor-can-read-and-edit" }),
    });
  });

  it("returns a 200 denial rather than an error", async () => {
    const result = await handler({
      body: JSON.stringify(request("User::carol", "Action::edit", "Document::doc-1")),
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ decision: "DENY", policy: null });
  });

  it.each([
    ["malformed JSON", "{"],
    ["missing context", JSON.stringify({ principal: "User::alice", action: "Action::read", resource: "Document::doc-1" })],
    ["unknown field", JSON.stringify({ ...request("User::alice", "Action::read", "Document::doc-1"), extra: true })],
    ["invalid Cedar reference", JSON.stringify(request("alice", "Action::read", "Document::doc-1"))],
  ])("returns 400 for %s", async (_name, body) => {
    const result = await handler({ body });
    expect(result).toEqual({
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: _name === "malformed JSON" ? "Invalid JSON request body." : "Invalid authorization request." }),
    });
  });
});
