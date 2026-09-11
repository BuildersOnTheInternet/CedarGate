import { z } from "zod";

const cedarReference = (entityType: "User" | "Action" | "Document") =>
  z
    .string()
    .regex(
      new RegExp(`^(?:CedarGate::)?${entityType}::"?[A-Za-z0-9._-]+"?$`),
      `Expected ${entityType}::identifier.`,
    );

/** Runtime validation for the public POST /authorize request body. */
export const authorizationRequestSchema = z
  .object({
    principal: cedarReference("User"),
    action: cedarReference("Action"),
    resource: cedarReference("Document"),
    context: z.object({ tenant: z.string().min(1) }).strict(),
  })
  .strict();

export type AuthorizationRequest = z.infer<typeof authorizationRequestSchema>;
