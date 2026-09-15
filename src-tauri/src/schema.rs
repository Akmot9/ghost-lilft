//! Le schéma SQLite et son application, en rusqlite (#72).
//!
//! Jusqu'ici les migrations étaient déclarées en Rust mais **déclenchées par le
//! frontend** : `tauri-plugin-sql` ne les appliquait qu'au moment où Vue
//! appelait `Database.load`. Le premier écran de l'app dépendait donc d'une
//! permission SQL du WebView pour que la base soit prête — exactement ce que
//! l'epic #73 veut retirer.
//!
//! Le migrateur vit maintenant ici, et chaque ouverture de base y passe.
//!
//! ## Compatibilité avec les bases déjà migrées
//!
//! `tauri-plugin-sql` s'appuie sur sqlx, qui note ce qu'il a appliqué dans
//! `_sqlx_migrations`. Les appareils déjà installés portent cette table, avec
//! un schéma à jour jusqu'à une certaine version. La réappliquer casserait :
//! les migrations sont des `ALTER TABLE`, qui échouent sur une colonne
//! existante.
//!
//! On lit donc `_sqlx_migrations` — quand elle existe — comme une **ligne
//! d'eau** : tout ce qui lui est inférieur ou égal est réputé appliqué. Au-delà
//! d'elle, le migrateur tient sa propre table. Les checksums de sqlx ne sont
//! jamais relus : ils décrivent un format qui ne nous appartient plus.

use rusqlite::Connection;

/// Une migration ordonnée. La version est son identité : elle ne change jamais,
/// et une migration livrée ne se modifie pas — on en ajoute une nouvelle.
pub struct SchemaMigration {
  pub version: i64,
  pub description: &'static str,
  pub sql: &'static str,
}

const APPLIED_TABLE_SQL: &str = "CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);";

/// Applique ce qui manque, dans l'ordre des versions, chacune en transaction.
/// Rend le nombre de migrations réellement appliquées — zéro sur une base déjà
/// à jour, ce qui rend l'appel gratuit à chaque ouverture.
pub fn apply(connection: &mut Connection, migrations: &[SchemaMigration]) -> rusqlite::Result<usize> {
  connection.execute_batch(APPLIED_TABLE_SQL)?;

  let watermark = plugin_watermark(connection)?;
  let mut applied = 0;

  for migration in migrations {
    if migration.version <= watermark || already_applied(connection, migration.version)? {
      continue;
    }

    let transaction = connection.transaction()?;
    transaction.execute_batch(migration.sql)?;
    transaction.execute(
      "INSERT INTO schema_migrations (version, description) VALUES (?1, ?2)",
      rusqlite::params![migration.version, migration.description],
    )?;
    transaction.commit()?;

    applied += 1;
  }

  Ok(applied)
}

/// La plus haute version que `tauri-plugin-sql` avait appliquée, ou zéro quand
/// la base n'est jamais passée par lui — une installation neuve.
fn plugin_watermark(connection: &Connection) -> rusqlite::Result<i64> {
  let exists: i64 = connection.query_row(
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    [],
    |row| row.get(0),
  )?;

  if exists == 0 {
    return Ok(0);
  }

  connection.query_row(
    "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations",
    [],
    |row| row.get(0),
  )
}

fn already_applied(connection: &Connection, version: i64) -> rusqlite::Result<bool> {
  let count: i64 = connection.query_row(
    "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
    [version],
    |row| row.get(0),
  )?;

  Ok(count == 1)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn migrations() -> Vec<SchemaMigration> {
    vec![
      SchemaMigration {
        version: 1,
        description: "create widgets",
        sql: "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
      },
      SchemaMigration {
        version: 2,
        description: "add a colour",
        sql: "ALTER TABLE widgets ADD COLUMN colour TEXT NOT NULL DEFAULT '';",
      },
    ]
  }

  fn columns(connection: &Connection) -> Vec<String> {
    let mut statement = connection.prepare("PRAGMA table_info(widgets)").unwrap();
    let names = statement
      .query_map([], |row| row.get::<_, String>(1))
      .unwrap()
      .collect::<rusqlite::Result<Vec<_>>>()
      .unwrap();
    names
  }

  #[test]
  fn an_empty_database_receives_every_migration() {
    let mut connection = Connection::open_in_memory().unwrap();

    let applied = apply(&mut connection, &migrations()).unwrap();

    assert_eq!(applied, 2);
    assert_eq!(columns(&connection), vec!["id", "colour"]);
  }

  #[test]
  fn applying_twice_changes_nothing() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply(&mut connection, &migrations()).unwrap();

    // Le second passage est celui de chaque ouverture de base : il doit être
    // gratuit, et surtout ne pas rejouer un ALTER TABLE.
    let applied = apply(&mut connection, &migrations()).unwrap();

    assert_eq!(applied, 0);
    assert_eq!(columns(&connection), vec!["id", "colour"]);
  }

  #[test]
  fn a_database_already_migrated_by_the_sql_plugin_is_left_alone() {
    let mut connection = Connection::open_in_memory().unwrap();
    // Ce qu'un appareil déjà installé porte : le schéma à jour, et la table de
    // suivi de sqlx qui dit jusqu'où.
    connection
      .execute_batch(
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY, colour TEXT NOT NULL DEFAULT '');
         CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY);
         INSERT INTO _sqlx_migrations (version) VALUES (1), (2);",
      )
      .unwrap();

    let applied = apply(&mut connection, &migrations()).unwrap();

    assert_eq!(applied, 0);
    assert_eq!(columns(&connection), vec!["id", "colour"]);
  }

  #[test]
  fn a_database_half_migrated_by_the_plugin_receives_only_the_rest() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection
      .execute_batch(
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY);
         CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY);
         INSERT INTO _sqlx_migrations (version) VALUES (1);",
      )
      .unwrap();

    let applied = apply(&mut connection, &migrations()).unwrap();

    assert_eq!(applied, 1);
    assert_eq!(columns(&connection), vec!["id", "colour"]);
  }

  #[test]
  fn a_failing_migration_leaves_the_database_as_it_was() {
    let mut connection = Connection::open_in_memory().unwrap();
    let broken = vec![
      SchemaMigration {
        version: 1,
        description: "create widgets",
        sql: "CREATE TABLE widgets (id INTEGER PRIMARY KEY);",
      },
      SchemaMigration {
        version: 2,
        description: "nonsense",
        sql: "ALTER TABLE absent ADD COLUMN colour TEXT;",
      },
    ];

    assert!(apply(&mut connection, &broken).is_err());

    // La première est passée et notée, la seconde n'a rien laissé derrière.
    assert_eq!(columns(&connection), vec!["id"]);
    assert!(!already_applied(&connection, 2).unwrap());
  }
}
