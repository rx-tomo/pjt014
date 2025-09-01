// Minimal in-memory membership stub mapping user email -> allowed location IDs
// In production this should come from DB with RLS.

import { get_locations } from './locations_stub.js';

// Example mapping for demo. If not found, default to first 2 locations.
const DEMO_MAP = new Map(
  [
    ['owner1@example.com', ['loc1']],
    ['owner2@example.com', ['loc2', 'loc3']],
  ]
);

export function get_owned_location_ids(email) {
  if (!email || typeof email !== 'string') return [];
  if (DEMO_MAP.has(email)) return DEMO_MAP.get(email) || [];
  // デフォルトは空（明示割当がなければ編集不可）
  return [];
}
