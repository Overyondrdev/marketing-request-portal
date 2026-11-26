// App-wide state: who is signed in, the people directory and the catalog's live settings. Loaded once, refreshed
// on demand. Views import { store } and call the loaders they need.

import { api } from './api.js';
import { atLeast } from '../shared/workflow.js';

export const store = {
  me: null,
  counts: { approvals: 0, unread: 0, unassigned: 0 },
  emailEnabled: false,
  people: null,
  settings: null,
};

export async function loadMe() {
  const d = await api.get('/api/me');
  store.me = d.me;
  store.counts = d.counts;
  store.emailEnabled = d.email_enabled;
  return d.me;
}
export async function loadPeople(force = false) {
  if (!store.people || force) store.people = (await api.get('/api/people')).people;
  return store.people;
}
export async function loadSettings(force = false) {
  if (!store.settings || force) store.settings = (await api.get('/api/catalog')).settings;
  return store.settings;
}
export const isMarketing = () => atLeast(store.me?.role, 'marketing');
export const isLead = () => atLeast(store.me?.role, 'lead');
export const isAdmin = () => atLeast(store.me?.role, 'admin');
/** Names for every known person, for nameOf(). */
export function peopleNames() {
  const out = {};
  for (const p of store.people || []) out[p.email] = p.name;
  return out;
}
