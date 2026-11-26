-- Yondr marketing request portal: initial schema.
-- Times are ISO-8601 UTC strings; dates (due dates) are YYYY-MM-DD. JSON columns hold objects/arrays as text.

-- People. A row appears the first time someone signs in, or when an admin adds them.
CREATE TABLE users (
  email               TEXT PRIMARY KEY,                     -- lower-case @overyondr.com address (Access identity)
  name                TEXT,
  title               TEXT,
  department          TEXT,
  manager_email       TEXT,                                 -- default approver for this person's requests
  role                TEXT NOT NULL DEFAULT 'requester'     -- requester | marketing | lead | admin
                      CHECK (role IN ('requester', 'marketing', 'lead', 'admin')),
  is_approver         INTEGER NOT NULL DEFAULT 0,           -- can be picked as a request's approver
  email_updates       INTEGER NOT NULL DEFAULT 1,           -- email for updates (action-needed emails always go)
  active              INTEGER NOT NULL DEFAULT 1,
  added_by            TEXT,
  tour_done_at        TEXT,
  first_seen_at       TEXT,
  last_seen_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX users_role ON users (role);

-- Requests. ref = 'MR-' || (1000 + id). type_id is a key of src/catalog.ts.
CREATE TABLE requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ref                 TEXT UNIQUE,
  type_id             TEXT NOT NULL,
  category_id         TEXT NOT NULL,
  title               TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'pending_approval', 'needs_info', 'rejected', 'approved',
                                        'in_progress', 'in_review', 'on_hold', 'completed', 'cancelled')),
  prior_status        TEXT,                                 -- where needs_info / on_hold return to
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  is_rush             INTEGER NOT NULL DEFAULT 0,           -- due date is inside the type's standard lead time
  rush_reason         TEXT,
  requester_email     TEXT NOT NULL,
  approver_email      TEXT,
  assignee_email      TEXT,
  awaiting_email      TEXT,                                 -- who must answer an open blocking question
  department          TEXT,
  due_date            TEXT,                                 -- YYYY-MM-DD the requester needs it by
  brief               TEXT NOT NULL DEFAULT '{}',           -- JSON: answers to the type's questions
  brief_score         INTEGER NOT NULL DEFAULT 0,           -- 0-100 completeness when submitted
  links               TEXT NOT NULL DEFAULT '[]',           -- JSON: [{label, url}] deliverable links (e.g. ad library)
  revision_count      INTEGER NOT NULL DEFAULT 0,
  rating              INTEGER CHECK (rating BETWEEN 1 AND 5),
  rating_comment      TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  submitted_at        TEXT,
  decided_at          TEXT,                                 -- approved or rejected
  approved_at         TEXT,
  assigned_at         TEXT,
  started_at          TEXT,
  first_response_at   TEXT,                                 -- first comment/action by marketing after approval
  first_delivery_at   TEXT,
  completed_at        TEXT,
  closed_at           TEXT                                  -- completed, cancelled or rejected
);
CREATE INDEX requests_status ON requests (status);
CREATE INDEX requests_requester ON requests (requester_email, status);
CREATE INDEX requests_approver ON requests (approver_email, status);
CREATE INDEX requests_assignee ON requests (assignee_email, status);
CREATE INDEX requests_submitted ON requests (submitted_at);

-- People following a request (requester, approver and assignee are implied).
CREATE TABLE watchers (
  request_id          INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  added_by            TEXT,
  created_at          TEXT NOT NULL,
  PRIMARY KEY (request_id, email)
);
CREATE INDEX watchers_email ON watchers (email);

-- Conversation. kind: comment | question (blocking or not) | internal (marketing-only note) | system.
CREATE TABLE comments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id          INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  author_email        TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'question', 'internal', 'system')),
  body                TEXT NOT NULL,
  to_email            TEXT,                                 -- questions: who should answer
  blocking            INTEGER NOT NULL DEFAULT 0,           -- questions: work paused until answered
  parent_id           INTEGER REFERENCES comments (id) ON DELETE CASCADE,
  resolved_at         TEXT,                                 -- questions: answered
  resolved_by         TEXT,
  edited_at           TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX comments_request ON comments (request_id, id);
CREATE INDEX comments_open_questions ON comments (to_email, kind, resolved_at);

-- Files in R2. kind: reference (from the requester) | deliverable (from marketing; version = delivery round).
CREATE TABLE files (
  id                  TEXT PRIMARY KEY,                     -- random UUID
  request_id          INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('reference', 'deliverable')),
  name                TEXT NOT NULL,
  content_type        TEXT,
  size                INTEGER NOT NULL DEFAULT 0,
  r2_key              TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  uploaded_by         TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  deleted_at          TEXT
);
CREATE INDEX files_request ON files (request_id, kind);

-- Every change of status and every notable action: the request's timeline and the source for reports.
CREATE TABLE events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id          INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  actor_email         TEXT NOT NULL,
  action              TEXT NOT NULL,
  from_status         TEXT,
  to_status           TEXT,
  detail              TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL
);
CREATE INDEX events_request ON events (request_id, id);
CREATE INDEX events_created ON events (created_at);

-- In-app notifications (the bell). One row per recipient.
CREATE TABLE notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT NOT NULL,
  request_id          INTEGER REFERENCES requests (id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  actor_email         TEXT,
  text                TEXT NOT NULL,
  action_needed       INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  read_at             TEXT
);
CREATE INDEX notifications_email ON notifications (email, id);

-- Per-type settings managed by admins and leads (the catalog itself is code: src/catalog.ts).
CREATE TABLE type_settings (
  type_id             TEXT PRIMARY KEY,
  enabled             INTEGER NOT NULL DEFAULT 1,
  default_assignee    TEXT,                                 -- gets approved requests of this type
  lead_days           INTEGER,                              -- overrides the catalog's standard turnaround
  requires_approval   INTEGER,                              -- overrides the catalog (NULL = catalog default)
  updated_by          TEXT,
  updated_at          TEXT
);

-- Reminders already sent, so the scheduled job never repeats one the same day.
CREATE TABLE reminders (
  request_id          INTEGER NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  day                 TEXT NOT NULL,
  PRIMARY KEY (request_id, kind, day)
);

-- Admin audit log for role and settings changes.
CREATE TABLE audit (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email         TEXT NOT NULL,
  action              TEXT NOT NULL,
  target              TEXT,
  detail              TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL
);
