exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("price_plans", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "text", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("customers", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "text", notNull: true },
    email: { type: "text", notNull: true },
    price_plan_id: {
      type: "uuid",
      notNull: true,
      references: "price_plans",
      onDelete: "RESTRICT",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("api_keys", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    customer_id: {
      type: "uuid",
      notNull: true,
      references: "customers",
      onDelete: "CASCADE",
    },
    key_prefix: { type: "text", notNull: true },
    key_hash: { type: "text", notNull: true, unique: true },
    revoked_at: { type: "timestamptz" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("price_tiers", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    price_plan_id: {
      type: "uuid",
      notNull: true,
      references: "price_plans",
      onDelete: "CASCADE",
    },
    min_units: { type: "integer", notNull: true },
    max_units: { type: "integer" },
    unit_price_micros: { type: "bigint", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint("price_tiers", "price_tiers_min_units_check", {
    check: "min_units >= 0",
  });
  pgm.addConstraint("price_tiers", "price_tiers_max_units_check", {
    check: "max_units IS NULL OR max_units > min_units",
  });
  pgm.addConstraint("price_tiers", "price_tiers_unit_price_micros_check", {
    check: "unit_price_micros >= 0",
  });

  pgm.createTable("usage_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    request_id: { type: "text", notNull: true, unique: true },
    customer_id: {
      type: "uuid",
      notNull: true,
      references: "customers",
      onDelete: "CASCADE",
    },
    api_key_id: {
      type: "uuid",
      notNull: true,
      references: "api_keys",
      onDelete: "RESTRICT",
    },
    endpoint: { type: "text", notNull: true },
    units: { type: "integer", notNull: true },
    occurred_at: { type: "timestamptz", notNull: true },
    received_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint("usage_events", "usage_events_units_check", {
    check: "units > 0",
  });

  pgm.createTable("usage_windows", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    customer_id: {
      type: "uuid",
      notNull: true,
      references: "customers",
      onDelete: "CASCADE",
    },
    window_start: { type: "timestamptz", notNull: true },
    window_end: { type: "timestamptz", notNull: true },
    total_units: { type: "integer", notNull: true, default: 0 },
    finalized_at: { type: "timestamptz" },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint("usage_windows", "usage_windows_total_units_check", {
    check: "total_units >= 0",
  });
  pgm.addConstraint("usage_windows", "usage_windows_window_order_check", {
    check: "window_end > window_start",
  });
  pgm.addConstraint("usage_windows", "usage_windows_customer_id_window_start_key", {
    unique: ["customer_id", "window_start"],
  });

  pgm.createTable("invoices", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    customer_id: {
      type: "uuid",
      notNull: true,
      references: "customers",
      onDelete: "CASCADE",
    },
    period_start: { type: "date", notNull: true },
    period_end: { type: "date", notNull: true },
    status: { type: "text", notNull: true },
    subtotal_cents: { type: "integer", notNull: true, default: 0 },
    credits_cents: { type: "integer", notNull: true, default: 0 },
    total_cents: { type: "integer", notNull: true, default: 0 },
    issued_at: { type: "timestamptz" },
    paid_at: { type: "timestamptz" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint("invoices", "invoices_customer_period_key", {
    unique: ["customer_id", "period_start", "period_end"],
  });
  pgm.addConstraint("invoices", "invoices_period_order_check", {
    check: "period_end > period_start",
  });
  pgm.addConstraint("invoices", "invoices_status_check", {
    check: "status IN ('draft', 'issued', 'paid', 'void')",
  });

  pgm.createTable("invoice_line_items", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    invoice_id: {
      type: "uuid",
      notNull: true,
      references: "invoices",
      onDelete: "CASCADE",
    },
    description: { type: "text", notNull: true },
    units: { type: "integer", notNull: true },
    unit_price_micros: { type: "bigint", notNull: true },
    amount_cents: { type: "integer", notNull: true },
    is_overridden: { type: "boolean", notNull: true, default: false },
    overridden_at: { type: "timestamptz" },
    override_reason: { type: "text" },
    overridden_by: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("credits", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    customer_id: {
      type: "uuid",
      notNull: true,
      references: "customers",
      onDelete: "CASCADE",
    },
    invoice_id: {
      type: "uuid",
      notNull: true,
      references: "invoices",
      onDelete: "RESTRICT",
    },
    amount_cents: { type: "integer", notNull: true },
    reason: { type: "text", notNull: true },
    idempotency_key: { type: "text", notNull: true },
    created_by: { type: "text", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint("credits", "credits_amount_cents_check", {
    check: "amount_cents > 0",
  });
  pgm.addConstraint("credits", "credits_customer_id_idempotency_key_key", {
    unique: ["customer_id", "idempotency_key"],
  });

  pgm.createTable("webhook_deliveries", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    provider_event_id: { type: "text", notNull: true, unique: true },
    invoice_id: {
      type: "uuid",
      references: "invoices",
      onDelete: "SET NULL",
    },
    event_type: { type: "text", notNull: true },
    payload: { type: "jsonb", notNull: true },
    received_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    processed_at: { type: "timestamptz" },
  });

  pgm.createTable("audit_logs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    actor: { type: "text", notNull: true },
    action: { type: "text", notNull: true },
    entity_type: { type: "text", notNull: true },
    entity_id: { type: "uuid", notNull: true },
    before_value: { type: "jsonb" },
    after_value: { type: "jsonb" },
    reason: { type: "text", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("job_runs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    job_name: { type: "text", notNull: true },
    status: { type: "text", notNull: true },
    started_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    finished_at: { type: "timestamptz" },
    metadata: { type: "jsonb" },
  });
  pgm.addConstraint("job_runs", "job_runs_status_check", {
    check: "status IN ('started', 'succeeded', 'failed', 'skipped')",
  });

  pgm.createIndex("usage_events", ["customer_id", "occurred_at"]);
  pgm.createIndex("usage_events", ["api_key_id", "occurred_at"]);
  pgm.createIndex("usage_windows", ["customer_id", "window_start"]);
  pgm.createIndex("invoices", ["customer_id", "period_start"]);
  pgm.createIndex("audit_logs", ["entity_type", "entity_id", "created_at"]);
  pgm.createIndex("invoice_line_items", ["invoice_id"]);
  pgm.createIndex("credits", ["invoice_id"]);
  pgm.createIndex("job_runs", ["job_name", "started_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("job_runs");
  pgm.dropTable("audit_logs");
  pgm.dropTable("webhook_deliveries");
  pgm.dropTable("credits");
  pgm.dropTable("invoice_line_items");
  pgm.dropTable("invoices");
  pgm.dropTable("usage_windows");
  pgm.dropTable("usage_events");
  pgm.dropTable("price_tiers");
  pgm.dropTable("api_keys");
  pgm.dropTable("customers");
  pgm.dropTable("price_plans");
};
