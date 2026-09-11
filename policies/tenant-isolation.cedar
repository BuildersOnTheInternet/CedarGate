// A permit is never valid across tenants. Cedar gives forbid policies
// precedence over permits, making this isolation guarantee universal.

@id("deny-cross-tenant-access")
forbid (
  principal,
  action,
  resource
)
when {
  principal.tenant != resource.tenant
};
