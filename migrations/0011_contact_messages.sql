-- Contact form messages (registry Worker, POST /contact). Forward-only.
--
-- Messages are stored only to be answered and deleted once dealt with (see the privacy
-- note on the form). The IP address is never stored: ip_hash is SHA-256 of the address
-- plus a salt, used only to limit a sender to five messages an hour.
--
-- Apply remotely with `wrangler d1 execute baromontres --remote --yes --file
-- migrations/0011_contact_messages.sql` (see docs/runbooks/price-pages-switch-on.md).

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  name       TEXT,
  email      TEXT,
  page       TEXT,                         -- the page the message is about (a path)
  message    TEXT    NOT NULL,
  ip_hash    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done'))
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_ip ON contact_messages(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status, id);
