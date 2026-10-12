PRAGMA foreign_keys = ON;

-- Inactive coordination only. Local Matter content and encrypted recovery payloads are never stored here.
CREATE TABLE IF NOT EXISTS cp_matter_owner_lease (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  device_id TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  lease_expires_at TEXT NOT NULL,
  released_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, namespace),
  FOREIGN KEY (tenant_id, user_id) REFERENCES cp_user(tenant_id, user_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES cp_device(tenant_id, device_id)
);

CREATE TABLE IF NOT EXISTS cp_matter_owner_transfer (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  from_device_id TEXT NOT NULL,
  to_device_id TEXT NOT NULL,
  from_epoch INTEGER NOT NULL,
  to_epoch INTEGER NOT NULL,
  recovery_digest TEXT NOT NULL,
  approval_digest TEXT NOT NULL,
  transferred_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, namespace, to_epoch),
  FOREIGN KEY (tenant_id, user_id, namespace) REFERENCES cp_matter_owner_lease(tenant_id, user_id, namespace)
);
