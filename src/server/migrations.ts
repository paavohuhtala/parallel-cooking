import type { DatabaseSync } from 'node:sqlite'

/**
 * Ordered, append-only. Index + 1 is the schema version recorded in
 * `PRAGMA user_version`; never edit one that has shipped.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE menu (
    id               TEXT PRIMARY KEY,
    name             TEXT    NOT NULL,
    doc              TEXT    NOT NULL,             -- Menu as JSON
    doc_hash         TEXT    NOT NULL,             -- sha256 of doc
    template_id      TEXT,                         -- provenance; NULL once authored in-app
    follows_template INTEGER NOT NULL DEFAULT 0,
    version          INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );

  CREATE TABLE room (
    id           TEXT PRIMARY KEY,                 -- the URL id
    name         TEXT    NOT NULL,
    menu_id      TEXT    NOT NULL REFERENCES menu(id),
    state        TEXT    NOT NULL,                 -- KitchenState as JSON
    version      INTEGER NOT NULL DEFAULT 0,       -- monotonic, bumped per applied command
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE INDEX room_menu_idx ON room(menu_id);

  -- Append-only audit trail; the only way to answer "who undid my soup".
  CREATE TABLE command_log (
    room_id    TEXT    NOT NULL REFERENCES room(id),
    version    INTEGER NOT NULL,                   -- room.version AFTER applying
    client_id  TEXT    NOT NULL,
    command_id TEXT    NOT NULL,
    cmd        TEXT    NOT NULL,                   -- Command as JSON
    at         INTEGER NOT NULL,
    PRIMARY KEY (room_id, version)
  );
  `,

  `
  -- A library menu is one nobody is cooking yet: editable, listable, and copied
  -- rather than shared when a kitchen starts from it. Room-owned copies keep the
  -- default 0, so every existing row is already correct.
  ALTER TABLE menu ADD COLUMN is_library INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE menu ADD COLUMN description TEXT;
  CREATE INDEX menu_library_idx ON menu(is_library, updated_at);
  `,
]

export function migrate(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const from = row.user_version

  for (let v = from; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(MIGRATIONS[v])
      // PRAGMA cannot be parameterised, and v is a loop index over a literal
      // array, so interpolation here is not a user-input path.
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${v + 1} failed: ${String(err)}`)
    }
  }

  return MIGRATIONS.length - from
}
