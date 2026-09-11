import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isAuthorized,
  policySetTextToParts,
  type Entities,
  type EntityUidJson,
  type PolicySet,
} from "@cedar-policy/cedar-wasm/nodejs";

export type AuthorizationRequest = {
  principal: string;
  action: string;
  resource: string;
  context: { tenant: string };
};

export type AuthorizationResponse = {
  decision: "ALLOW" | "DENY";
  policy: string | null;
};

export type AuthorizationEngine = {
  authorize(request: AuthorizationRequest): AuthorizationResponse;
};

type EngineFiles = {
  schema: string;
  policies: string;
  entities: Entities;
  policyNames: ReadonlyMap<string, string>;
};

const POLICY_ID_ANNOTATION = /^\s*@id\("([^"]+)"\)/;

function entityUid(value: string, expectedType: string): EntityUidJson {
  const parts = value.split("::");
  const [type, rawId] =
    parts.length === 2
      ? parts
      : parts.length === 3 && parts[0] === "CedarGate"
        ? [parts[1], parts[2]]
        : [];

  if (type !== expectedType || !rawId) {
    throw new Error(`Expected ${expectedType}::identifier, received "${value}".`);
  }

  const id = rawId.replace(/^"|"$/g, "");
  if (!id) {
    throw new Error(`Expected ${expectedType} to have a non-empty identifier.`);
  }

  return { type: `CedarGate::${expectedType}`, id };
}

function policyNames(policyText: string): ReadonlyMap<string, string> {
  const parts = policySetTextToParts(policyText);
  if (parts.type === "failure") {
    throw new Error(`Unable to parse policy files: ${parts.errors[0]?.message ?? "unknown error"}`);
  }

  return new Map(
    parts.policies.flatMap((policy, index) => {
      const name = POLICY_ID_ANNOTATION.exec(policy)?.[1];
      return name ? [[`policy${index}`, name] as const] : [];
    }),
  );
}

function loadDocumentFiles(projectRoot: string): EngineFiles {
  const schema = readFileSync(resolve(projectRoot, "schema/document.cedarschema"), "utf8");
  const policies = ["policies/roles.cedar", "policies/tenant-isolation.cedar"]
    .map((file) => readFileSync(resolve(projectRoot, file), "utf8"))
    .join("\n");
  const entities = JSON.parse(
    readFileSync(resolve(projectRoot, "entities/document-entities.json"), "utf8"),
  ) as Entities;

  return { schema, policies, entities, policyNames: policyNames(policies) };
}

/** Core Cedar evaluator; it has no HTTP or API Gateway dependencies. */
export function createDocumentAuthorizationEngine(projectRoot = process.cwd()): AuthorizationEngine {
  const files = loadDocumentFiles(projectRoot);
  const policies: PolicySet = { staticPolicies: files.policies };

  return {
    authorize(request: AuthorizationRequest): AuthorizationResponse {
      const result = isAuthorized({
        principal: entityUid(request.principal, "User"),
        action: entityUid(request.action, "Action"),
        resource: entityUid(request.resource, "Document"),
        context: request.context,
        schema: files.schema,
        policies,
        entities: files.entities,
        validateRequest: true,
      });

      if (result.type === "failure") {
        throw new Error(`Cedar evaluation failed: ${result.errors[0]?.message ?? "unknown error"}`);
      }

      const policyId = result.response.diagnostics.reason[0];
      return {
        decision: result.response.decision === "allow" ? "ALLOW" : "DENY",
        policy: policyId ? files.policyNames.get(policyId) ?? null : null,
      };
    },
  };
}

/** Default document engine used by the local application. */
export const documentAuthorizationEngine = createDocumentAuthorizationEngine();
