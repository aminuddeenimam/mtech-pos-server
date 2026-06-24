-- M-Tech POS — PostgreSQL schema
-- Multi-location (M-Tech, Mujahid Comms), multi-user (owner + staff) with role-based access.

CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  -- location_id is NULL for owner (sees all locations). Required for staff.
  location_id INTEGER REFERENCES locations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Uncategorized',
  brand TEXT DEFAULT '',
  compatibility TEXT DEFAULT '',
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 3,
  -- client_id lets offline-created records reconcile with the server without duplicate inserts
  client_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ -- soft delete so sync doesn't lose history
);
CREATE INDEX IF NOT EXISTS idx_items_location ON items(location_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_client_id ON items(location_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  user_id INTEGER REFERENCES users(id),
  customer_name TEXT DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  client_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_location ON sales(location_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_id ON sales(location_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sale_lines (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  name TEXT NOT NULL, -- snapshot of item name at time of sale
  qty INTEGER NOT NULL,
  price_each NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty_change INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('sale', 'restock', 'correction', 'damage')),
  ref_id INTEGER, -- e.g. sale id
  user_id INTEGER REFERENCES users(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_adj_item ON stock_adjustments(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_adj_location ON stock_adjustments(location_id);
