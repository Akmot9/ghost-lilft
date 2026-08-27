//! Le semis du programme de démonstration, côté Rust (#55), et le
//! remplacement d'une graine restée intacte quand le programme d'exemple
//! change (#53).
//!
//! Le front fournit la graine (elle est datée relativement à « maintenant »,
//! et le jeu de données vit en TypeScript où le repli navigateur l'utilise
//! aussi) ; Rust décide et écrit :
//!
//! - base vide → la graine est validée puis semée dans une vraie transaction
//!   rusqlite — tout ou rien, un premier lancement interrompu ne laisse
//!   jamais une démo amputée que le lancement suivant croirait complète ;
//! - base entièrement en mode découverte et **intacte** (son contenu est
//!   octet pour octet ce que le semis avait écrit, empreinte en table `meta`)
//!   → elle est remplacée par la graine du jour : un programme d'exemple
//!   jamais touché est jetable par définition, et ses dates ne vieillissent
//!   plus ;
//! - la moindre donnée de l'utilisateur — une séance à lui, ou une série
//!   ajoutée sur la démo — → la base n'est pas touchée.
//!
//! Une base semée avant l'existence de l'empreinte n'en a pas : elle est
//! traitée comme touchée, le choix conservateur (#53 assume ce cas).

use crate::contract::{codes, validate_seances, AppError, Exercise, ExerciseSet, Seance};
use rusqlite::{Connection, OptionalExtension};

/// L'empreinte du dernier semis : le JSON canonique de l'état tel qu'il a été
/// relu après écriture. Comparer le contenu courant à cette valeur dit si la
/// démo a bougé depuis — les dates étant figées en base, l'empreinte l'est
/// aussi.
const SEED_META_KEY: &str = "seed-content";

pub fn bootstrap(connection: &mut Connection, seed: &[Seance]) -> Result<Vec<Seance>, AppError> {
  validate_seances(seed)?;

  // La graine est le mode découverte : semer des séances non-démo rendrait
  // des données utilisateur remplaçables au prochain lancement.
  if seed.iter().any(|seance| !seance.is_demo) {
    return Err(AppError::new(
      codes::GRAINE_INVALIDE,
      "La graine de démonstration doit être entièrement en mode découverte.",
    ));
  }

  // Hors transaction : ce PRAGMA est ignoré à l'intérieur d'une transaction.
  connection
    .execute_batch("PRAGMA foreign_keys = ON;")
    .map_err(storage_error)?;

  let current = load_seances(connection).map_err(storage_error)?;

  if !current.is_empty() && !is_untouched_demo(connection, &current)? {
    return Ok(current);
  }

  let transaction = connection.transaction().map_err(storage_error)?;

  write_seances(&transaction, seed).map_err(storage_error)?;

  // L'état relu dans la transaction est ce que verront tous les lancements
  // suivants (ordres canoniques compris) : c'est lui qu'on rend, et c'est lui
  // qu'on fige comme empreinte.
  let state = load_seances(&transaction).map_err(storage_error)?;
  let fingerprint = fingerprint_of(&state)?;
  set_meta(&transaction, SEED_META_KEY, &fingerprint).map_err(storage_error)?;

  transaction.commit().map_err(storage_error)?;

  Ok(state)
}

fn is_untouched_demo(connection: &Connection, current: &[Seance]) -> Result<bool, AppError> {
  if current.iter().any(|seance| !seance.is_demo) {
    return Ok(false);
  }

  let Some(stored) = get_meta(connection, SEED_META_KEY).map_err(storage_error)? else {
    return Ok(false);
  };

  Ok(stored == fingerprint_of(current)?)
}

fn fingerprint_of(seances: &[Seance]) -> Result<String, AppError> {
  serde_json::to_string(seances).map_err(|error| {
    AppError::new(
      codes::STOCKAGE_INDISPONIBLE,
      format!("Empreinte de la graine impossible à calculer : {error}"),
    )
  })
}

fn storage_error(error: rusqlite::Error) -> AppError {
  AppError::new(
    codes::STOCKAGE_INDISPONIBLE,
    format!("Base de données inaccessible : {error}"),
  )
}

/// Relit tout l'état dans la forme canonique du contrat : exercices dans
/// l'ordre du programme (`position`, `rowid` en départage pour les bases
/// migrées), séries de la plus récente à la plus ancienne — exactement les
/// ordres que le chargeur TypeScript produit aujourd'hui.
pub fn load_seances(connection: &Connection) -> rusqlite::Result<Vec<Seance>> {
  let mut seances_stmt =
    connection.prepare("SELECT slug, name, is_demo FROM seances ORDER BY rowid")?;
  let seance_rows: Vec<(String, String, bool)> = seances_stmt
    .query_map([], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, i64>(2)? == 1,
      ))
    })?
    .collect::<rusqlite::Result<_>>()?;

  let mut exercises_stmt = connection.prepare(
    "SELECT slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell
     FROM exercises WHERE seance_slug = ?1 ORDER BY position, rowid",
  )?;
  let mut sets_stmt = connection.prepare(
    "SELECT id, reps, weight, completed_at, is_warmup
     FROM sets WHERE seance_slug = ?1 AND exercise_slug = ?2 ORDER BY completed_at DESC",
  )?;

  let mut seances = Vec::new();

  for (seance_slug, name, is_demo) in seance_rows {
    let exercise_rows: Vec<(String, String, i64, f64, String, i64, bool)> = exercises_stmt
      .query_map([&seance_slug], |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, i64>(2)?,
          row.get::<_, f64>(3)?,
          row.get::<_, String>(4)?,
          row.get::<_, i64>(5)?,
          row.get::<_, i64>(6)? == 1,
        ))
      })?
      .collect::<rusqlite::Result<_>>()?;

    let mut exercises = Vec::new();

    for (slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell) in
      exercise_rows
    {
      let sets: Vec<ExerciseSet> = sets_stmt
        .query_map([&seance_slug, &slug], |row| {
          Ok(ExerciseSet {
            id: row.get(0)?,
            reps: row.get(1)?,
            weight: row.get(2)?,
            completed_at: row.get(3)?,
            is_warmup: row.get::<_, i64>(4)? == 1,
          })
        })?
        .collect::<rusqlite::Result<_>>()?;

      exercises.push(Exercise {
        slug,
        name,
        default_reps,
        default_weight,
        weight_unit,
        rest_seconds,
        is_dumbbell,
        sets,
      });
    }

    seances.push(Seance {
      slug: seance_slug,
      name,
      is_demo,
      exercises,
    });
  }

  Ok(seances)
}

/// Remplace tout le contenu par `seances`, `is_demo` compris — contrairement
/// à l'import d'une sauvegarde, la graine reste marquée mode découverte.
/// À appeler dans une transaction : c'est l'appelant qui décide du tout ou
/// rien.
fn write_seances(connection: &Connection, seances: &[Seance]) -> rusqlite::Result<()> {
  // Ordre imposé par les clés étrangères : les séries référencent les
  // exercices, qui référencent les séances.
  connection.execute("DELETE FROM sets", [])?;
  connection.execute("DELETE FROM exercises", [])?;
  connection.execute("DELETE FROM seances", [])?;

  for seance in seances {
    connection.execute(
      "INSERT INTO seances (slug, name, is_demo) VALUES (?1, ?2, ?3)",
      rusqlite::params![seance.slug, seance.name, seance.is_demo],
    )?;

    for (position, exercise) in seance.exercises.iter().enumerate() {
      connection.execute(
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
        connection.execute(
          "INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
          rusqlite::params![
            set.id,
            seance.slug,
            exercise.slug,
            set.reps,
            set.weight,
            set.completed_at,
            set.is_warmup,
          ],
        )?;
      }
    }
  }

  Ok(())
}

fn get_meta(connection: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
  connection
    .query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
      row.get(0)
    })
    .optional()
}

fn set_meta(connection: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
  connection.execute(
    "INSERT INTO meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  )?;

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn connection_with_schema() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    apply_schema(&conn);
    conn
  }

  fn apply_schema(conn: &Connection) {
    conn.execute_batch(crate::SCHEMA_MIGRATION_SQL).unwrap();
    conn.execute_batch(crate::DEMO_FLAG_MIGRATION_SQL).unwrap();
    conn
      .execute_batch(crate::REST_SECONDS_MIGRATION_SQL)
      .unwrap();
    conn.execute_batch(crate::DUMBBELL_MIGRATION_SQL).unwrap();
    conn.execute_batch(crate::WARMUP_SET_MIGRATION_SQL).unwrap();
    conn
      .execute_batch(crate::EXERCISE_POSITION_MIGRATION_SQL)
      .unwrap();
    conn.execute_batch(crate::META_MIGRATION_SQL).unwrap();
  }

  /// Une graine de deux séances, avec de l'historique daté : la forme réelle
  /// de `createDemoSeances`. Les séries arrivent volontairement de la plus
  /// ancienne à la plus récente — l'état rendu doit être en ordre canonique
  /// (la plus récente en tête), quel que soit l'ordre de la graine.
  fn seed(marker: &str) -> Vec<Seance> {
    vec![
      Seance {
        slug: "upper-a".to_string(),
        name: format!("Upper A {marker}"),
        is_demo: true,
        exercises: vec![Exercise {
          slug: "developpe-couche".to_string(),
          name: "Développé couché".to_string(),
          default_reps: 8,
          default_weight: 62.5,
          weight_unit: "kg".to_string(),
          rest_seconds: 120,
          is_dumbbell: false,
          sets: vec![
            ExerciseSet {
              id: 1,
              reps: 8,
              weight: 60.0,
              completed_at: "2026-08-01T18:00:00.000Z".to_string(),
              is_warmup: false,
            },
            ExerciseSet {
              id: 2,
              reps: 8,
              weight: 62.5,
              completed_at: "2026-08-08T18:00:00.000Z".to_string(),
              is_warmup: false,
            },
          ],
        }],
      },
      Seance {
        slug: "lower".to_string(),
        name: "Lower".to_string(),
        is_demo: true,
        exercises: vec![Exercise {
          slug: "squat".to_string(),
          name: "Squat".to_string(),
          default_reps: 5,
          default_weight: 100.0,
          weight_unit: "kg".to_string(),
          rest_seconds: 180,
          is_dumbbell: false,
          sets: vec![],
        }],
      },
    ]
  }

  #[test]
  fn an_empty_database_receives_the_whole_seed_in_canonical_order() {
    let mut conn = connection_with_schema();

    let state = bootstrap(&mut conn, &seed("v1")).expect("le semis doit réussir");

    assert_eq!(
      state.iter().map(|s| s.slug.as_str()).collect::<Vec<_>>(),
      vec!["upper-a", "lower"]
    );
    assert!(state.iter().all(|s| s.is_demo));
    // La graine arrivait de la plus ancienne à la plus récente : l'état rendu
    // est en ordre canonique, et identique à ce qu'une relecture donnerait.
    let sets = &state[0].exercises[0].sets;
    assert_eq!(sets.iter().map(|s| s.id).collect::<Vec<_>>(), vec![2, 1]);
    assert_eq!(sets[0].weight, 62.5);
    assert_eq!(state, load_seances(&conn).unwrap());
    // L'empreinte est posée : c'est elle qui distinguera intact de touché.
    assert!(get_meta(&conn, SEED_META_KEY).unwrap().is_some());
  }

  #[test]
  fn an_untouched_demo_is_replaced_by_the_new_seed() {
    let mut conn = connection_with_schema();
    bootstrap(&mut conn, &seed("v1")).unwrap();

    let state = bootstrap(&mut conn, &seed("v2")).expect("le remplacement doit réussir");

    // Rien à perdre : le programme d'exemple jamais touché suit la graine.
    assert_eq!(state[0].name, "Upper A v2");
    let seance_count: i64 = conn
      .query_row("SELECT COUNT(*) FROM seances", [], |row| row.get(0))
      .unwrap();
    assert_eq!(seance_count, 2, "remplacée, pas dupliquée");
  }

  #[test]
  fn a_demo_with_a_user_set_is_never_replaced() {
    let mut conn = connection_with_schema();
    bootstrap(&mut conn, &seed("v1")).unwrap();

    // L'utilisateur a enregistré une série sur la démo sans l'adopter : c'est
    // une donnée à lui, la graine du jour n'a plus le droit d'écraser.
    conn
      .execute(
        "INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup)
         VALUES (99, 'upper-a', 'developpe-couche', 5, 70, '2026-08-20T18:00:00.000Z', 0)",
        [],
      )
      .unwrap();

    let state = bootstrap(&mut conn, &seed("v2")).unwrap();

    assert_eq!(state[0].name, "Upper A v1");
    assert!(state[0].exercises[0].sets.iter().any(|set| set.id == 99));
  }

  #[test]
  fn real_data_is_never_replaced() {
    let mut conn = connection_with_schema();
    bootstrap(&mut conn, &seed("v1")).unwrap();
    // La démo adoptée n'est plus une démo : plus rien n'est remplaçable.
    conn
      .execute("UPDATE seances SET is_demo = 0 WHERE slug = 'upper-a'", [])
      .unwrap();

    let state = bootstrap(&mut conn, &seed("v2")).unwrap();

    assert_eq!(state[0].name, "Upper A v1");
  }

  #[test]
  fn a_demo_seeded_before_the_fingerprint_is_treated_as_touched() {
    let mut conn = connection_with_schema();
    bootstrap(&mut conn, &seed("v1")).unwrap();
    // Une installation d'avant la table meta : pas d'empreinte.
    conn.execute("DELETE FROM meta", []).unwrap();

    let state = bootstrap(&mut conn, &seed("v2")).unwrap();

    // Le choix conservateur de #53 : dans le doute, on ne remplace pas.
    assert_eq!(state[0].name, "Upper A v1");
  }

  #[test]
  fn an_invalid_seed_is_rejected_before_any_write() {
    let mut conn = connection_with_schema();
    let mut invalid = seed("v1");
    invalid[0].exercises[0].sets[0].completed_at = "2026-08-01".to_string();

    let error = bootstrap(&mut conn, &invalid).unwrap_err();

    assert_eq!(error.code, codes::DATE_INVALIDE);
    assert_eq!(load_seances(&conn).unwrap(), vec![]);
  }

  #[test]
  fn a_seed_with_a_non_demo_seance_is_rejected() {
    let mut conn = connection_with_schema();
    let mut invalid = seed("v1");
    invalid[1].is_demo = false;

    let error = bootstrap(&mut conn, &invalid).unwrap_err();

    assert_eq!(error.code, codes::GRAINE_INVALIDE);
    assert_eq!(load_seances(&conn).unwrap(), vec![]);
  }

  /// L'atomicité sur fichier réel : l'échec est injecté sur la **dernière**
  /// écriture du semis (l'empreinte, la table `meta` ayant été supprimée),
  /// donc après toutes les insertions. Le fichier rouvert doit être vide —
  /// pas de démo amputée qu'un `seances non vide` figerait à vie.
  #[test]
  fn a_failure_on_the_last_write_leaves_the_reopened_file_empty() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_path_buf();

    {
      let mut conn = Connection::open(&path).unwrap();
      apply_schema(&conn);
      conn.execute_batch("DROP TABLE meta;").unwrap();

      let error = bootstrap(&mut conn, &seed("v1")).unwrap_err();
      assert_eq!(error.code, codes::STOCKAGE_INDISPONIBLE);
    }

    let conn = Connection::open(&path).unwrap();
    let counts: (i64, i64, i64) = (
      conn
        .query_row("SELECT COUNT(*) FROM seances", [], |row| row.get(0))
        .unwrap(),
      conn
        .query_row("SELECT COUNT(*) FROM exercises", [], |row| row.get(0))
        .unwrap(),
      conn
        .query_row("SELECT COUNT(*) FROM sets", [], |row| row.get(0))
        .unwrap(),
    );

    assert_eq!(counts, (0, 0, 0));
  }

  /// Le semis complet survit à la fermeture du fichier — c'est bien sur le
  /// disque, pas seulement dans la connexion.
  #[test]
  fn a_successful_seed_is_still_there_after_reopening_the_file() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_path_buf();
    let expected = {
      let mut conn = Connection::open(&path).unwrap();
      apply_schema(&conn);
      bootstrap(&mut conn, &seed("v1")).unwrap()
    };

    let conn = Connection::open(&path).unwrap();

    assert_eq!(load_seances(&conn).unwrap(), expected);
  }
}
