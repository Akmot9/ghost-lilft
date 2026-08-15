use tauri::Manager;
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

  migrations.push(Migration {
    version: 4,
    description: "per-exercise rest duration",
    sql: REST_SECONDS_MIGRATION_SQL,
    kind: MigrationKind::Up,
  });

  migrations
}

// Le programme prescrit un repos propre à chaque exercice (1' à 2'30) :
// le minuteur le lit ici plutôt que d'imposer une durée globale.
const REST_SECONDS_MIGRATION_SQL: &str =
  "ALTER TABLE exercises ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 180;";

// Must mirror the DB_CONNECTION split in src/stores/seances.ts (import.meta.env.DEV)
// exactly, or migrations get registered for a filename the frontend never opens
// and a fresh dev/debug launch fails with "no such table" on an unmigrated db.
//
// Trois endroits doivent rester d'accord sur ce nom de fichier : ce module (pour
// les migrations), `db_file_path` (que la commande d'import ouvre en direct avec
// rusqlite) et `DB_CONNECTION` côté TypeScript. Un désaccord n'échoue pas
// bruyamment : l'import écrirait dans une base fantôme que l'app ne lit jamais.
// Le test `the_connection_url_and_the_file_name_agree` verrouille les deux
// moitiés côté Rust ; côté TypeScript c'est une vérification humaine.
fn db_file_name() -> &'static str {
  if cfg!(debug_assertions) {
    "ghostlift-dev.db"
  } else {
    "ghostlift.db"
  }
}

fn db_connection_url() -> &'static str {
  if cfg!(debug_assertions) {
    "sqlite:ghostlift-dev.db"
  } else {
    "sqlite:ghostlift.db"
  }
}

/// Le fichier que `tauri-plugin-sql` ouvre pour `db_connection_url()` : son
/// `path_mapper` (wrapper.rs) pose le nom de fichier dans `app_config_dir()`.
/// La commande d'import doit ouvrir exactement ce fichier-là.
fn db_file_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
  app
    .path()
    .app_config_dir()
    .map(|dir| dir.join(db_file_name()))
    .map_err(|error| format!("Répertoire de configuration introuvable : {error}"))
}

/// Une série telle que le frontend l'envoie. L'identifiant est explicite : la
/// mémoire et la base doivent porter les mêmes, sinon `removeSet` — qui
/// supprime par identifiant seul — effacerait la mauvaise ligne.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSet {
  pub id: i64,
  pub reps: i64,
  pub weight: i64,
  /// Date ISO 8601 en chaîne, comme la colonne `completed_at` la stocke déjà.
  pub completed_at: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExercise {
  pub slug: String,
  pub name: String,
  pub default_reps: i64,
  pub default_weight: i64,
  pub weight_unit: String,
  pub rest_seconds: i64,
  pub sets: Vec<ImportSet>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSeance {
  pub slug: String,
  pub name: String,
  pub exercises: Vec<ImportExercise>,
}

/// Remplace tout le contenu de la base par `seances`, en une seule transaction.
///
/// Tout ou rien : une erreur en cours de route (contrainte violée, écriture
/// impossible) fait retomber la transaction — rusqlite annule à la destruction —
/// et la base reste exactement dans l'état où elle était. C'est la raison d'être
/// de cette fonction : passer par `database.execute('BEGIN')` du plugin SQL ne
/// forme pas une transaction, chaque appel empruntant une connexion différente
/// du pool.
///
/// La validation du fichier de sauvegarde reste côté TypeScript (`parseBackup`),
/// qui lève avant d'appeler cette commande.
pub fn replace_all_seances(
  connection: &mut rusqlite::Connection,
  seances: &[ImportSeance],
) -> rusqlite::Result<()> {
  // Hors transaction : ce PRAGMA est ignoré à l'intérieur d'une transaction.
  // Les clés étrangères refusent alors une série orpheline plutôt que de la
  // laisser dans une base que l'app ne saurait plus lire.
  connection.execute_batch("PRAGMA foreign_keys = ON;")?;

  let transaction = connection.transaction()?;

  // Ordre imposé par les clés étrangères : les séries référencent les
  // exercices, qui référencent les séances.
  transaction.execute("DELETE FROM sets", [])?;
  transaction.execute("DELETE FROM exercises", [])?;
  transaction.execute("DELETE FROM seances", [])?;

  for seance in seances {
    // is_demo = 0 : ce que l'utilisateur restaure est à lui, la bannière du
    // mode découverte n'a pas à réapparaître.
    transaction.execute(
      "INSERT INTO seances (slug, name, is_demo) VALUES (?1, ?2, 0)",
      rusqlite::params![seance.slug, seance.name],
    )?;

    for exercise in &seance.exercises {
      transaction.execute(
        "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
          seance.slug,
          exercise.slug,
          exercise.name,
          exercise.default_reps,
          exercise.default_weight,
          exercise.weight_unit,
          exercise.rest_seconds,
        ],
      )?;

      for set in &exercise.sets {
        transaction.execute(
          "INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
          rusqlite::params![
            set.id,
            seance.slug,
            exercise.slug,
            set.reps,
            set.weight,
            set.completed_at,
          ],
        )?;
      }
    }
  }

  transaction.commit()
}

/// Commande mince : résout le fichier de base, l'ouvre, délègue.
#[tauri::command]
fn import_seances(app: tauri::AppHandle, seances: Vec<ImportSeance>) -> Result<(), String> {
  let path = db_file_path(&app)?;
  let mut connection = rusqlite::Connection::open(&path)
    .map_err(|error| format!("Base de données inaccessible : {error}"))?;

  replace_all_seances(&mut connection, &seances)
    .map_err(|error| format!("Restauration impossible : {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations(db_connection_url(), migrations())
        .build(),
    )
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![import_seances])
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

  fn import_set(id: i64, reps: i64, weight: i64, completed_at: &str) -> ImportSet {
    ImportSet {
      id,
      reps,
      weight,
      completed_at: completed_at.to_string(),
    }
  }

  fn import_exercise(slug: &str, name: &str, sets: Vec<ImportSet>) -> ImportExercise {
    ImportExercise {
      slug: slug.to_string(),
      name: name.to_string(),
      default_reps: 5,
      default_weight: 60,
      weight_unit: "kg".to_string(),
      rest_seconds: 120,
      sets,
    }
  }

  fn import_seance(slug: &str, name: &str, exercises: Vec<ImportExercise>) -> ImportSeance {
    ImportSeance {
      slug: slug.to_string(),
      name: name.to_string(),
      exercises,
    }
  }

  /// Tout le contenu des trois tables, sous une forme comparable : c'est
  /// l'empreinte qu'un import raté doit laisser intacte.
  fn database_contents(conn: &Connection) -> Vec<String> {
    let mut contents = Vec::new();

    let mut seances = conn
      .prepare("SELECT slug, name, is_demo FROM seances ORDER BY slug")
      .unwrap();
    contents.extend(
      seances
        .query_map([], |row| {
          Ok(format!(
            "seance {} {} {}",
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?
          ))
        })
        .unwrap()
        .map(Result::unwrap),
    );

    let mut exercises = conn
      .prepare(
        "SELECT seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds
         FROM exercises ORDER BY seance_slug, slug",
      )
      .unwrap();
    contents.extend(
      exercises
        .query_map([], |row| {
          Ok(format!(
            "exercise {} {} {} {} {} {} {}",
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?
          ))
        })
        .unwrap()
        .map(Result::unwrap),
    );

    let mut sets = conn
      .prepare(
        "SELECT id, seance_slug, exercise_slug, reps, weight, completed_at FROM sets ORDER BY id",
      )
      .unwrap();
    contents.extend(
      sets
        .query_map([], |row| {
          Ok(format!(
            "set {} {} {} {} {} {}",
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?
          ))
        })
        .unwrap()
        .map(Result::unwrap),
    );

    contents
  }

  /// Une base peuplée comme l'app la laisse : une séance de démonstration,
  /// son exercice, ses séries.
  fn connection_with_existing_data() -> Connection {
    let conn = connection_with_schema();
    conn
      .execute_batch(
        "INSERT INTO seances (slug, name, is_demo) VALUES ('upper-b', 'Upper B', 1);
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds)
           VALUES ('upper-b', 'developpe-couche', 'Développé couché', 8, 70, 'kg', 120);
         INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at)
           VALUES (41, 'upper-b', 'developpe-couche', 8, 70, '2026-08-01T10:00:00.000Z');
         INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at)
           VALUES (42, 'upper-b', 'developpe-couche', 7, 70, '2026-08-02T10:00:00.000Z');",
      )
      .unwrap();
    conn
  }

  fn connection_with_schema() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory sqlite db");
    conn
      .execute_batch(SCHEMA_MIGRATION_SQL)
      .expect("migration SQL should be valid");
    conn
      .execute_batch(DEMO_FLAG_MIGRATION_SQL)
      .expect("demo flag migration SQL should be valid");
    conn
      .execute_batch(REST_SECONDS_MIGRATION_SQL)
      .expect("rest seconds migration SQL should be valid");
    conn
  }

  #[test]
  fn migrations_register_in_increasing_version_order() {
    let registered = migrations();

    // v3 (rattrapage de la graine) n'existe qu'en debug.
    let expected = if cfg!(debug_assertions) { 4 } else { 3 };
    assert_eq!(registered.len(), expected);
    for pair in registered.windows(2) {
      assert!(pair[0].version < pair[1].version);
    }
  }

  #[test]
  fn exercises_table_has_the_rest_column() {
    let conn = connection_with_schema();

    let mut stmt = conn.prepare("PRAGMA table_info(exercises)").unwrap();
    let columns: Vec<String> = stmt
      .query_map([], |row| row.get::<_, String>(1))
      .unwrap()
      .filter_map(Result::ok)
      .collect();

    assert!(columns.contains(&"rest_seconds".to_string()));
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

  #[test]
  fn the_connection_url_and_the_file_name_agree() {
    // La commande d'import ouvre `db_file_name()` dans le répertoire de
    // configuration ; le plugin SQL y ouvre `db_connection_url()`. Les deux
    // doivent désigner le même fichier, sinon l'import écrit à côté.
    assert_eq!(db_connection_url(), format!("sqlite:{}", db_file_name()));
  }

  #[test]
  fn the_import_payload_deserializes_the_frontend_camel_case() {
    // Contrat avec `src/stores/seances.ts` : les clés envoyées par `invoke`
    // sont en camelCase, et `completedAt` est une date ISO en chaîne.
    let payload = r#"[{
      "slug": "lower",
      "name": "Lower",
      "exercises": [{
        "slug": "high-bar-squat",
        "name": "High bar squat",
        "defaultReps": 8,
        "defaultWeight": 60,
        "weightUnit": "kg",
        "restSeconds": 120,
        "sets": [{ "id": 7, "reps": 8, "weight": 60, "completedAt": "2026-08-10T09:00:00.000Z" }]
      }]
    }]"#;

    let seances: Vec<ImportSeance> = serde_json::from_str(payload).expect("payload should parse");

    assert_eq!(seances.len(), 1);
    assert_eq!(seances[0].exercises[0].default_reps, 8);
    assert_eq!(seances[0].exercises[0].rest_seconds, 120);
    assert_eq!(seances[0].exercises[0].sets[0].id, 7);
    assert_eq!(
      seances[0].exercises[0].sets[0].completed_at,
      "2026-08-10T09:00:00.000Z"
    );
  }

  #[test]
  fn a_successful_import_writes_seances_exercises_and_sets() {
    let mut conn = connection_with_existing_data();
    let seances = vec![
      import_seance(
        "lower",
        "Lower",
        vec![import_exercise(
          "high-bar-squat",
          "High bar squat",
          vec![
            import_set(7, 8, 60, "2026-08-10T09:00:00.000Z"),
            import_set(9, 6, 65, "2026-08-12T09:00:00.000Z"),
          ],
        )],
      ),
      import_seance(
        "upper-a",
        "Upper A",
        vec![import_exercise("tractions", "Tractions", vec![])],
      ),
    ];

    replace_all_seances(&mut conn, &seances).expect("import should succeed");

    assert_eq!(
      database_contents(&conn),
      vec![
        // Les séances restaurées appartiennent à l'utilisateur : is_demo = 0.
        "seance lower Lower 0".to_string(),
        "seance upper-a Upper A 0".to_string(),
        "exercise lower high-bar-squat High bar squat 5 60 kg 120".to_string(),
        "exercise upper-a tractions Tractions 5 60 kg 120".to_string(),
        // Identifiants de séries préservés (7 et 9, pas 1 et 2) : `removeSet`
        // supprime par identifiant seul.
        "set 7 lower high-bar-squat 8 60 2026-08-10T09:00:00.000Z".to_string(),
        "set 9 lower high-bar-squat 6 65 2026-08-12T09:00:00.000Z".to_string(),
      ]
    );
  }

  #[test]
  fn a_failed_import_leaves_the_database_untouched() {
    let mut conn = connection_with_existing_data();
    let before = database_contents(&conn);

    // Le second `lower` viole la clé primaire de `seances` : l'échec survient
    // après les DELETE et après une partie des insertions.
    let seances = vec![
      import_seance(
        "lower",
        "Lower",
        vec![import_exercise(
          "high-bar-squat",
          "High bar squat",
          vec![import_set(7, 8, 60, "2026-08-10T09:00:00.000Z")],
        )],
      ),
      import_seance("lower", "Lower (doublon)", vec![]),
    ];

    let result = replace_all_seances(&mut conn, &seances);

    assert!(result.is_err(), "l'import doit échouer sur le slug dupliqué");
    assert_eq!(
      database_contents(&conn),
      before,
      "un import raté ne doit rien laisser de modifié"
    );
    assert!(!before.is_empty(), "le test n'a de sens que sur une base peuplée");
  }

  #[test]
  fn a_failed_import_on_the_very_last_insert_leaves_the_database_untouched() {
    let mut conn = connection_with_existing_data();
    let before = database_contents(&conn);

    // Deux séries portant le même identifiant : la clé primaire de `sets`
    // refuse la seconde, tout au bout de la boucle d'insertion — après que
    // les DELETE et la quasi-totalité des INSERT ont eu lieu.
    let seances = vec![
      import_seance(
        "lower",
        "Lower",
        vec![import_exercise(
          "high-bar-squat",
          "High bar squat",
          vec![import_set(7, 8, 60, "2026-08-10T09:00:00.000Z")],
        )],
      ),
      import_seance(
        "upper-a",
        "Upper A",
        vec![import_exercise(
          "tractions",
          "Tractions",
          vec![import_set(7, 8, 60, "2026-08-11T09:00:00.000Z")],
        )],
      ),
    ];

    let result = replace_all_seances(&mut conn, &seances);

    assert!(
      result.is_err(),
      "l'import doit échouer sur l'identifiant de série dupliqué"
    );
    assert_eq!(
      database_contents(&conn),
      before,
      "un import raté au dernier INSERT ne doit rien laisser de modifié"
    );
  }

  #[test]
  fn an_empty_import_empties_the_database() {
    let mut conn = connection_with_existing_data();

    replace_all_seances(&mut conn, &[]).expect("importer zéro séance doit réussir");

    assert!(database_contents(&conn).is_empty());
  }
}
