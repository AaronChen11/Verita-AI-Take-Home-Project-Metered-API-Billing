exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.alterColumn("usage_events", "units", { type: "bigint" });
  pgm.alterColumn("usage_windows", "total_units", { type: "bigint" });
  pgm.alterColumn("invoices", "subtotal_cents", { type: "bigint" });
  pgm.alterColumn("invoices", "credits_cents", { type: "bigint" });
  pgm.alterColumn("invoices", "total_cents", { type: "bigint" });
  pgm.alterColumn("invoice_line_items", "units", { type: "bigint" });
  pgm.alterColumn("invoice_line_items", "amount_cents", { type: "bigint" });
  pgm.alterColumn("credits", "amount_cents", { type: "bigint" });

  pgm.createIndex("api_keys", ["key_hash"], {
    name: "api_keys_active_hash_idx",
    where: "revoked_at IS NULL",
  });
  pgm.createIndex("audit_logs", ["entity_id", "created_at"], {
    name: "audit_logs_entity_id_created_at_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("audit_logs", ["entity_id", "created_at"], {
    name: "audit_logs_entity_id_created_at_idx",
  });
  pgm.dropIndex("api_keys", ["key_hash"], {
    name: "api_keys_active_hash_idx",
  });

  pgm.alterColumn("credits", "amount_cents", { type: "integer" });
  pgm.alterColumn("invoice_line_items", "amount_cents", { type: "integer" });
  pgm.alterColumn("invoice_line_items", "units", { type: "integer" });
  pgm.alterColumn("invoices", "total_cents", { type: "integer" });
  pgm.alterColumn("invoices", "credits_cents", { type: "integer" });
  pgm.alterColumn("invoices", "subtotal_cents", { type: "integer" });
  pgm.alterColumn("usage_windows", "total_units", { type: "integer" });
  pgm.alterColumn("usage_events", "units", { type: "integer" });
};
