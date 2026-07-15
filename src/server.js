require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { signToken, authMiddleware, resolveLocationId } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- HEALTH CHECK ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- AUTH ----------

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username.trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        locationId: user.location_id,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, role, location_id FROM users WHERE id = $1', [req.user.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: rows[0].id, name: rows[0].name, role: rows[0].role, locationId: rows[0].location_id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Any logged-in user can change their own password, but must confirm the current one first.
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ---------- LOCATIONS ----------

// Owner-only: list all locations (for the location switcher)
app.get('/api/locations', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'owner') {
      const { rows } = await pool.query('SELECT * FROM locations ORDER BY name');
      return res.json({ locations: rows });
    }
    const { rows } = await pool.query('SELECT * FROM locations WHERE id = $1', [req.user.locationId]);
    res.json({ locations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// Owner-only: create a new location (shop/branch)
app.post('/api/locations', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can create locations' });
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Location name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO locations (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [name.trim()]
    );
    res.json({ location: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

// Owner-only: rename an existing location
app.put('/api/locations/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can rename locations' });
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Location name is required' });
  try {
    const { rows } = await pool.query(
      'UPDATE locations SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Location not found' });
    res.json({ location: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A location with that name already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to rename location' });
  }
});

// Owner-only: move an item to a different location (e.g. correcting a misassigned import)
app.put('/api/items/:id/move', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can move items between locations' });
  const { id } = req.params;
  const { toLocationId } = req.body;
  if (!toLocationId) return res.status(400).json({ error: 'toLocationId is required' });
  try {
    const { rows } = await pool.query(
      'UPDATE items SET location_id = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING *',
      [toLocationId, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
    res.json({ item: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to move item' });
  }
});

// ---------- USER MANAGEMENT (owner only) ----------

app.post('/api/users', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can create users' });
  const { name, username, password, role, locationId } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password, role are required' });
  }
  if (role === 'staff' && !locationId) {
    return res.status(400).json({ error: 'Staff must be assigned a locationId' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, username, password_hash, role, location_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, username, role, location_id`,
      [name, username.trim().toLowerCase(), hash, role, role === 'owner' ? null : locationId]
    );
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get('/api/users', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can view users' });
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.username, u.role, u.location_id, l.name as location_name
       FROM users u LEFT JOIN locations l ON u.location_id = l.id
       ORDER BY u.role, u.name`
    );
    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ---------- ITEMS ----------

app.get('/api/items', authMiddleware, async (req, res) => {
  const locationId = resolveLocationId(req);
  try {
    let rows;
    if (locationId) {
      ({ rows } = await pool.query(
        'SELECT * FROM items WHERE location_id = $1 AND deleted_at IS NULL ORDER BY name',
        [locationId]
      ));
    } else {
      // owner viewing all locations
      ({ rows } = await pool.query(
        `SELECT i.*, l.name as location_name FROM items i
         JOIN locations l ON i.location_id = l.id
         WHERE i.deleted_at IS NULL ORDER BY l.name, i.name`
      ));
    }
    res.json({ items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

app.post('/api/items', authMiddleware, async (req, res) => {
  const locationId = resolveLocationId(req);
  if (!locationId) return res.status(400).json({ error: 'locationId is required' });
  const { name, category, brand, compatibility, costPrice, sellPrice, qty, lowStockThreshold, clientId } = req.body;
  if (!name) return res.status(400).json({ error: 'Item name is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO items (location_id, name, category, brand, compatibility, cost_price, sell_price, qty, low_stock_threshold, client_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (location_id, client_id) WHERE client_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING *`,
      [locationId, name, category || 'Uncategorized', brand || '', compatibility || '',
       Number(costPrice) || 0, Number(sellPrice) || 0, Number(qty) || 0, Number(lowStockThreshold) || 3, clientId || null]
    );
    res.json({ item: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

app.put('/api/items/:id', authMiddleware, async (req, res) => {
  const locationId = resolveLocationId(req);
  const { id } = req.params;
  const { name, category, brand, compatibility, costPrice, sellPrice, qty, lowStockThreshold } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE items SET
        name = COALESCE($1, name),
        category = COALESCE($2, category),
        brand = COALESCE($3, brand),
        compatibility = COALESCE($4, compatibility),
        cost_price = COALESCE($5, cost_price),
        sell_price = COALESCE($6, sell_price),
        qty = COALESCE($7, qty),
        low_stock_threshold = COALESCE($8, low_stock_threshold),
        updated_at = now()
       WHERE id = $9 AND location_id = $10 AND deleted_at IS NULL
       RETURNING *`,
      [name, category, brand, compatibility, costPrice, sellPrice, qty, lowStockThreshold, id, locationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item not found in your location' });
    res.json({ item: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

app.delete('/api/items/:id', authMiddleware, async (req, res) => {
  const locationId = resolveLocationId(req);
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'UPDATE items SET deleted_at = now() WHERE id = $1 AND location_id = $2 RETURNING id',
      [id, locationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Item not found in your location' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ---------- SALES ----------

app.post('/api/sales', authMiddleware, async (req, res) => {
  const locationId = resolveLocationId(req);
  if (!locationId) return res.status(400).json({ error: 'locationId is required' });
  const { lines, paymentMethod, customerName, clientId, timestamp } = req.body;

  if (!lines || lines.length === 0) return res.status(400).json({ error: 'Sale must have at least one line item' });
  if (!['cash', 'transfer'].includes(paymentMethod)) return res.status(400).json({ error: 'Invalid payment method' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency: if this clientId was already synced, return the existing sale
    if (clientId) {
      const existing = await client.query(
        'SELECT * FROM sales WHERE location_id = $1 AND client_id = $2',
        [locationId, clientId]
      );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        const linesRes = await pool.query('SELECT * FROM sale_lines WHERE sale_id = $1', [existing.rows[0].id]);
        return res.json({ sale: { ...existing.rows[0], lines: linesRes.rows }, alreadyExisted: true });
      }
    }

    // Validate stock for every line, lock rows to prevent race conditions across devices
    for (const line of lines) {
      const itemRes = await client.query(
        'SELECT * FROM items WHERE id = $1 AND location_id = $2 FOR UPDATE',
        [line.itemId, locationId]
      );
      const item = itemRes.rows[0];
      if (!item) throw new Error(`Item not found: ${line.name || line.itemId}`);
      if (item.qty < line.qty) throw new Error(`Not enough stock for ${item.name}. Available: ${item.qty}`);
    }

    const total = lines.reduce((sum, l) => sum + l.qty * l.priceEach, 0);

    const saleRes = await client.query(
      `INSERT INTO sales (location_id, user_id, customer_name, payment_method, total, client_id, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
       RETURNING *`,
      [locationId, req.user.userId, customerName || '', paymentMethod, total, clientId || null, timestamp || null]
    );
    const sale = saleRes.rows[0];

    const savedLines = [];
    for (const line of lines) {
      const lineRes = await client.query(
        `INSERT INTO sale_lines (sale_id, item_id, name, qty, price_each)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [sale.id, line.itemId, line.name, line.qty, line.priceEach]
      );
      savedLines.push(lineRes.rows[0]);

      await client.query('UPDATE items SET qty = qty - $1, updated_at = now() WHERE id = $2', [line.qty, line.itemId]);
      await client.query(
        `INSERT INTO stock_adjustments (location_id, item_id, qty_change, reason, ref_id, user_id)
         VALUES ($1,$2,$3,'sale',$4,$5)`,
        [locationId, line.itemId, -line.qty, sale.id, req.user.userId]
      );
    }

    await client.query('COMMIT');
    res.json({ sale: { ...sale, lines: savedLines } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/sales', authMiddleware, async (req, res) => {
  const locationId = resolveLocationId(req);
  try {
    let salesRows;
    if (locationId) {
      ({ rows: salesRows } = await pool.query(
        'SELECT * FROM sales WHERE location_id = $1 ORDER BY timestamp DESC LIMIT 500',
        [locationId]
      ));
    } else {
      ({ rows: salesRows } = await pool.query(
        `SELECT s.*, l.name as location_name FROM sales s
         JOIN locations l ON s.location_id = l.id
         ORDER BY s.timestamp DESC LIMIT 500`
      ));
    }
    const saleIds = salesRows.map((s) => s.id);
    let lineRows = [];
    if (saleIds.length) {
      const { rows } = await pool.query('SELECT * FROM sale_lines WHERE sale_id = ANY($1)', [saleIds]);
      lineRows = rows;
    }
    const sales = salesRows.map((s) => ({ ...s, lines: lineRows.filter((l) => l.sale_id === s.id) }));
    res.json({ sales });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// ---------- SYNC: PULL CHANGES SINCE TIMESTAMP ----------
// Devices call this on reconnect to pull anything changed elsewhere since their last sync.

app.get('/api/sync/pull', authMiddleware, async (req, res) => {
  const locationId = resolveLocationId(req);
  if (!locationId) return res.status(400).json({ error: 'locationId is required' });
  const since = req.query.since ? new Date(Number(req.query.since)) : new Date(0);

  try {
    const { rows: items } = await pool.query(
      'SELECT * FROM items WHERE location_id = $1 AND updated_at > $2',
      [locationId, since]
    );
    const { rows: sales } = await pool.query(
      'SELECT * FROM sales WHERE location_id = $1 AND created_at > $2 ORDER BY timestamp DESC',
      [locationId, since]
    );
    const saleIds = sales.map((s) => s.id);
    let lines = [];
    if (saleIds.length) {
      const { rows } = await pool.query('SELECT * FROM sale_lines WHERE sale_id = ANY($1)', [saleIds]);
      lines = rows;
    }
    res.json({
      serverTime: Date.now(),
      items,
      sales: sales.map((s) => ({ ...s, lines: lines.filter((l) => l.sale_id === s.id) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync pull failed' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`M-Tech POS server running on port ${PORT}`));
