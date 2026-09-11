// Document permissions by role. Tenant isolation is enforced separately in
// tenant-isolation.cedar so it applies to every role and action.

@id("owner-full-access")
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "owner"
};

@id("editor-can-read-and-edit")
permit (
  principal,
  action in [CedarGate::Action::"read", CedarGate::Action::"edit"],
  resource
)
when {
  principal.role == "editor"
};

@id("viewer-can-read")
permit (
  principal,
  action == CedarGate::Action::"read",
  resource
)
when {
  principal.role == "viewer"
};
