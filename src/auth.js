const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      locationId: user.location_id, // null for owner
    },
    JWT_SECRET,
    { expiresIn: '90d' } // long-lived: shop staff shouldn't have to re-login constantly
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { userId, role, locationId }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Resolves which location_id a request should operate on.
// Owner (locationId null) must specify ?locationId= or body.locationId.
// Staff are locked to their own location regardless of what they pass.
function resolveLocationId(req) {
  if (req.user.role === 'owner') {
    const requested = req.query.locationId || req.body.locationId;
    return requested ? Number(requested) : null;
  }
  return req.user.locationId;
}

module.exports = { signToken, authMiddleware, resolveLocationId, JWT_SECRET };
