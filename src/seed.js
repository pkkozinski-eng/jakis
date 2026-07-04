// Skrypt inicjalizujacy baze: terminarz (380 meczow), konto administratora
// oraz startowy link zaproszenia. Uruchamiany automatycznie przy starcie
// serwera (jesli baza pusta) lub recznie: `npm run seed`.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  countMatches,
  insertMatchesBulk,
  getPlayerByNick,
  createPlayer,
  listInvites,
  createInvite,
} from './db.js';
import { generateSchedule, assignKickoffs, DEFAULT_TEAMS } from './fixtures.js';

export function seedSchedule() {
  if (countMatches() > 0) return { inserted: 0, skipped: true };
  const matches = assignKickoffs(generateSchedule(DEFAULT_TEAMS));
  insertMatchesBulk(matches);
  return { inserted: matches.length, skipped: false };
}

export function seedAdmin() {
  const nick = process.env.ADMIN_NICK || 'admin';
  const existing = getPlayerByNick(nick);
  if (existing) return { created: false, nick, pin: null };

  const pin = process.env.ADMIN_PIN || String(crypto.randomInt(1000, 9999));
  const pinHash = bcrypt.hashSync(pin, 10);
  createPlayer({ nick, pinHash, isAdmin: 1 });
  return { created: true, nick, pin };
}

export function seedInvite() {
  const invites = listInvites();
  if (invites.length > 0) return { token: invites[0].token, created: false };
  const token = crypto.randomBytes(9).toString('base64url');
  createInvite(token, 'Startowy link zaproszenia');
  return { token, created: true };
}

export function runSeed() {
  const schedule = seedSchedule();
  const admin = seedAdmin();
  const invite = seedInvite();
  return { schedule, admin, invite };
}

// Uruchomienie bezposrednie: node src/seed.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runSeed();
  console.log('--- Seed zakonczony ---');
  console.log(`Terminarz: ${res.schedule.skipped ? 'juz istnial (pominieto)' : res.schedule.inserted + ' meczow dodano'}`);
  if (res.admin.created) {
    console.log(`Administrator utworzony: nick="${res.admin.nick}"  PIN=${res.admin.pin}`);
    console.log('  >> ZAPISZ TEN PIN! (mozesz go ustawic przez ADMIN_PIN w ENV)');
  } else {
    console.log(`Administrator "${res.admin.nick}" juz istnial.`);
  }
  console.log(`Link zaproszenia (token): ${res.invite.token}`);
  process.exit(0);
}
