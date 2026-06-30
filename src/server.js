// M-Tech POS — API client
// Wraps fetch calls to the backend. Every call here can fail due to no network —
// callers (sync.js) are responsible for deciding what to do when that happens.

const API_BASE = 'https://mtech-pos-server.onrender.com/api';

function getToken() {
  return localStorage.getItem('mtech_token');
}

function setToken(token) {
  localStorage.setItem('mtech_token', token);
}

function clearToken() {
  localStorage.removeItem('mtech_token');
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) errMsg = body.error;
    } catch (_) {}
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

export async function login(username, password) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.user;
}

export function logout() {
  clearToken();
}

export function isLoggedIn() {
  return !!getToken();
}

export async function fetchMe() {
  const data = await apiFetch('/auth/me');
  return data.user;
}

export async function fetchLocations() {
  const data = await apiFetch('/locations');
  return data.locations;
}

export async function fetchItems(locationId) {
  const qs = locationId ? `?locationId=${locationId}` : '';
  const data = await apiFetch(`/items${qs}`);
  return data.items;
}

export async function pushCreateItem(item, locationId) {
  const qs = locationId ? `?locationId=${locationId}` : '';
  const data = await apiFetch(`/items${qs}`, {
    method: 'POST',
    body: JSON.stringify({
      clientId: item.clientId,
      name: item.name,
      category: item.category,
      brand: item.brand,
      compatibility: item.compatibility,
      costPrice: item.costPrice,
      sellPrice: item.sellPrice,
      qty: item.qty,
      lowStockThreshold: item.lowStockThreshold,
    }),
  });
  return data.item;
}

export async function pushUpdateItem(serverId, changes, locationId) {
  const qs = locationId ? `?locationId=${locationId}` : '';
  const data = await apiFetch(`/items/${serverId}${qs}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
  return data.item;
}

export async function pushDeleteItem(serverId, locationId) {
  const qs = locationId ? `?locationId=${locationId}` : '';
  return apiFetch(`/items/${serverId}${qs}`, { method: 'DELETE' });
}

export async function pushCreateSale(sale, locationId) {
  const qs = locationId ? `?locationId=${locationId}` : '';
  const data = await apiFetch(`/sales${qs}`, {
    method: 'POST',
    body: JSON.stringify({
      lines: sale.lines.map((l) => ({
        itemId: l.itemServerId,
        name: l.name,
        qty: l.qty,
        priceEach: l.priceEach,
      })),
      paymentMethod: sale.paymentMethod,
      customerName: sale.customerName,
      clientId: sale.clientId,
      timestamp: new Date(sale.timestamp).toISOString(),
    }),
  });
  return data.sale;
}

export async function fetchSales(locationId) {
  const qs = locationId ? `?locationId=${locationId}` : '';
  const data = await apiFetch(`/sales${qs}`);
  return data.sales;
}

export async function syncPull(locationId, since) {
  const params = new URLSearchParams();
  if (locationId) params.set('locationId', locationId);
  if (since) params.set('since', since);
  const data = await apiFetch(`/sync/pull?${params.toString()}`);
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  return apiFetch('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function fetchUsers() {
  const data = await apiFetch('/users');
  return data.users;
}

export async function createStaffUser({ name, username, password, locationId }) {
  const data = await apiFetch('/users', {
    method: 'POST',
    body: JSON.stringify({ name, username, password, role: 'staff', locationId }),
  });
  return data.user;
}
