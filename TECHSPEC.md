# CedarGate Technical Specification

## 1. Scope

This document specifies the local TypeScript implementation of the authorization engine described in [PRD.md](PRD.md). It covers the service boundary, runtime, source layout, policy evaluation, validation, testing, and local execution.

### Reusable Engine and Application-Specific Rules

CedarGate is a reusable authorization **engine**, not a universal set of permissions for every kind of application. It provides one consistent decision API, Cedar policy validation and evaluation, deny handling, tenant-isolation patterns, test support, and local deployment. An application's users do not use CedarGate directly; its backend calls CedarGate before it performs a protected action.

Each application still needs a vocabulary for its own business domain. That vocabulary consists of a Cedar schema (entities, attributes, and actions), policies (the permission rules), and entity data (the values for a specific user and resource). For example, the included `User`/`Document` schema is a document-domain starter example; an invoicing application would use entities such as `Employee` and `Invoice` and an action such as `approve`.

To avoid requiring every developer to create these files from nothing, CedarGate provides a generic RBAC starter schema and a document-domain starter schema. Future starter packs will add common domains such as projects and invoices. A starter pack supplies an initial schema and policy set; developers only customize it where their business rules differ.

```text
Starter pack/configuration → schema + baseline policies
Application entity data    → user and resource attributes
Application → POST /authorize → CedarGate → ALLOW or DENY
Application performs the protected action only when allowed
```

## 2. Technology Stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Language | TypeScript | Type-safe application code |
| Runtime | Node.js LTS | Lambda-compatible local runtime |
| Policy engine | Cedar with `@cedar-policy/cedar-wasm` | Evaluate Cedar policies in Node.js |
| API | AWS Lambda + API Gateway HTTP API events | Expose `POST /authorize` |
| Local serverless runtime | AWS SAM CLI | Build and execute the Lambda locally |
| AWS emulation | LocalStack (optional) | Exercise an API Gateway-to-Lambda path locally |
| Request validation | Zod | Validate and parse HTTP request bodies |
| Tests | Vitest | Unit and authorization-scenario tests |
| Data | JSON and Cedar files | Policies, schema, entities, and test scenarios |

## 3. Architecture

```text
Client / Vitest
      │
      │ POST /authorize
      ▼
API Gateway HTTP API (SAM or optional LocalStack)
      │
      ▼
TypeScript Lambda handler
      │
      ├── Zod request validation
      └── Authorization service
               │
               ▼
        Cedar WASM evaluator
          ├── policy files
          ├── Cedar schema
          └── entity/context data
               │
               ▼
        ALLOW or DENY decision
```

The handler is intentionally thin. It parses the API Gateway event, validates its JSON body, calls the authorization service, and returns a JSON response. Policy loading and Cedar evaluation remain outside the HTTP layer so they can be tested directly.

The initial implementation uses `document.cedarschema` as its document demonstrator. The startup configuration must select a starter pack before Cedar initializes (for example, `document` or `generic-rbac`) and load that pack's schema and baseline policies. The HTTP handler must not select a pack or contain business-specific authorization shortcuts.

## 4. API Contract

### `POST /authorize`

Request body:

```json
{
  "principal": "User::alice",
  "action": "Action::edit",
  "resource": "Document::doc-123",
  "context": {
    "tenant": "tenant-a"
  }
}
```

Successful response:

```json
{
  "decision": "ALLOW",
  "policy": "owner-can-edit"
}
```

A denied request returns HTTP 200 with `"decision": "DENY"`; denial is an authorization outcome, not an API failure. Invalid JSON or a body that does not match the Zod schema returns HTTP 400. Unexpected evaluation failures return HTTP 500 without exposing policy internals.

## 5. Domain Types

The implementation should use explicit types at the boundary:

```ts
type AuthorizationRequest = {
  principal: string;
  action: string;
  resource: string;
  context: { tenant: string; expiresAt?: string };
};

type AuthorizationResponse = {
  decision: "ALLOW" | "DENY";
  policy: string | null;
};
```

Zod is the runtime source of truth for untrusted HTTP input. TypeScript types are inferred from the Zod schemas where practical.

## 6. Policy Evaluation

1. Load the Cedar schema and policy files at initialization.
2. Convert the request, entity data, and context into Cedar-compatible values.
3. Evaluate the request with the Cedar WASM package.
4. Return `ALLOW` only when Cedar permits the request; otherwise return `DENY`.
5. Include the determining policy identifier when the evaluator makes it available; otherwise return `null`.

Tenant membership belongs in the Cedar policy and entity model. It must not be implemented as an HTTP-handler shortcut, so every entry point receives the same isolation guarantee.

## 7. Source Layout

```text
authorization-engine/
├── policies/
│   ├── roles.cedar
│   ├── tenant-isolation.cedar
│   ├── explicit-deny.cedar
│   └── time-based-access.cedar
├── schema/
│   ├── document.cedarschema     # Document-domain starter schema
│   └── generic-rbac.cedarschema # Tenant-scoped RBAC/CRUD starter schema
├── scenarios/
│   └── authorization_cases.json
├── src/
│   ├── handler.ts          # API Gateway/Lambda adapter
│   ├── authorization.ts    # Cedar loading and evaluation
│   └── schemas.ts          # Zod schemas and inferred types
├── tests/
│   ├── roles.test.ts
│   ├── tenants.test.ts
│   ├── denies.test.ts
│   └── expiration.test.ts
├── template.yaml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## 8. Testing Strategy

Vitest tests the authorization service directly for fast, deterministic scenario coverage. Required scenarios include role permissions, tenant isolation, explicit deny precedence, and time-based access. The target is 15–20 scenarios.

A small handler test suite verifies request parsing, HTTP status codes, and the response shape. SAM local invocation is an integration smoke test; it is not a replacement for the scenario suite.

Example service-level test:

```ts
it("denies a viewer editing a document", () => {
  const response = authorize({
    principal: "User::viewer",
    action: "Action::edit",
    resource: "Document::doc-123",
    context: { tenant: "tenant-a" },
  });

  expect(response.decision).toBe("DENY");
});
```

## 9. Local Development and Delivery

```bash
npm install
npm test
sam local invoke
sam local start-api
```

LocalStack is optional and is introduced only to validate the API Gateway-to-Lambda path. The core project must remain fully usable with Node.js, Vitest, and SAM alone.

## 10. Implementation Milestones

| # | Milestone | Priority |
| --- | --- | --- |
| 1 | Define Cedar schema and entity model | Required |
| 2 | Write the initial policy set | Required |
| 3 | Implement the authorization service | Required |
| 4 | Implement and validate the Lambda handler | Required |
| 5 | Add 15–20 Vitest authorization scenarios | Required |
| 6 | Package and run with SAM | Required |
| 7 | Add LocalStack API Gateway emulation | Optional |
| 8 | Add time-boxed access policies | Optional |
| 9 | Add startup configuration to select `document` or `generic-rbac` schema and policy pack | Required |
| 10 | Add project and invoice starter packs | Optional |

When time is constrained, defer LocalStack first and time-based access second. The document schema and policies remain required for the initial demonstrator. The generic RBAC schema is included as the first reusable starter pack; startup pack selection is required before presenting CedarGate as a configurable product.
