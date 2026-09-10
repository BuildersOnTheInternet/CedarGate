# Local-First Authorization Engine

**Cedar + Serverless-on-Localhost**

> A local-first authorization decision service that evaluates Cedar policies against access requests — with no AWS account, cloud deployment, or database required.

Implementation details, including the TypeScript stack, API contract, architecture, and local development workflow, are defined in [TECHSPEC.md](TECHSPEC.md).

---

## 1. Problem

Every application with more than one user role eventually needs to answer:

> **"Is this user allowed to perform this action on this resource, right now?"**

Most teams solve this with scattered checks such as:

```text
if user has editor role
  allow edit
```

spread across routes and services.

As the application grows, this approach becomes:

* **Inconsistent** — it's easy to miss an authorization check somewhere.
* **Hard to audit** — there is no single source of truth for access rules.
* **Hard to test** — authorization logic is tightly coupled to application code.
* **Hard to change** — modifying permissions often means modifying multiple services.

### Our Approach

We separate **authorization decisions from application logic**.

Instead of embedding permission checks throughout the application, the application asks a centralized authorization engine:

```text
Who?       → principal
What?      → action
On what?   → resource
Under what conditions? → context
```

The engine evaluates these inputs against **Cedar policies** and returns a decision:

```text
ALLOW
```

or

```text
DENY
```

---

# 2. What We're Building

A small authorization decision service built around **Cedar**, with three layers.

### 1. Policy Layer — Cedar

Declarative Cedar policies define authorization rules for:

* `principal` — who is requesting access
* `action` — what they want to do
* `resource` — what they want to access
* `context` — additional conditions such as expiration

This keeps authorization rules independent from application code.

### 2. Authorization API

A thin API wrapper exposes a single authorization endpoint:

```http
POST /authorize
```

The endpoint receives an authorization request and returns:

```json
{
  "decision": "ALLOW",
  "policy": "owner-can-edit"
}
```

or:

```json
{
  "decision": "DENY",
  "policy": null
}
```

### 3. Local Execution

The service is packaged and executed locally in a serverless-style environment.

This allows us to reproduce a serverless-style execution environment without deploying anything to AWS.

Optionally, **LocalStack** can be added to emulate the complete API Gateway → Lambda request path.

---

# 3. Demo Scenario

We model authorization for a multi-tenant document-sharing application.

Think of a simplified version of:

* Google Docs
* Notion
* Dropbox

but focused specifically on authorization.

## Roles

| Role     | Example Permissions       |
| -------- | ------------------------- |
| `owner`  | Full access to documents  |
| `editor` | Read and modify documents |
| `viewer` | Read documents only       |

## Multi-Tenancy

Every document belongs to a tenant.

For example:

```text
Tenant A
├── document-1
├── document-2
└── document-3

Tenant B
├── document-4
└── document-5
```

A user belonging to **Tenant A must never be able to access Tenant B's documents**, even if another policy appears to allow the action.

This gives us a strong cross-tenant isolation guarantee.

## Time-Boxed Access

The engine also supports contextual authorization.

For example:

```text
Share link created
        ↓
Valid for 24 hours
        ↓
Request arrives
        ↓
Check expiration context
        ↓
ALLOW / DENY
```

Once the access window expires, the authorization request must be denied.

---

# 4. Authorization Model

Every authorization request follows the same structure:

```text
Principal
    │
    ├── Who is making the request?
    │
    ▼
Action
    │
    ├── What are they trying to do?
    │
    ▼
Resource
    │
    ├── What are they accessing?
    │
    ▼
Context
    │
    ├── Additional conditions
    │
    ▼
Cedar Policy Evaluation
    │
    ▼
ALLOW / DENY
```

### Example Request

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

The Cedar evaluator checks this request against the policy set and produces the authorization decision.

---

# 5. Why Cedar?

Authorization logic becomes difficult to maintain when it is embedded directly inside application code.

Instead of:

```ts
if (user.role === "owner") {
  allow();
} else if (user.role === "editor" && document.tenantId === user.tenantId) {
  allow();
} else {
  deny();
}
```

we express authorization declaratively:

```text
permit (
    principal in Role::"editor",
    action == Action::"edit",
    resource
)
when {
    principal.tenant == resource.tenant
};
```

The application doesn't need to know **why** access was granted.

It only needs to ask:

```text
"Can this principal perform this action on this resource?"
```

This creates a clean separation between:

```text
Application Logic
        +
Authorization Policy
```

---

# 6. Policy Design

The initial policy set covers:

### Owner

Owners can:

* Read documents
* Edit documents
* Delete documents
* Share documents

### Editor

Editors can:

* Read documents
* Edit documents

### Viewer

Viewers can:

* Read documents

But none of these permissions bypass tenant isolation.

Conceptually:

```text
ALLOW
  │
  ├── Role permission
  │
  └── Tenant boundary
```

Both must be satisfied.

---

# 7. Explicit Deny

One important property of the authorization model is handling conflicting policies.

For example:

```text
Policy A
────────
ALLOW editor → edit document

Policy B
────────
DENY user → edit restricted document
```

If both policies apply:

```text
ALLOW + DENY
     ↓
   DENY
```

Explicit deny takes precedence.

This gives us a predictable way to introduce security exceptions without rewriting existing allow policies.

---

# 8. Test Suite

The test suite is the primary proof of correctness.

Instead of relying on a live deployment, we verify authorization behavior through automated tests.

Target:

**15–20 authorization scenarios**

### Test Categories

#### Basic Role Authorization

```text
✓ Owner can read
✓ Owner can edit
✓ Owner can delete
✓ Editor can read
✓ Editor can edit
✓ Editor cannot delete
✓ Viewer can read
✓ Viewer cannot edit
✓ Viewer cannot delete
```

#### Tenant Isolation

```text
✓ Tenant A user can access Tenant A document
✓ Tenant A user cannot access Tenant B document
✓ Tenant B user cannot access Tenant A document
✓ Cross-tenant edit is denied
✓ Cross-tenant delete is denied
```

#### Conflicting Policies

```text
✓ Allow policy grants access
✓ Explicit deny overrides allow
✓ Restricted resource remains inaccessible
```

#### Time-Based Access

```text
✓ Valid share link is allowed
✓ Expired share link is denied
✓ Access outside allowed time window is denied
```

---

# 9. Test Report

Running the test suite produces the authorization report:

```text
========================================
   LOCAL AUTHORIZATION TEST REPORT
========================================

Role Permissions
----------------------------------------
✓ Owner can read
✓ Owner can edit
✓ Owner can delete
✓ Editor can read
✓ Editor can edit
✓ Editor cannot delete
✓ Viewer can read
✓ Viewer cannot edit
✓ Viewer cannot delete

Tenant Isolation
----------------------------------------
✓ Same-tenant access allowed
✓ Cross-tenant read denied
✓ Cross-tenant edit denied
✓ Cross-tenant delete denied

Policy Conflicts
----------------------------------------
✓ Explicit deny overrides allow
✓ Restricted resource denied

Time-Based Access
----------------------------------------
✓ Active share link allowed
✓ Expired share link denied

----------------------------------------
18 passed, 0 failed
========================================
```

The **test report is the demo**.

No public URL or cloud deployment is required.

---

# 10. What Success Looks Like

A judge or recruiter should be able to clone the repository, run the project locally, and execute the authorization scenario suite.

And see:

```text
18 passed
```

The important part isn't a live URL.

The important part is being able to demonstrate:

> **Authorization rules are modeled separately from application code, evaluated consistently by Cedar, and verified through an automated test suite.**

---

# 11. Why This Project?

Authorization is a deceptively difficult backend problem.

A production system needs to handle more than:

```text
if role == "admin"
```

It needs to reason about:

* Roles
* Resources
* Tenants
* Actions
* Policy conflicts
* Explicit denies
* Context
* Expiration
* Isolation boundaries

This project demonstrates how those rules can be modeled as a dedicated policy layer rather than scattered throughout application code.

---

# 12. Core Principle

```text
Application
    │
    │ "Can this user do this?"
    ▼
Authorization Engine
    │
    ▼
Cedar Policies
    │
    ▼
ALLOW / DENY
```

The application handles **business logic**.

Cedar handles **authorization logic**.

That separation is the core of the project.

---

## Final Goal

Build a small, production-inspired authorization engine that demonstrates:

```text
Declarative Policies
        +
Centralized Authorization
        +
Multi-Tenant Isolation
        +
Explicit Deny
        +
Context-Aware Access
        +
Serverless Execution
        +
Automated Verification
```

**All running locally.**

No AWS account required.

No live deployment required.

No cloud bill required.

The **authorization test report is the demo.**
