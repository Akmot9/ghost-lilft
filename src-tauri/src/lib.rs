use tauri_plugin_sql::{Migration, MigrationKind};

const SCHEMA_MIGRATION_SQL: &str = "CREATE TABLE IF NOT EXISTS seances (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exercises (
  seance_slug TEXT NOT NULL REFERENCES seances(slug) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  default_reps INTEGER NOT NULL,
  default_weight INTEGER NOT NULL,
  weight_unit TEXT NOT NULL,
  PRIMARY KEY (seance_slug, slug)
);
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seance_slug TEXT NOT NULL,
  exercise_slug TEXT NOT NULL,
  reps INTEGER NOT NULL,
  weight INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (seance_slug, exercise_slug) REFERENCES exercises(seance_slug, slug) ON DELETE CASCADE
);";

// Les séances d'exemple (mode découverte) sont marquées pour pouvoir être
// supprimées d'un geste sans toucher aux données réelles de l'utilisateur.
const DEMO_FLAG_MIGRATION_SQL: &str =
  "ALTER TABLE seances ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;";

// La graine de dev a pu être insérée avant l'existence du marqueur : on la
// rattrape. Uniquement en debug — en production la graine n'est jamais semée,
// et une séance créée par l'utilisateur ne doit jamais être marquée démo.
const DEMO_FLAG_BACKFILL_DEV_SQL: &str =
  "UPDATE seances SET is_demo = 1 WHERE slug = 'seance-principale';";

fn migrations() -> Vec<Migration> {
  let mut migrations = vec![
    Migration {
      version: 1,
      description: "create seances, exercises and sets tables",
      sql: SCHEMA_MIGRATION_SQL,
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "flag demo seances so they can be deleted in one action",
      sql: DEMO_FLAG_MIGRATION_SQL,
      kind: MigrationKind::Up,
    },
  ];

  if cfg!(debug_assertions) {
    migrations.push(Migration {
      version: 3,
      description: "backfill the pre-existing dev seed as demo",
      sql: DEMO_FLAG_BACKFILL_DEV_SQL,
      kind: MigrationKind::Up,
    });
  }

  migrations
}

// Must mirror the DB_CONNECTION split in src/stores/seances.ts (import.meta.env.DEV)
// exactly, or migrations get registered for a filename the frontend never opens
// and a fresh dev/debug launch fails with "no such table" on an unmigrated db.
fn db_connection_url() -> &'static str {
  if cfg!(debug_assertions) {
    "sqlite:ghostlift-dev.db"
  } else {
    "sqlite:ghostlift.db"
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations(db_connection_url(), migrations())
        .build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;
  use rusqlite::Connection;

  fn connection_with_schema() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory sqlite db");
    conn
      .execute_batch(SCHEMA_MIGRATION_SQL)
      .expect("migration SQL should be valid");
    conn
      .execute_batch(DEMO_FLAG_MIGRATION_SQL)
      .expect("demo flag migration SQL should be valid");
    conn
  }

  #[test]
  fn migrations_register_in_order() {
    let registered = migrations();

    // v3 (rattrapage de la graine) n'existe qu'en debug.
    let expected = if cfg!(debug_assertions) { 3 } else { 2 };
    assert_eq!(registered.len(), expected);
    for (index, migration) in registered.iter().enumerate() {
      assert_eq!(migration.version, index as i64 + 1);
    }
  }

  #[test]
  fn seances_table_has_the_demo_flag() {
    let conn = connection_with_schema();

    let mut stmt = conn.prepare("PRAGMA table_info(seances)").unwrap();
    let columns: Vec<String> = stmt
      .query_map([], |row| row.get::<_, String>(1))
      .unwrap()
      .filter_map(Result::ok)
      .collect();

    assert_eq!(columns, vec!["slug", "name", "is_demo"]);
  }

  #[test]
  fn migration_creates_the_three_expected_tables() {
    let conn = connection_with_schema();

    let mut stmt = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .unwrap();
    let tables: Vec<String> = stmt
      .query_map([], |row| row.get(0))
      .unwrap()
      .filter_map(Result::ok)
      .collect();

    assert!(tables.contains(&"seances".to_string()));
    assert!(tables.contains(&"exercises".to_string()));
    assert!(tables.contains(&"sets".to_string()));
  }

  #[test]
  fn sets_table_has_the_columns_the_frontend_expects() {
    let conn = connection_with_schema();

    let mut stmt = conn.prepare("PRAGMA table_info(sets)").unwrap();
    let columns: Vec<String> = stmt
      .query_map([], |row| row.get::<_, String>(1))
      .unwrap()
      .filter_map(Result::ok)
      .collect();

    assert_eq!(
      columns,
      vec![
        "id",
        "seance_slug",
        "exercise_slug",
        "reps",
        "weight",
        "completed_at",
      ]
    );
  }

  #[test]
  fn exercises_primary_key_is_scoped_to_its_seance() {
    let conn = connection_with_schema();
    conn
      .execute(
        "INSERT INTO seances (slug, name) VALUES ('a', 'Séance A')",
        [],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO seances (slug, name) VALUES ('b', 'Séance B')",
        [],
      )
      .unwrap();

    // The same exercise slug ("bench-press") must be allowed in two different
    // séances — exercise uniqueness is scoped per séance, not global.
    conn
      .execute(
        "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit)
         VALUES ('a', 'bench-press', 'Bench press', 5, 60, 'kg')",
        [],
      )
      .unwrap();
    let result = conn.execute(
      "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit)
       VALUES ('b', 'bench-press', 'Bench press', 5, 60, 'kg')",
      [],
    );

    assert!(result.is_ok());

    // But the same (seance_slug, slug) pair twice must be rejected.
    let duplicate = conn.execute(
      "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit)
       VALUES ('a', 'bench-press', 'Bench press again', 5, 60, 'kg')",
      [],
    );

    assert!(duplicate.is_err());
  }

  #[test]
  fn sets_are_rejected_for_an_exercise_that_does_not_exist() {
    let conn = connection_with_schema();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

    let result = conn.execute(
      "INSERT INTO sets (seance_slug, exercise_slug, reps, weight, completed_at)
       VALUES ('missing-seance', 'missing-exercise', 8, 60, '2026-01-01T00:00:00.000Z')",
      [],
    );

    assert!(result.is_err(), "expected the foreign key constraint to reject an orphan set");
  }

  #[test]
  fn seance_and_exercise_round_trip_through_the_schema() {
    let conn = connection_with_schema();
    conn
      .execute(
        "INSERT INTO seances (slug, name) VALUES ('seance-principale', 'Séance principale')",
        [],
      )
      .unwrap();
    conn
      .execute(
        "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit)
         VALUES ('seance-principale', 'bench-press', 'Bench press', 5, 60, 'kg')",
        [],
      )
      .unwrap();

    let name: String = conn
      .query_row(
        "SELECT name FROM seances WHERE slug = 'seance-principale'",
        [],
        |row| row.get(0),
      )
      .unwrap();
    let default_weight: i64 = conn
      .query_row(
        "SELECT default_weight FROM exercises WHERE seance_slug = 'seance-principale' AND slug = 'bench-press'",
        [],
        |row| row.get(0),
      )
      .unwrap();

    assert_eq!(name, "Séance principale");
    assert_eq!(default_weight, 60);
  }
}
