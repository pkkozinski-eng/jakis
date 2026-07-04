// Uproszczona autoryzacja: nick + PIN. Token sesji to podpisany HMAC-em
// ladunek {id, iat}. Token trzymany jest po stronie klienta (localStorage),
// dzieki czemu gracz wraca na swoje konto z dowolnego urzadzenia. Sekret
// jest trwaly (patrz db.getSessionSecret), wiec tokeny przezywaja restart.

import crypto from 'node:crypto';
import { getSessionSecret, getPlayerById } from './db.js';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 120; // 120 dni

function sign(data) {
  return crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
}

export function createToken(playerId) {
  const payload = JSON.stringify({ id: playerId, iat: Date.now() });
  const body = Buffer.from(payload).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = sign(body);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (Date.now() - payload.iat > TOKEN_TTL_MS) return null;
    return payload.id;
  } catch {
    return null;
  }
}

// Middleware: dolacza req.player jesli token poprawny (nie wymusza).
export function attachPlayer(req, _res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const id = verifyToken(token);
  req.player = id ? getPlayerById(id) : null;
  next();
}

// Middleware: wymaga zalogowania.
export function requireAuth(req, res, next) {
  if (!req.player) return res.status(401).json({ error: 'Wymagane logowanie' });
  next();
}

// Middleware: wymaga uprawnien administratora.
export function requireAdmin(req, res, next) {
  if (!req.player) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (!req.player.is_admin) return res.status(403).json({ error: 'Brak uprawnien administratora' });
  next();
}
