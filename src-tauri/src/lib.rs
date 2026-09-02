use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

// Le contrat AppApi (#66) : DTO canoniques, invariants, format d'erreur. Les
// commandes migreront dessus cas d'usage par cas d'usage (#68 et suivantes).
pub mod contract;

// Le semis du programme de démonstration (#55) et le remplacement d'une
// graine restée intacte (#53) — premier cas d'usage porté sur le contrat.
pub mod bootstrap;

// Le poids de corps : une pesée par jour, saisie à la main dans l'app.
pub mod body_weight;

// Les mutations de séances et d'exercices (#68) : créer, renommer, ajouter,
// réordonner, adopter ou supprimer la démo — chacune en transaction.
pub mod mutations;

// La lecture de la base vers les DTO canoniques, partagée par les commandes.
pub mod queries;

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

  migrations.push(Migration {
    version: 5,
    description: "flag dumbbell exercises so entered weight is doubled",
    sql: DUMBBELL_MIGRATION_SQL,
    kind: MigrationKind::Up,
  });

  migrations.push(Migration {
    version: 6,
    description: "flag warm-up sets so they stay outside working-set metrics",
    sql: WARMUP_SET_MIGRATION_SQL,
    kind: MigrationKind::Up,
  });

  migrations.push(Migration {
    version: 7,
    description: "order exercises within a seance",
    sql: EXERCISE_POSITION_MIGRATION_SQL,
    kind: MigrationKind::Up,
  });

  migrations.push(Migration {
    version: 8,
    description: "key-value meta table, first used to fingerprint the demo seed",
    sql: META_MIGRATION_SQL,
    kind: MigrationKind::Up,
  });

  migrations.push(Migration {
    version: 9,
    description: "perceived effort (RPE) on sets",
    sql: RPE_MIGRATION_SQL,
    kind: MigrationKind::Up,
  });

  migrations.push(Migration {
    version: 10,
    description: "daily body weight",
    sql: BODY_WEIGHT_MIGRATION_SQL,
    kind: MigrationKind::Up,
  });

  migrations
}

// Le programme prescrit un repos propre à chaque exercice (1' à 2'30) :
// le minuteur le lit ici plutôt que d'imposer une durée globale.
const REST_SECONDS_MIGRATION_SQL: &str =
  "ALTER TABLE exercises ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 180;";

// L'interface saisit le poids d'un haltère, mais la base et tout l'historique
// conservent la charge totale des deux haltères.
const DUMBBELL_MIGRATION_SQL: &str =
  "ALTER TABLE exercises ADD COLUMN is_dumbbell INTEGER NOT NULL DEFAULT 0;";

// Les gammes montantes restent dans le carnet, sans devenir S1/S2/S3 ni
// gonfler fantôme, records et volume de travail.
const WARMUP_SET_MIGRATION_SQL: &str =
  "ALTER TABLE sets ADD COLUMN is_warmup INTEGER NOT NULL DEFAULT 0;";

// Un coin pour ce qui n'est ni séance, ni exercice, ni série : d'abord
// l'empreinte du semis de démonstration (`bootstrap.rs`), qui distingue une
// démo intacte — remplaçable quand le programme d'exemple change — d'une démo
// où l'utilisateur a enregistré quelque chose.
const META_MIGRATION_SQL: &str =
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);";

// L'effort perçu (RPE 1-10, demi-points) d'une série de travail. Nullable :
// une série non notée reste non notée, l'app ne devine jamais un effort.
const RPE_MIGRATION_SQL: &str = "ALTER TABLE sets ADD COLUMN rpe REAL;";

// Une pesée par jour calendaire (clé primaire) : la dernière lecture du jour
// fait foi, comme sur le pèse-personne.
const BODY_WEIGHT_MIGRATION_SQL: &str = "CREATE TABLE IF NOT EXISTS body_weights (
  day TEXT PRIMARY KEY,
  kilograms REAL NOT NULL
);";

// L'ordre des exercices dans une séance est celui du programme, pas celui de
// leur création : il doit pouvoir changer. Jusqu'ici la lecture s'en remettait
// à l'ordre d'insertion (le `rowid`), qu'aucun `ORDER BY` ne garantissait et
// qu'aucune action ne pouvait modifier. Le remplissage reprend précisément cet
// ordre d'insertion, séance par séance : les programmes déjà saisis gardent
// l'ordre que l'utilisateur voyait avant la mise à jour.
const EXERCISE_POSITION_MIGRATION_SQL: &str =
  "ALTER TABLE exercises ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE exercises SET position = (
  SELECT COUNT(*) FROM exercises AS earlier
  WHERE earlier.seance_slug = exercises.seance_slug AND earlier.rowid < exercises.rowid
);";

// Rust est la seule source de vérité pour ce nom de fichier. Il ne doit plus
// être recalculé ailleurs : côté TypeScript, `src/stores/seances.ts` appelle
// la commande `db_file_name` ci-dessous avant d'ouvrir la connexion SQL, au
// lieu de dupliquer `cfg!(debug_assertions)` en `import.meta.env.DEV`. Les
// deux signaux coïncident sous `tauri dev` et `tauri build`, mais divergent
// sous `tauri build --debug` (donc `tauri ios build --debug`) : le hook
// `beforeBuildCommand` lance `vite build`, qui compile toujours en mode
// production (`import.meta.env.DEV === false`), alors que le binaire Rust,
// lui, reste en `debug_assertions`. Un TypeScript qui recalculerait le nom
// localement ouvrirait alors `ghostlift.db` pendant que les migrations et
// l'import visent `ghostlift-dev.db` — un désaccord qui n'échoue pas
// bruyamment, juste une base jamais migrée.
#[tauri::command]
fn db_file_name() -> &'static str {
  if cfg!(debug_assertions) {
    "ghostlift-dev.db"
  } else {
    "ghostlift.db"
  }
}

/// Dérivée de `db_file_name()` : l'accord entre le nom de fichier utilisé par
/// `db_file_path` (commande d'import, ouverture directe via rusqlite) et
/// l'URL enregistrée auprès de `tauri-plugin-sql` (migrations) est vrai par
/// construction, plus par la coïncidence de deux `cfg!` séparés.
fn db_connection_url() -> String {
  format!("sqlite:{}", db_file_name())
}

/// Le fichier que `tauri-plugin-sql` ouvre pour `db_connection_url()` : son
/// `path_mapper` (wrapper.rs) pose le nom de fichier dans `app_config_dir()`.
/// La commande d'import doit ouvrir exactement ce fichier-là.
fn db_file_path<R: tauri::Runtime>(
  app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
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
  /// Charge totale en kilogrammes. Fractionnaire depuis 1.7 : un total impair
  /// réparti sur deux haltères, ou une marche de rampe, tombe sur le
  /// demi-kilo (32,5 kg). Un entier Rust refuserait la sauvegarde entière.
  pub weight: f64,
  /// Date ISO 8601 en chaîne, comme la colonne `completed_at` la stocke déjà.
  pub completed_at: String,
  #[serde(default)]
  pub is_warmup: bool,
  /// Effort perçu (RPE), absent des sauvegardes antérieures à la v3.
  #[serde(default)]
  pub rpe: Option<f64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExercise {
  pub slug: String,
  pub name: String,
  pub default_reps: i64,
  /// Même unité que `ImportSet::weight` : des kilogrammes, au demi-kilo près.
  pub default_weight: f64,
  pub weight_unit: String,
  pub rest_seconds: i64,
  #[serde(default)]
  pub is_dumbbell: bool,
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

    // L'ordre du tableau *est* l'ordre du programme : la charge utile ne porte
    // pas de champ `position`, elle porte la liste dans l'ordre où
    // l'utilisateur veut voir ses exercices. On le fige ici en colonne, sans
    // quoi la restauration rendrait l'ordre d'insertion — le même par hasard
    // aujourd'hui, plus du tout dès que la lecture trie sur `position`.
    for (position, exercise) in seance.exercises.iter().enumerate() {
      transaction.execute(
        "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell, position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
          seance.slug,
          exercise.slug,
          exercise.name,
          exercise.default_reps,
          exercise.default_weight,
          exercise.weight_unit,
          exercise.rest_seconds,
          exercise.is_dumbbell,
          position as i64,
        ],
      )?;

      for set in &exercise.sets {
        transaction.execute(
          "INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup, rpe)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
          rusqlite::params![
            set.id,
            seance.slug,
            exercise.slug,
            set.reps,
            set.weight,
            set.completed_at,
            set.is_warmup,
            set.rpe,
          ],
        )?;
      }
    }
  }

  transaction.commit()
}

/// Commande mince : résout le fichier de base, l'ouvre, délègue.
///
/// Générique sur le runtime — comme `db_file_path` juste au-dessus — pour une
/// seule raison : `tauri::AppHandle` sans paramètre vaut `AppHandle<Wry>`, et
/// une commande qui exige `Wry` ne peut pas être enregistrée sur le
/// `MockRuntime` du module `tauri::test`. Sans cette généricité, le contrat IPC
/// (nom de la commande, nom de l'argument `seances`, camelCase des champs) ne
/// serait vérifiable qu'à l'œil nu. Voir le test
/// `invoking_import_seances_by_name_writes_the_reference_payload`. Le corps est
/// inchangé et `run()` continue d'instancier `Wry`, déduit à l'enregistrement.
#[tauri::command]
fn import_seances<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  seances: Vec<ImportSeance>,
) -> Result<(), String> {
  let path = db_file_path(&app)?;
  let mut connection = rusqlite::Connection::open(&path)
    .map_err(|error| format!("Base de données inaccessible : {error}"))?;

  replace_all_seances(&mut connection, &seances)
    .map_err(|error| format!("Restauration impossible : {error}"))
}

/// L'ouverture commune des commandes du contrat : le fichier décidé par Rust,
/// tout échec en `AppError` — jamais une chaîne brute.
fn open_contract_db<R: tauri::Runtime>(
  app: &tauri::AppHandle<R>,
) -> Result<rusqlite::Connection, contract::AppError> {
  let path = db_file_path(app)
    .map_err(|message| contract::AppError::new(contract::codes::STOCKAGE_INDISPONIBLE, message))?;

  rusqlite::Connection::open(&path).map_err(contract::AppError::storage)
}

/// Commande mince, comme `import_seances` : résout le fichier, l'ouvre,
/// délègue à `bootstrap::bootstrap`. Sème le programme de démonstration si la
/// base est vide, rafraîchit une démo restée intacte, rend l'état complet —
/// et une `AppError` du contrat en cas d'échec, jamais une chaîne brute.
#[tauri::command]
fn bootstrap_seances<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  seed: Vec<contract::Seance>,
) -> Result<Vec<contract::Seance>, contract::AppError> {
  bootstrap::bootstrap(&mut open_contract_db(&app)?, &seed)
}

// Les mutations de séances et d'exercices (#68) : chaque commande est un cas
// d'usage de `mutations.rs` — validation avant écriture, transaction, et
// l'agrégat réellement persisté en retour, que Pinia applique tel quel.

#[tauri::command]
fn create_seance<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  name: String,
  exercises: Vec<mutations::CreateExerciseInput>,
) -> Result<contract::Seance, contract::AppError> {
  mutations::create_seance(&mut open_contract_db(&app)?, &name, &exercises)
}

#[tauri::command]
fn rename_seance<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  seance_slug: String,
  name: String,
) -> Result<contract::Seance, contract::AppError> {
  mutations::rename_seance(&mut open_contract_db(&app)?, &seance_slug, &name)
}

#[tauri::command]
fn add_exercise<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  seance_slug: String,
  input: mutations::CreateExerciseInput,
) -> Result<contract::Exercise, contract::AppError> {
  mutations::add_exercise(&mut open_contract_db(&app)?, &seance_slug, &input)
}

#[tauri::command]
fn move_exercise<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  seance_slug: String,
  exercise_slug: String,
  direction: mutations::Direction,
) -> Result<Option<contract::Seance>, contract::AppError> {
  mutations::move_exercise(
    &mut open_contract_db(&app)?,
    &seance_slug,
    &exercise_slug,
    direction,
  )
}

#[tauri::command]
fn set_exercise_dumbbell<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  seance_slug: String,
  exercise_slug: String,
  is_dumbbell: bool,
) -> Result<contract::Exercise, contract::AppError> {
  mutations::set_exercise_dumbbell(
    &mut open_contract_db(&app)?,
    &seance_slug,
    &exercise_slug,
    is_dumbbell,
  )
}

#[tauri::command]
fn adopt_demo_seances<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
) -> Result<Vec<contract::Seance>, contract::AppError> {
  mutations::adopt_demo_seances(&mut open_contract_db(&app)?)
}

#[tauri::command]
fn list_body_weights<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
) -> Result<Vec<body_weight::BodyWeight>, contract::AppError> {
  body_weight::list(&open_contract_db(&app)?)
}

#[tauri::command]
fn log_body_weight<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  day: String,
  kilograms: f64,
) -> Result<Vec<body_weight::BodyWeight>, contract::AppError> {
  body_weight::log(&open_contract_db(&app)?, &day, kilograms)
}

#[tauri::command]
fn delete_body_weight<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  day: String,
) -> Result<Vec<body_weight::BodyWeight>, contract::AppError> {
  body_weight::delete(&open_contract_db(&app)?, &day)
}

#[tauri::command]
fn delete_demo_data<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
) -> Result<Vec<contract::Seance>, contract::AppError> {
  mutations::delete_demo_data(&mut open_contract_db(&app)?)
}

/// La liste des commandes exposées au frontend, en un seul endroit : `run()`
/// l'enregistre, et les tests l'enregistrent aussi sur le `MockRuntime`. Sans
/// ce partage, un test pourrait invoquer une commande que l'application réelle
/// n'expose pas — il vérifierait alors la commande, mais pas le fait qu'elle
/// soit branchée.
fn invoke_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
  tauri::generate_handler![
    import_seances,
    db_file_name,
    bootstrap_seances,
    create_seance,
    rename_seance,
    add_exercise,
    move_exercise,
    set_exercise_dumbbell,
    adopt_demo_seances,
    delete_demo_data,
    list_body_weights,
    log_body_weight,
    delete_body_weight
  ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations(&db_connection_url(), migrations())
        .build(),
    )
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(invoke_handler())
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

  fn import_set(id: i64, reps: i64, weight: f64, completed_at: &str) -> ImportSet {
    ImportSet {
      id,
      reps,
      weight,
      completed_at: completed_at.to_string(),
      is_warmup: false,
      rpe: None,
    }
  }

  fn import_exercise(slug: &str, name: &str, sets: Vec<ImportSet>) -> ImportExercise {
    ImportExercise {
      slug: slug.to_string(),
      name: name.to_string(),
      default_reps: 5,
      default_weight: 60.0,
      weight_unit: "kg".to_string(),
      rest_seconds: 120,
      is_dumbbell: false,
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
        "SELECT seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell
         FROM exercises ORDER BY seance_slug, slug",
      )
      .unwrap();
    contents.extend(
      exercises
        .query_map([], |row| {
          Ok(format!(
            "exercise {} {} {} {} {} {} {} {}",
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, f64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?
          ))
        })
        .unwrap()
        .map(Result::unwrap),
    );

    let mut sets = conn
      .prepare(
        "SELECT id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup FROM sets ORDER BY id",
      )
      .unwrap();
    contents.extend(
      sets
        .query_map([], |row| {
          Ok(format!(
            "set {} {} {} {} {} {} {}",
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, f64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?
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
      .execute_batch(DUMBBELL_MIGRATION_SQL)
      .expect("dumbbell migration SQL should be valid");
    conn
      .execute_batch(WARMUP_SET_MIGRATION_SQL)
      .expect("warm-up migration SQL should be valid");
    conn
      .execute_batch(EXERCISE_POSITION_MIGRATION_SQL)
      .expect("exercise position migration SQL should be valid");
    conn
      .execute_batch(META_MIGRATION_SQL)
      .expect("meta migration SQL should be valid");
    conn
      .execute_batch(RPE_MIGRATION_SQL)
      .expect("rpe migration SQL should be valid");
    conn
      .execute_batch(BODY_WEIGHT_MIGRATION_SQL)
      .expect("body weight migration SQL should be valid");
    conn
  }

  #[test]
  fn migrations_register_in_increasing_version_order() {
    let registered = migrations();

    // v3 (rattrapage de la graine) n'existe qu'en debug.
    let expected = if cfg!(debug_assertions) { 10 } else { 9 };
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
  fn exercises_table_has_the_dumbbell_flag() {
    let conn = connection_with_schema();

    let mut stmt = conn.prepare("PRAGMA table_info(exercises)").unwrap();
    let columns: Vec<String> = stmt
      .query_map([], |row| row.get::<_, String>(1))
      .unwrap()
      .filter_map(Result::ok)
      .collect();

    assert!(columns.contains(&"is_dumbbell".to_string()));
  }

  #[test]
  fn exercises_table_has_the_position_column() {
    let conn = connection_with_schema();

    let mut stmt = conn.prepare("PRAGMA table_info(exercises)").unwrap();
    let columns: Vec<String> = stmt
      .query_map([], |row| row.get::<_, String>(1))
      .unwrap()
      .filter_map(Result::ok)
      .collect();

    assert!(columns.contains(&"position".to_string()));
  }

  /// Une base d'avant la colonne `position` ne porte que l'ordre d'insertion.
  /// C'est celui que l'utilisateur voit à l'écran : la migration doit le
  /// reconduire, sinon la mise à jour rebattrait les exercices de tout le
  /// monde. Numérotation par séance, indépendamment des autres.
  #[test]
  fn the_position_migration_backfills_the_insertion_order_per_seance() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA_MIGRATION_SQL).unwrap();
    conn.execute_batch(DEMO_FLAG_MIGRATION_SQL).unwrap();
    conn.execute_batch(REST_SECONDS_MIGRATION_SQL).unwrap();
    conn
      .execute_batch(
        "INSERT INTO seances (slug, name) VALUES ('upper-a', 'Upper A');
         INSERT INTO seances (slug, name) VALUES ('lower', 'Lower');
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds)
           VALUES ('upper-a', 'developpe-couche', 'Développé couché', 8, 70, 'kg', 120);
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds)
           VALUES ('lower', 'squat', 'Squat', 5, 100, 'kg', 180);
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds)
           VALUES ('upper-a', 'tractions', 'Tractions', 8, 0, 'kg', 150);",
      )
      .unwrap();

    conn.execute_batch(EXERCISE_POSITION_MIGRATION_SQL).unwrap();

    let mut stmt = conn
      .prepare("SELECT seance_slug, slug, position FROM exercises ORDER BY seance_slug, position")
      .unwrap();
    let rows: Vec<String> = stmt
      .query_map([], |row| {
        Ok(format!(
          "{} {} {}",
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, i64>(2)?
        ))
      })
      .unwrap()
      .map(Result::unwrap)
      .collect();

    assert_eq!(
      rows,
      vec![
        "lower squat 0".to_string(),
        "upper-a developpe-couche 0".to_string(),
        "upper-a tractions 1".to_string(),
      ]
    );
  }

  /// L'ordre du tableau reçu est l'ordre voulu : une restauration doit le
  /// rendre tel quel, y compris quand il contredit l'ordre alphabétique des
  /// identifiants (le seul que la base rendrait sans colonne `position`).
  #[test]
  fn a_successful_import_writes_the_exercise_order_as_positions() {
    let mut conn = connection_with_existing_data();
    let seances = vec![import_seance(
      "lower",
      "Lower",
      vec![
        import_exercise("squat", "Squat", vec![]),
        import_exercise("presse", "Presse", vec![]),
        import_exercise("leg-curl", "Leg curl", vec![]),
      ],
    )];

    replace_all_seances(&mut conn, &seances).expect("import should succeed");

    let mut stmt = conn
      .prepare("SELECT slug FROM exercises WHERE seance_slug = 'lower' ORDER BY position")
      .unwrap();
    let slugs: Vec<String> = stmt
      .query_map([], |row| row.get::<_, String>(0))
      .unwrap()
      .map(Result::unwrap)
      .collect();

    assert_eq!(slugs, vec!["squat", "presse", "leg-curl"]);
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
        "is_warmup",
        "rpe",
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

    assert!(
      result.is_err(),
      "expected the foreign key constraint to reject an orphan set"
    );
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
  fn db_connection_url_is_derived_from_the_file_name() {
    // `db_connection_url()` est construite à partir de `db_file_name()` :
    // l'accord entre les deux est vrai par construction. Ce test protège
    // uniquement le format de dérivation ("sqlite:" + nom de fichier), pas
    // l'accord lui-même — il ne peut plus se rompre.
    assert_eq!(db_connection_url(), format!("sqlite:{}", db_file_name()));
  }

  #[test]
  fn db_file_name_matches_the_build_profile() {
    // Seule vérité qui reste falsifiable côté Rust : le nom choisi selon
    // `cfg!(debug_assertions)`. `src/stores/seances.ts` n'a plus sa propre
    // opinion sur ce nom : il demande la commande `db_file_name` et l'utilise
    // telle quelle, donc il n'y a plus de moitié TypeScript à verrouiller ici.
    let expected = if cfg!(debug_assertions) {
      "ghostlift-dev.db"
    } else {
      "ghostlift.db"
    };

    assert_eq!(db_file_name(), expected);
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
        "isDumbbell": true,
        "sets": [{ "id": 7, "reps": 8, "weight": 60, "completedAt": "2026-08-10T09:00:00.000Z", "isWarmup": true }]
      }]
    }]"#;

    let seances: Vec<ImportSeance> = serde_json::from_str(payload).expect("payload should parse");

    assert_eq!(seances.len(), 1);
    assert_eq!(seances[0].exercises[0].default_reps, 8);
    assert_eq!(seances[0].exercises[0].rest_seconds, 120);
    assert!(seances[0].exercises[0].is_dumbbell);
    assert_eq!(seances[0].exercises[0].sets[0].id, 7);
    assert!(seances[0].exercises[0].sets[0].is_warmup);
    assert_eq!(
      seances[0].exercises[0].sets[0].completed_at,
      "2026-08-10T09:00:00.000Z"
    );
  }

  #[test]
  fn a_successful_import_writes_seances_exercises_and_sets() {
    let mut conn = connection_with_existing_data();
    let mut seances = vec![
      import_seance(
        "lower",
        "Lower",
        vec![import_exercise(
          "high-bar-squat",
          "High bar squat",
          vec![
            import_set(7, 8, 60.0, "2026-08-10T09:00:00.000Z"),
            import_set(9, 6, 65.0, "2026-08-12T09:00:00.000Z"),
          ],
        )],
      ),
      import_seance(
        "upper-a",
        "Upper A",
        vec![import_exercise("tractions", "Tractions", vec![])],
      ),
    ];
    seances[0].exercises[0].is_dumbbell = true;
    seances[0].exercises[0].sets[0].is_warmup = true;

    replace_all_seances(&mut conn, &seances).expect("import should succeed");

    assert_eq!(
      database_contents(&conn),
      vec![
        // Les séances restaurées appartiennent à l'utilisateur : is_demo = 0.
        "seance lower Lower 0".to_string(),
        "seance upper-a Upper A 0".to_string(),
        "exercise lower high-bar-squat High bar squat 5 60 kg 120 1".to_string(),
        "exercise upper-a tractions Tractions 5 60 kg 120 0".to_string(),
        // Identifiants de séries préservés (7 et 9, pas 1 et 2) : `removeSet`
        // supprime par identifiant seul.
        "set 7 lower high-bar-squat 8 60 2026-08-10T09:00:00.000Z 1".to_string(),
        "set 9 lower high-bar-squat 6 65 2026-08-12T09:00:00.000Z 0".to_string(),
      ]
    );
  }

  /// Depuis 1.7, le front accepte le demi-kilo (total impair sur deux
  /// haltères, marche de rampe à 32,5 kg). Un `weight: i64` refusait alors la
  /// sauvegarde entière à la désérialisation — la donnée existait dans l'app,
  /// mais sa restauration était impossible.
  #[test]
  fn fractional_half_kilo_weights_survive_an_import() {
    let mut conn = connection_with_existing_data();
    let mut seances = vec![import_seance(
      "upper-a",
      "Upper A",
      vec![import_exercise(
        "curl-halteres",
        "Curl haltères",
        vec![import_set(3, 10, 32.5, "2026-08-10T09:00:00.000Z")],
      )],
    )];
    seances[0].exercises[0].default_weight = 12.5;

    let payload = serde_json::json!([{
      "slug": "upper-a",
      "name": "Upper A",
      "exercises": [{
        "slug": "curl-halteres",
        "name": "Curl haltères",
        "defaultReps": 10,
        "defaultWeight": 12.5,
        "weightUnit": "kg",
        "restSeconds": 120,
        "isDumbbell": true,
        "sets": [{ "id": 3, "reps": 10, "weight": 32.5, "completedAt": "2026-08-10T09:00:00.000Z", "isWarmup": false }]
      }]
    }]);
    let deserialized: Vec<ImportSeance> =
      serde_json::from_value(payload).expect("fractional weights should deserialize");
    assert_eq!(deserialized[0].exercises[0].sets[0].weight, 32.5);

    replace_all_seances(&mut conn, &seances).expect("import should succeed");

    assert_eq!(
      database_contents(&conn),
      vec![
        "seance upper-a Upper A 0".to_string(),
        "exercise upper-a curl-halteres Curl haltères 5 12.5 kg 120 0".to_string(),
        "set 3 upper-a curl-halteres 10 32.5 2026-08-10T09:00:00.000Z 0".to_string(),
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
          vec![import_set(7, 8, 60.0, "2026-08-10T09:00:00.000Z")],
        )],
      ),
      import_seance("lower", "Lower (doublon)", vec![]),
    ];

    let result = replace_all_seances(&mut conn, &seances);

    assert!(
      result.is_err(),
      "l'import doit échouer sur le slug dupliqué"
    );
    assert_eq!(
      database_contents(&conn),
      before,
      "un import raté ne doit rien laisser de modifié"
    );
    assert!(
      !before.is_empty(),
      "le test n'a de sens que sur une base peuplée"
    );
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
          vec![import_set(7, 8, 60.0, "2026-08-10T09:00:00.000Z")],
        )],
      ),
      import_seance(
        "upper-a",
        "Upper A",
        vec![import_exercise(
          "tractions",
          "Tractions",
          vec![import_set(7, 8, 60.0, "2026-08-11T09:00:00.000Z")],
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

  // ————————————————————————————————————————————————————————————————————————
  // Sur un vrai fichier
  //
  // Tous les tests ci-dessus travaillent sur `Connection::open_in_memory()` :
  // une base qui n'existe que le temps du test et qu'on ne peut ni fermer ni
  // rouvrir. Ils ne disent donc rien de ce qui atterrit réellement sur le
  // disque — or c'est là que vit la base de l'utilisateur, et c'est ce chemin
  // qu'aucun test n'exerçait. Les deux tests suivants ferment la connexion et
  // rouvrent le fichier : l'équivalent automatisé de « tuer l'app et la
  // relancer ».
  // ————————————————————————————————————————————————————————————————————————

  /// Les mêmes migrations que `connection_with_schema`, mais sur un fichier.
  /// Volontairement séparé plutôt que factorisé : les tests en mémoire déjà en
  /// place ne doivent pas changer de sens parce qu'on en ajoute d'autres.
  fn migrated_file_connection(path: &std::path::Path) -> Connection {
    let conn = Connection::open(path).expect("open file-backed sqlite db");
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
      .execute_batch(DUMBBELL_MIGRATION_SQL)
      .expect("dumbbell migration SQL should be valid");
    conn
      .execute_batch(WARMUP_SET_MIGRATION_SQL)
      .expect("warm-up migration SQL should be valid");
    conn
      .execute_batch(EXERCISE_POSITION_MIGRATION_SQL)
      .expect("exercise position migration SQL should be valid");
    conn
      .execute_batch(META_MIGRATION_SQL)
      .expect("meta migration SQL should be valid");
    conn
      .execute_batch(RPE_MIGRATION_SQL)
      .expect("rpe migration SQL should be valid");
    conn
      .execute_batch(BODY_WEIGHT_MIGRATION_SQL)
      .expect("body weight migration SQL should be valid");
    conn
  }

  /// Ferme pour de bon : `Connection::close` rend la main sur une erreur de
  /// fermeture au lieu de l'avaler comme le fait `drop`.
  fn close(connection: Connection) {
    connection
      .close()
      .map_err(|(_, error)| error)
      .expect("closing the connection should succeed");
  }

  /// Les données d'origine posées par `connection_with_existing_data`, mais sur
  /// une connexion fichier.
  fn seed_existing_data(conn: &Connection) {
    conn
      .execute_batch(
        "INSERT INTO seances (slug, name, is_demo) VALUES ('upper-b', 'Upper B', 1);
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds)
           VALUES ('upper-b', 'developpe-couche', 'Développé couché', 8, 70, 'kg', 120);
         INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at)
           VALUES (41, 'upper-b', 'developpe-couche', 8, 70, '2026-08-01T10:00:00.000Z');",
      )
      .unwrap();
  }

  #[test]
  fn a_successful_import_is_still_there_after_reopening_the_file() {
    let directory = tempfile::tempdir().expect("create temp dir");
    let path = directory.path().join("ghostlift-test.db");

    let conn = migrated_file_connection(&path);
    seed_existing_data(&conn);
    close(conn);

    let mut conn = Connection::open(&path).expect("reopen for the import");
    replace_all_seances(
      &mut conn,
      &[
        import_seance(
          "lower",
          "Lower",
          vec![import_exercise(
            "high-bar-squat",
            "High bar squat",
            vec![
              import_set(7, 8, 60.0, "2026-08-10T09:00:00.000Z"),
              import_set(9, 6, 65.0, "2026-08-12T09:00:00.000Z"),
            ],
          )],
        ),
        import_seance(
          "upper-a",
          "Upper A",
          vec![import_exercise("tractions", "Tractions", vec![])],
        ),
      ],
    )
    .expect("import should succeed");
    close(conn);

    // Rouvrir le fichier : plus rien ne vient de la mémoire du processus.
    let reopened = Connection::open(&path).expect("reopen after the import");

    assert_eq!(
      database_contents(&reopened),
      vec![
        "seance lower Lower 0".to_string(),
        "seance upper-a Upper A 0".to_string(),
        "exercise lower high-bar-squat High bar squat 5 60 kg 120 0".to_string(),
        "exercise upper-a tractions Tractions 5 60 kg 120 0".to_string(),
        "set 7 lower high-bar-squat 8 60 2026-08-10T09:00:00.000Z 0".to_string(),
        "set 9 lower high-bar-squat 6 65 2026-08-12T09:00:00.000Z 0".to_string(),
      ],
      "ce qui a été importé doit se relire intégralement après réouverture"
    );
  }

  #[test]
  fn a_failed_import_leaves_the_reopened_file_with_its_original_content() {
    let directory = tempfile::tempdir().expect("create temp dir");
    let path = directory.path().join("ghostlift-test.db");

    let conn = migrated_file_connection(&path);
    seed_existing_data(&conn);
    let before = database_contents(&conn);
    close(conn);

    // Deux séries au même identifiant : la clé primaire de `sets` refuse la
    // seconde, après les DELETE et la quasi-totalité des INSERT.
    let mut conn = Connection::open(&path).expect("reopen for the import");
    let result = replace_all_seances(
      &mut conn,
      &[
        import_seance(
          "lower",
          "Lower",
          vec![import_exercise(
            "high-bar-squat",
            "High bar squat",
            vec![import_set(7, 8, 60.0, "2026-08-10T09:00:00.000Z")],
          )],
        ),
        import_seance(
          "upper-a",
          "Upper A",
          vec![import_exercise(
            "tractions",
            "Tractions",
            vec![import_set(7, 8, 60.0, "2026-08-11T09:00:00.000Z")],
          )],
        ),
      ],
    );
    assert!(
      result.is_err(),
      "l'import doit échouer sur l'identifiant dupliqué"
    );
    close(conn);

    // Le rollback en mémoire ne prouve rien du fichier : c'est ici que se
    // verrait une base laissée à moitié vidée sur le disque.
    let reopened = Connection::open(&path).expect("reopen after the failed import");

    assert!(
      !before.is_empty(),
      "le test n'a de sens que sur une base peuplée"
    );
    assert_eq!(
      database_contents(&reopened),
      before,
      "après un import raté, le fichier rouvert doit montrer le contenu d'origine"
    );
  }

  // ————————————————————————————————————————————————————————————————————————
  // Contrat TypeScript ↔ Rust
  //
  // NE SUPPRIME PAS `fixtures/import-payload.json`.
  //
  // Ce fichier est produit par `src/stores/__tests__/importPayload.spec.ts` à
  // partir de la **vraie** fonction du store, `toImportPayload` — c'est-à-dire
  // exactement ce que l'app passe à `invoke('import_seances', …)`. Les deux
  // tests ci-dessous le relisent depuis Rust. Rien d'autre ne relie les deux
  // langages : un champ renommé d'un seul côté compile, passe les tests de son
  // propre côté, et casse la restauration chez l'utilisateur.
  //
  //   - renommé côté TypeScript → le test vitest voit le fichier diverger ;
  //   - renommé côté Rust → la désérialisation du fichier échoue ici.
  //
  // Quand le format change des deux côtés volontairement, le fichier se
  // régénère : `GHOST_LIFT_UPDATE_FIXTURES=1 npm run test:unit`.
  // ————————————————————————————————————————————————————————————————————————

  /// Le fichier de référence, tel que le produit le frontend.
  const REFERENCE_PAYLOAD: &str = include_str!("../../fixtures/import-payload.json");

  /// Une requête IPC telle que `invoke(cmd, args)` la forme côté frontend.
  fn ipc_request(cmd: &str, args: serde_json::Value) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
      cmd: cmd.into(),
      callback: tauri::ipc::CallbackFn(0),
      error: tauri::ipc::CallbackFn(1),
      url: "tauri://localhost".parse().unwrap(),
      body: tauri::ipc::InvokeBody::Json(args),
      headers: Default::default(),
      invoke_key: tauri::test::INVOKE_KEY.to_string(),
    }
  }

  #[test]
  fn the_reference_payload_from_typescript_deserializes() {
    let seances: Vec<ImportSeance> = serde_json::from_str(REFERENCE_PAYLOAD)
      .expect("fixtures/import-payload.json doit se désérialiser dans les structures Import*");

    // Garde-fou : un fichier vide se désérialiserait sans rien prouver.
    assert_eq!(
      seances.iter().map(|s| s.slug.as_str()).collect::<Vec<_>>(),
      vec!["upper-a", "lower", "ma-seance"]
    );
    let sets: usize = seances
      .iter()
      .flat_map(|seance| &seance.exercises)
      .map(|exercise| exercise.sets.len())
      .sum();
    assert_eq!(sets, 22, "le fichier de référence doit porter des séries");

    // Les champs camelCase sont bien arrivés dans les champs snake_case.
    let exercise = &seances[0].exercises[0];
    assert_eq!(exercise.slug, "developpe-couche");
    assert_eq!(exercise.default_reps, 8);
    assert_eq!(exercise.default_weight, 70.0);
    assert_eq!(exercise.weight_unit, "kg");
    assert_eq!(exercise.rest_seconds, 120);
    assert!(!exercise.is_dumbbell);
    assert_eq!(exercise.sets[0].completed_at, "2026-07-25T18:00:00.000Z");
  }

  /// L'autre commande que le frontend appelle par son nom : `getDb()`, dans
  /// `src/stores/seances.ts`, fait `invoke<string>('db_file_name')` puis
  /// `Database.load('sqlite:' + nom)`. Renommer la commande, ou l'ôter de la
  /// liste d'`invoke_handler()`, laisserait l'app sans base — sans rien casser
  /// à la compilation, des deux côtés.
  #[test]
  fn invoking_db_file_name_by_name_returns_the_database_file() {
    let app = tauri::test::mock_builder()
      .invoke_handler(invoke_handler())
      .build(tauri::generate_context!())
      .expect("monter l'application de test");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .expect("construire la webview de test");

    tauri::test::assert_ipc_response(
      &webview,
      ipc_request("db_file_name", serde_json::json!({})),
      Ok(db_file_name()),
    );
  }

  /// Invoque réellement `import_seances` par son nom, à travers l'IPC, avec la
  /// charge utile du frontend — ce que ni un appel direct à
  /// `replace_all_seances` ni une désérialisation isolée ne vérifient : le nom
  /// de la commande enregistrée et le nom de l'argument (`seances`).
  ///
  /// Tourne sans interface graphique : `tauri::test::mock_builder()` monte
  /// l'application sur le `MockRuntime`, sans fenêtre ni webview réelle.
  /// `XDG_CONFIG_HOME`/`HOME` sont globales au processus de test : les tests
  /// qui redirigent le répertoire de configuration se sérialisent sur ce
  /// verrou pour ne pas se marcher dessus.
  static CONFIG_DIR_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

  #[test]
  fn invoking_import_seances_by_name_writes_the_reference_payload() {
    let _guard = CONFIG_DIR_GUARD.lock().unwrap();
    let directory = tempfile::tempdir().expect("create temp dir");

    // La commande écrit dans `app_config_dir()`, c'est-à-dire le répertoire de
    // configuration de l'utilisateur : on le déplace dans le répertoire
    // temporaire pour que le test n'aille pas toucher la vraie base de dev.
    // `dirs::config_dir()` relit ces variables à chaque appel.
    //
    // Ces variables sont globales au processus de test, qui exécute ses tests
    // en parallèle : c'est acceptable ici parce qu'aucun autre test ne lit le
    // répertoire de configuration, et parce que l'assertion `starts_with`
    // ci-dessous refuse d'écrire si la redirection n'a pas pris.
    std::env::set_var("XDG_CONFIG_HOME", directory.path().join("config"));
    std::env::set_var("HOME", directory.path());

    // `invoke_handler()` — le même que celui de `run()` : une commande retirée
    // de la liste réelle fait tomber ce test.
    let app = tauri::test::mock_builder()
      .invoke_handler(invoke_handler())
      .build(tauri::generate_context!())
      .expect("monter l'application de test");

    let config_dir = app
      .path()
      .app_config_dir()
      .expect("répertoire de configuration");

    // Filet de sécurité : si la redirection ci-dessus n'a pas pris (plateforme
    // qui n'écoute pas ces variables), on s'arrête avant d'écrire quoi que ce
    // soit dans le vrai répertoire de l'utilisateur.
    assert!(
      config_dir.starts_with(directory.path()),
      "le test refuse d'écrire hors de son répertoire temporaire : {config_dir:?}"
    );
    std::fs::create_dir_all(&config_dir).expect("créer le répertoire de configuration");

    // La commande n'applique pas les migrations : sous Tauri c'est
    // `tauri-plugin-sql` qui les a déjà passées sur ce même fichier.
    close(migrated_file_connection(&config_dir.join(db_file_name())));

    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .expect("construire la webview de test");

    let payload: serde_json::Value =
      serde_json::from_str(REFERENCE_PAYLOAD).expect("le fichier de référence doit être du JSON");

    // Le nom de la commande et le nom de l'argument sont ceux que
    // `src/stores/seances.ts` écrit dans son `invoke(...)`.
    let response = tauri::test::get_ipc_response(
      &webview,
      ipc_request("import_seances", serde_json::json!({ "seances": payload })),
    );

    assert!(
      response.is_ok(),
      "l'invocation doit aboutir, or : {:?}",
      response.err()
    );

    // Et la commande a bien écrit : on rouvre le fichier qu'elle a choisi.
    let written = Connection::open(config_dir.join(db_file_name())).expect("rouvrir la base");
    let contents = database_contents(&written);

    assert_eq!(
      contents
        .iter()
        .filter(|row| row.starts_with("seance "))
        .count(),
      3
    );
    assert_eq!(
      contents
        .iter()
        .filter(|row| row.starts_with("set "))
        .count(),
      22
    );
    assert!(
      contents.contains(&"seance upper-a Upper A 0".to_string()),
      "les séances restaurées appartiennent à l'utilisateur (is_demo = 0)"
    );
  }

  /// Invoque réellement `bootstrap_seances` par son nom, avec l'argument
  /// `seed` — les deux noms que `src/lib/appApiTauri.ts` écrit dans son
  /// `invoke(...)`. Vérifie aussi la moitié « erreur » du contrat : la réponse
  /// d'échec est une AppError sérialisée, pas une chaîne.
  #[test]
  fn invoking_bootstrap_seances_by_name_seeds_and_returns_app_errors() {
    let _guard = CONFIG_DIR_GUARD.lock().unwrap();
    let directory = tempfile::tempdir().expect("create temp dir");
    std::env::set_var("XDG_CONFIG_HOME", directory.path().join("config"));
    std::env::set_var("HOME", directory.path());

    let app = tauri::test::mock_builder()
      .invoke_handler(invoke_handler())
      .build(tauri::generate_context!())
      .expect("monter l'application de test");

    let config_dir = app
      .path()
      .app_config_dir()
      .expect("répertoire de configuration");
    assert!(
      config_dir.starts_with(directory.path()),
      "le test refuse d'écrire hors de son répertoire temporaire : {config_dir:?}"
    );
    std::fs::create_dir_all(&config_dir).expect("créer le répertoire de configuration");
    close(migrated_file_connection(&config_dir.join(db_file_name())));

    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .expect("construire la webview de test");

    let seed = serde_json::json!([{
      "slug": "upper-a",
      "name": "Upper A",
      "isDemo": true,
      "exercises": [{
        "slug": "developpe-couche",
        "name": "Développé couché",
        "defaultReps": 8,
        "defaultWeight": 62.5,
        "weightUnit": "kg",
        "restSeconds": 120,
        "isDumbbell": false,
        "sets": [{
          "id": 1,
          "reps": 8,
          "weight": 60,
          "completedAt": "2026-08-01T18:00:00.000Z",
          "isWarmup": false,
          "rpe": 8.5
        }]
      }]
    }]);

    let response = tauri::test::get_ipc_response(
      &webview,
      ipc_request("bootstrap_seances", serde_json::json!({ "seed": seed })),
    );
    let state = response
      .expect("le semis doit aboutir")
      .deserialize::<serde_json::Value>()
      .expect("la réponse doit être du JSON");

    // La commande rend l'état canonique complet, drapeau démo compris.
    assert_eq!(state, seed);

    // Une graine invalide échoue en AppError sérialisée : code et message.
    let invalid = serde_json::json!([{
      "slug": "Upper A", "name": "Upper A", "isDemo": true, "exercises": []
    }]);
    let error = tauri::test::get_ipc_response(
      &webview,
      ipc_request("bootstrap_seances", serde_json::json!({ "seed": invalid })),
    )
    .expect_err("une graine invalide doit être refusée");

    assert_eq!(error["code"], "slug-invalide");
    assert!(error["message"].as_str().unwrap().contains("slug"));
  }

  /// Invoque les sept commandes de mutation (#68) par leur nom, avec leurs
  /// arguments camelCase — exactement ce que `src/lib/appApiTauri.ts` écrit.
  /// Un nom de commande ou d'argument renommé d'un seul côté tombe ici.
  #[test]
  fn invoking_the_mutation_commands_by_name_round_trips() {
    let _guard = CONFIG_DIR_GUARD.lock().unwrap();
    let directory = tempfile::tempdir().expect("create temp dir");
    std::env::set_var("XDG_CONFIG_HOME", directory.path().join("config"));
    std::env::set_var("HOME", directory.path());

    let app = tauri::test::mock_builder()
      .invoke_handler(invoke_handler())
      .build(tauri::generate_context!())
      .expect("monter l'application de test");

    let config_dir = app
      .path()
      .app_config_dir()
      .expect("répertoire de configuration");
    assert!(
      config_dir.starts_with(directory.path()),
      "le test refuse d'écrire hors de son répertoire temporaire : {config_dir:?}"
    );
    std::fs::create_dir_all(&config_dir).expect("créer le répertoire de configuration");

    let conn = migrated_file_connection(&config_dir.join(db_file_name()));
    conn
      .execute_batch(
        "INSERT INTO seances (slug, name, is_demo) VALUES ('upper-a', 'Upper A', 1);
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell, position)
           VALUES ('upper-a', 'developpe-couche', 'Développé couché', 8, 70, 'kg', 120, 0, 0);",
      )
      .unwrap();
    close(conn);

    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .expect("construire la webview de test");

    let call = |cmd: &str, args: serde_json::Value| {
      tauri::test::get_ipc_response(&webview, ipc_request(cmd, args))
        .map(|body| body.deserialize::<serde_json::Value>().unwrap())
    };

    // create_seance : les défauts s'appliquent (repos 180, pas d'haltères).
    let created = call(
      "create_seance",
      serde_json::json!({
        "name": "Lower",
        "exercises": [
          { "name": "Squat", "defaultReps": 5, "defaultWeight": 100, "weightUnit": "kg" },
          { "name": "Presse", "defaultReps": 10, "defaultWeight": 150, "weightUnit": "kg", "restSeconds": 90 }
        ]
      }),
    )
    .expect("create_seance doit aboutir");
    assert_eq!(created["slug"], "lower");
    assert_eq!(created["exercises"][0]["restSeconds"], 180);
    assert_eq!(created["exercises"][0]["isDumbbell"], false);

    let renamed = call(
      "rename_seance",
      serde_json::json!({ "seanceSlug": "lower", "name": "Lower A" }),
    )
    .expect("rename_seance doit aboutir");
    assert_eq!(renamed["name"], "Lower A");

    let added = call(
      "add_exercise",
      serde_json::json!({
        "seanceSlug": "lower",
        "input": { "name": "Leg curl", "defaultReps": 10, "defaultWeight": 30, "weightUnit": "kg" }
      }),
    )
    .expect("add_exercise doit aboutir");
    assert_eq!(added["slug"], "leg-curl");

    let moved = call(
      "move_exercise",
      serde_json::json!({ "seanceSlug": "lower", "exerciseSlug": "leg-curl", "direction": "up" }),
    )
    .expect("move_exercise doit aboutir");
    assert_eq!(
      moved["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["slug"].as_str().unwrap())
        .collect::<Vec<_>>(),
      vec!["squat", "leg-curl", "presse"]
    );

    // Aux extrémités : la réponse est le `null` JSON, pas une erreur.
    let stuck = call(
      "move_exercise",
      serde_json::json!({ "seanceSlug": "lower", "exerciseSlug": "squat", "direction": "up" }),
    )
    .expect("move_exercise en butée doit aboutir");
    assert!(stuck.is_null());

    let dumbbell = call(
      "set_exercise_dumbbell",
      serde_json::json!({ "seanceSlug": "lower", "exerciseSlug": "squat", "isDumbbell": true }),
    )
    .expect("set_exercise_dumbbell doit aboutir");
    assert_eq!(dumbbell["isDumbbell"], true);

    let adopted =
      call("adopt_demo_seances", serde_json::json!({})).expect("adopt_demo_seances doit aboutir");
    assert!(adopted
      .as_array()
      .unwrap()
      .iter()
      .all(|seance| seance["isDemo"] == false));

    let remaining =
      call("delete_demo_data", serde_json::json!({})).expect("delete_demo_data doit aboutir");
    // La démo a été adoptée juste avant : plus rien n'est démo, rien ne part.
    assert_eq!(remaining.as_array().unwrap().len(), 2);

    // La moitié « erreur » : une cible absente échoue en AppError sérialisée.
    let error = call(
      "rename_seance",
      serde_json::json!({ "seanceSlug": "absente", "name": "Nom" }),
    )
    .expect_err("une séance absente doit être refusée");
    assert_eq!(error["code"], "introuvable");
  }
}
