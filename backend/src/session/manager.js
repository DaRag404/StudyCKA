'use strict';

/**
 * In-memory session store.
 *
 * Shape per session:
 *   {
 *     status:      'starting' | 'waiting' | 'ready' | 'resetting' | 'error',
 *     containerId: string | null,
 *     error:       string | null,
 *   }
 */
const sessions = new Map();

/** Clean up sessions idle for more than ttlMs (default 45 min). */
const TTL_MS = 45 * 60 * 1000;
const lastSeen = new Map();

function touch(userId) {
  lastSeen.set(userId, Date.now());
}

function get(userId) {
  return sessions.get(userId) ?? null;
}

function set(userId, data) {
  sessions.set(userId, { ...sessions.get(userId), ...data });
}

function del(userId) {
  sessions.delete(userId);
  lastSeen.delete(userId);
}

function has(userId) {
  return sessions.has(userId);
}

/** Return all userIds whose sessions have been idle past TTL. */
function staleUserIds() {
  const now = Date.now();
  const stale = [];
  for (const [userId, ts] of lastSeen) {
    if (now - ts > TTL_MS) stale.push(userId);
  }
  return stale;
}

module.exports = { get, set, del, has, touch, staleUserIds };
