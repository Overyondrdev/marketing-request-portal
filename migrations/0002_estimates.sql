-- Delivery estimates: whoever picks up the work estimates when it will be ready (replaces fixed turnaround per type).
ALTER TABLE requests ADD COLUMN estimated_date TEXT;       -- YYYY-MM-DD the assignee expects to deliver by (latest)
ALTER TABLE requests ADD COLUMN first_estimate_date TEXT;  -- the first estimate given, for estimate accuracy reports
ALTER TABLE requests ADD COLUMN estimate_note TEXT;        -- why, or what the estimate depends on
ALTER TABLE requests ADD COLUMN estimated_at TEXT;
