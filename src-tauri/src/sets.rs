//! La journalisation des séries (#69) : ce que Pinia faisait en SQL depuis le
//! frontend — insertion, correction, échauffement, suppression, fusion —
//! devient des cas d'usage Rust, chacun dans une vraie transaction.
//!
//! Deux décisions structurantes :
//!
//! - **SQLite attribue les identifiants.** Le frontend fabriquait des ids en
//!   `Date.getTime()` et calculait lui-même le prochain lors d'une fusion ;
//!   la clé `AUTOINCREMENT` existait déjà, elle fait foi désormais. Chaque
//!   fonction rend la forme canonique persistée, identifiant compris.
//! - **La fusion déduplique par signature** `date | répétitions | charge`,
//!   la même règle que l'app depuis toujours : réimporter deux fois le même
//!   fichier ne duplique rien.

use crate::contract::{
  codes, is_canonical_utc_timestamp, is_half_kilo_step, AppError, Exercise, ExerciseSet,
};
use crate::mutations::assert_exercise_exists;
use rusqlite::Connection;

/// Ce que le frontend envoie pour enregistrer une série : tout sauf
/// l'identifiant, que SQLite attribue. `isWarmup` et `rpe` sont optionnels
/// comme dans les sauvegardes : absents, ils valent « série de travail non
/// notée ».
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetInput {
  pub reps: i64,
  /// Charge totale en kilogrammes, au demi-kilo près.
  pub weight: f64,
  /// Horodatage UTC canonique, daté par le frontend au moment du geste.
  pub completed_at: String,
  #[serde(default)]
  pub is_warmup: bool,
  #[serde(default)]
  pub rpe: Option<f64>,
}

/// Ce qui se corrige sur une série passée. La date n'en fait pas partie :
/// c'est l'identité de la série (fantômes positionnels, déduplication).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetChanges {
  pub reps: i64,
  pub weight: f64,
  pub rpe: Option<f64>,
}

/// Le compte rendu d'une fusion : combien de séries sont entrées, combien
/// étaient déjà là, et l'exercice canonique — le store applique, il ne
/// recompte pas.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
  pub ajoutees: i64,
  pub ignorees: i64,
  pub exercise: Exercise,
}

/// Enregistre une série et rend sa forme canonique, identifiant compris.
pub fn add_set(
  connection: &mut Connection,
  seance_slug: &str,
  exercise_slug: &str,
  input: &SetInput,
) -> Result<ExerciseSet, AppError> {
  validate_input(input)?;
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  assert_exercise_exists(&transaction, seance_slug, exercise_slug)?;

  transaction
    .execute(
      "INSERT INTO sets (seance_slug, exercise_slug, reps, weight, completed_at, is_warmup, rpe)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      rusqlite::params![
        seance_slug,
        exercise_slug,
        input.reps,
        input.weight,
        input.completed_at,
        input.is_warmup,
        input.rpe,
      ],
    )
    .map_err(AppError::storage)?;

  let set = reload_set(&transaction, transaction.last_insert_rowid())?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(set)
}

/// Corrige une série passée (répétitions, charge, RPE) — jamais sa date.
pub fn update_set(
  connection: &mut Connection,
  seance_slug: &str,
  exercise_slug: &str,
  set_id: i64,
  changes: &SetChanges,
) -> Result<ExerciseSet, AppError> {
  validate_values(changes.reps, changes.weight, changes.rpe)?;
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  let updated = transaction
    .execute(
      "UPDATE sets SET reps = ?1, weight = ?2, rpe = ?3
       WHERE id = ?4 AND seance_slug = ?5 AND exercise_slug = ?6",
      rusqlite::params![
        changes.reps,
        changes.weight,
        changes.rpe,
        set_id,
        seance_slug,
        exercise_slug
      ],
    )
    .map_err(AppError::storage)?;

  if updated == 0 {
    return Err(set_introuvable(seance_slug, exercise_slug, set_id));
  }

  let set = reload_set(&transaction, set_id)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(set)
}

/// Classe ou reclasse une série en échauffement. Une série d'échauffement ne
/// porte pas de RPE : le drapeau posé efface la note.
pub fn set_set_warmup(
  connection: &mut Connection,
  seance_slug: &str,
  exercise_slug: &str,
  set_id: i64,
  is_warmup: bool,
) -> Result<ExerciseSet, AppError> {
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  let updated = transaction
    .execute(
      "UPDATE sets SET is_warmup = ?1, rpe = CASE WHEN ?1 THEN NULL ELSE rpe END
       WHERE id = ?2 AND seance_slug = ?3 AND exercise_slug = ?4",
      rusqlite::params![is_warmup, set_id, seance_slug, exercise_slug],
    )
    .map_err(AppError::storage)?;

  if updated == 0 {
    return Err(set_introuvable(seance_slug, exercise_slug, set_id));
  }

  let set = reload_set(&transaction, set_id)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(set)
}

/// Supprime une série et rend l'exercice canonique restant.
pub fn remove_set(
  connection: &mut Connection,
  seance_slug: &str,
  exercise_slug: &str,
  set_id: i64,
) -> Result<Exercise, AppError> {
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  assert_exercise_exists(&transaction, seance_slug, exercise_slug)?;

  // Supprimer une série déjà absente n'est pas une erreur : l'intention —
  // cette série n'existe plus — est déjà satisfaite (suppressions rapides,
  // écrans ouverts en double).
  transaction
    .execute(
      "DELETE FROM sets WHERE id = ?1 AND seance_slug = ?2 AND exercise_slug = ?3",
      rusqlite::params![set_id, seance_slug, exercise_slug],
    )
    .map_err(AppError::storage)?;

  let exercise = crate::mutations::reload_exercise(&transaction, seance_slug, exercise_slug)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(exercise)
}

/// Vide l'historique d'un exercice et rend sa forme canonique (sans séries).
pub fn clear_sets(
  connection: &mut Connection,
  seance_slug: &str,
  exercise_slug: &str,
) -> Result<Exercise, AppError> {
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  assert_exercise_exists(&transaction, seance_slug, exercise_slug)?;

  transaction
    .execute(
      "DELETE FROM sets WHERE seance_slug = ?1 AND exercise_slug = ?2",
      rusqlite::params![seance_slug, exercise_slug],
    )
    .map_err(AppError::storage)?;

  let exercise = crate::mutations::reload_exercise(&transaction, seance_slug, exercise_slug)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(exercise)
}

/// Verse des séries dans un exercice — l'import d'un fichier exporté sous un
/// autre nom, ou le même fichier deux fois. Les séries déjà présentes à la
/// même signature `date | répétitions | charge` sont ignorées. Tout entre
/// dans une seule transaction : un fichier à moitié versé n'existe pas.
pub fn merge_sets(
  connection: &mut Connection,
  seance_slug: &str,
  exercise_slug: &str,
  sets: &[SetInput],
) -> Result<MergeReport, AppError> {
  for input in sets {
    validate_input(input)?;
  }

  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  assert_exercise_exists(&transaction, seance_slug, exercise_slug)?;

  let mut seen: std::collections::HashSet<String> = {
    let mut stmt = transaction
      .prepare(
        "SELECT completed_at, reps, weight FROM sets WHERE seance_slug = ?1 AND exercise_slug = ?2",
      )
      .map_err(AppError::storage)?;
    let signatures = stmt
      .query_map(rusqlite::params![seance_slug, exercise_slug], |row| {
        Ok(signature(
          &row.get::<_, String>(0)?,
          row.get(1)?,
          row.get(2)?,
        ))
      })
      .and_then(|rows| rows.collect::<rusqlite::Result<_>>())
      .map_err(AppError::storage)?;
    signatures
  };

  let mut ajoutees = 0;
  let mut ignorees = 0;

  for input in sets {
    let key = signature(&input.completed_at, input.reps, input.weight);

    if !seen.insert(key) {
      ignorees += 1;
      continue;
    }

    transaction
      .execute(
        "INSERT INTO sets (seance_slug, exercise_slug, reps, weight, completed_at, is_warmup, rpe)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
          seance_slug,
          exercise_slug,
          input.reps,
          input.weight,
          input.completed_at,
          input.is_warmup,
          input.rpe,
        ],
      )
      .map_err(AppError::storage)?;
    ajoutees += 1;
  }

  let exercise = crate::mutations::reload_exercise(&transaction, seance_slug, exercise_slug)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(MergeReport {
    ajoutees,
    ignorees,
    exercise,
  })
}

/// La signature de déduplication, identique à celle du frontend historique :
/// un poids entier s'écrit sans décimale (`60`, pas `60.0`).
fn signature(completed_at: &str, reps: i64, weight: f64) -> String {
  if weight.fract() == 0.0 {
    format!("{completed_at}|{reps}|{}", weight as i64)
  } else {
    format!("{completed_at}|{reps}|{weight}")
  }
}

fn validate_input(input: &SetInput) -> Result<(), AppError> {
  if !is_canonical_utc_timestamp(&input.completed_at) {
    return Err(AppError::new(
      codes::DATE_INVALIDE,
      format!(
        "Série : « {} » n'est pas un horodatage UTC canonique (AAAA-MM-JJTHH:MM:SS.mmmZ).",
        input.completed_at
      ),
    ));
  }

  validate_values(input.reps, input.weight, input.rpe)
}

fn validate_values(reps: i64, weight: f64, rpe: Option<f64>) -> Result<(), AppError> {
  if reps < 1 {
    return Err(AppError::new(
      codes::REPETITIONS_INVALIDES,
      "Série : au moins une répétition pour être enregistrée.",
    ));
  }

  if !is_half_kilo_step(weight) || weight < 1.0 {
    return Err(AppError::new(
      codes::CHARGE_INVALIDE,
      "Série : la charge est un multiple de 0,5 kg, d'au moins 1 kg.",
    ));
  }

  if let Some(rpe) = rpe {
    if !is_half_kilo_step(rpe) || !(1.0..=10.0).contains(&rpe) {
      return Err(AppError::new(
        codes::RPE_INVALIDE,
        "Série : le RPE se note de 1 à 10, au demi-point près.",
      ));
    }
  }

  Ok(())
}

fn set_introuvable(seance_slug: &str, exercise_slug: &str, set_id: i64) -> AppError {
  AppError::new(
    codes::INTROUVABLE,
    format!(
      "La série {set_id} n'existe pas dans l'exercice « {exercise_slug} » de la séance « {seance_slug} »."
    ),
  )
}

fn reload_set(connection: &Connection, set_id: i64) -> Result<ExerciseSet, AppError> {
  connection
    .query_row(
      "SELECT id, reps, weight, completed_at, is_warmup, rpe FROM sets WHERE id = ?1",
      [set_id],
      |row| {
        Ok(ExerciseSet {
          id: row.get(0)?,
          reps: row.get(1)?,
          weight: row.get(2)?,
          completed_at: row.get(3)?,
          is_warmup: row.get::<_, i64>(4)? == 1,
          rpe: row.get(5)?,
        })
      },
    )
    .map_err(AppError::storage)
}

// Hors transaction : ce PRAGMA est ignoré à l'intérieur d'une transaction.
fn enable_foreign_keys(connection: &Connection) -> Result<(), AppError> {
  connection
    .execute_batch("PRAGMA foreign_keys = ON;")
    .map_err(AppError::storage)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
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
    conn.execute_batch(crate::RPE_MIGRATION_SQL).unwrap();
    conn
      .execute_batch(
        "INSERT INTO seances (slug, name, is_demo) VALUES ('upper-a', 'Upper A', 0);
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, position)
           VALUES ('upper-a', 'curl', 'Curl', 8, 30, 'kg', 0);",
      )
      .unwrap();
    conn
  }

  fn input(reps: i64, weight: f64, completed_at: &str) -> SetInput {
    SetInput {
      reps,
      weight,
      completed_at: completed_at.to_string(),
      is_warmup: false,
      rpe: None,
    }
  }

  #[test]
  fn add_set_lets_sqlite_pick_the_id_and_returns_the_canonical_form() {
    let mut conn = connection();

    let first = add_set(
      &mut conn,
      "upper-a",
      "curl",
      &input(8, 30.0, "2026-09-01T18:00:00.000Z"),
    )
    .unwrap();
    let mut second = input(6, 32.5, "2026-09-01T18:05:00.000Z");
    second.rpe = Some(8.5);
    let second = add_set(&mut conn, "upper-a", "curl", &second).unwrap();

    // SQLite numérote, personne d'autre.
    assert_eq!((first.id, second.id), (1, 2));
    assert_eq!(second.rpe, Some(8.5));
    assert_eq!(second.weight, 32.5);
  }

  #[test]
  fn add_set_refuses_bad_values_before_writing() {
    let mut conn = connection();

    for (bad, code) in [
      (
        input(0, 30.0, "2026-09-01T18:00:00.000Z"),
        codes::REPETITIONS_INVALIDES,
      ),
      (
        input(8, 30.2, "2026-09-01T18:00:00.000Z"),
        codes::CHARGE_INVALIDE,
      ),
      (input(8, 30.0, "2026-09-01"), codes::DATE_INVALIDE),
    ] {
      let error = add_set(&mut conn, "upper-a", "curl", &bad).unwrap_err();
      assert_eq!(error.code, code);
    }

    let mut bad_rpe = input(8, 30.0, "2026-09-01T18:00:00.000Z");
    bad_rpe.rpe = Some(11.0);
    let error = add_set(&mut conn, "upper-a", "curl", &bad_rpe).unwrap_err();
    assert_eq!(error.code, codes::RPE_INVALIDE);

    let count: i64 = conn
      .query_row("SELECT COUNT(*) FROM sets", [], |row| row.get(0))
      .unwrap();
    assert_eq!(count, 0);
  }

  #[test]
  fn add_set_on_a_missing_target_says_introuvable() {
    let mut conn = connection();

    let error = add_set(
      &mut conn,
      "upper-a",
      "squat",
      &input(8, 60.0, "2026-09-01T18:00:00.000Z"),
    )
    .unwrap_err();
    assert_eq!(error.code, codes::INTROUVABLE);

    let error = add_set(
      &mut conn,
      "lower",
      "curl",
      &input(8, 60.0, "2026-09-01T18:00:00.000Z"),
    )
    .unwrap_err();
    assert_eq!(error.code, codes::INTROUVABLE);
  }

  #[test]
  fn update_set_changes_values_but_never_the_date() {
    let mut conn = connection();
    let set = add_set(
      &mut conn,
      "upper-a",
      "curl",
      &input(8, 30.0, "2026-09-01T18:00:00.000Z"),
    )
    .unwrap();

    let updated = update_set(
      &mut conn,
      "upper-a",
      "curl",
      set.id,
      &SetChanges {
        reps: 6,
        weight: 32.5,
        rpe: Some(9.0),
      },
    )
    .unwrap();

    assert_eq!(
      (updated.reps, updated.weight, updated.rpe),
      (6, 32.5, Some(9.0))
    );
    assert_eq!(updated.completed_at, "2026-09-01T18:00:00.000Z");

    let error = update_set(
      &mut conn,
      "upper-a",
      "curl",
      999,
      &SetChanges {
        reps: 6,
        weight: 32.5,
        rpe: None,
      },
    )
    .unwrap_err();
    assert_eq!(error.code, codes::INTROUVABLE);
  }

  #[test]
  fn flagging_a_warmup_erases_its_rpe() {
    let mut conn = connection();
    let mut rated = input(8, 30.0, "2026-09-01T18:00:00.000Z");
    rated.rpe = Some(8.0);
    let set = add_set(&mut conn, "upper-a", "curl", &rated).unwrap();

    let warmed = set_set_warmup(&mut conn, "upper-a", "curl", set.id, true).unwrap();
    assert!(warmed.is_warmup);
    assert_eq!(warmed.rpe, None);

    let restored = set_set_warmup(&mut conn, "upper-a", "curl", set.id, false).unwrap();
    assert!(!restored.is_warmup);
    assert_eq!(restored.rpe, None);
  }

  #[test]
  fn remove_set_is_idempotent_and_returns_the_remaining_exercise() {
    let mut conn = connection();
    let set = add_set(
      &mut conn,
      "upper-a",
      "curl",
      &input(8, 30.0, "2026-09-01T18:00:00.000Z"),
    )
    .unwrap();
    add_set(
      &mut conn,
      "upper-a",
      "curl",
      &input(6, 32.5, "2026-09-01T18:05:00.000Z"),
    )
    .unwrap();

    let exercise = remove_set(&mut conn, "upper-a", "curl", set.id).unwrap();
    assert_eq!(exercise.sets.len(), 1);

    // Supprimer une série déjà absente n'est pas une erreur.
    let exercise = remove_set(&mut conn, "upper-a", "curl", set.id).unwrap();
    assert_eq!(exercise.sets.len(), 1);
  }

  #[test]
  fn clear_sets_empties_only_that_exercise() {
    let mut conn = connection();
    conn
      .execute_batch(
        "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, position)
           VALUES ('upper-a', 'rowing', 'Rowing', 10, 40, 'kg', 1);",
      )
      .unwrap();
    add_set(
      &mut conn,
      "upper-a",
      "curl",
      &input(8, 30.0, "2026-09-01T18:00:00.000Z"),
    )
    .unwrap();
    add_set(
      &mut conn,
      "upper-a",
      "rowing",
      &input(10, 40.0, "2026-09-01T18:10:00.000Z"),
    )
    .unwrap();

    let exercise = clear_sets(&mut conn, "upper-a", "curl").unwrap();
    assert!(exercise.sets.is_empty());

    let remaining: i64 = conn
      .query_row("SELECT COUNT(*) FROM sets", [], |row| row.get(0))
      .unwrap();
    assert_eq!(remaining, 1);
  }

  #[test]
  fn merge_sets_deduplicates_by_signature_in_one_transaction() {
    let mut conn = connection();
    add_set(
      &mut conn,
      "upper-a",
      "curl",
      &input(8, 30.0, "2026-09-01T18:00:00.000Z"),
    )
    .unwrap();

    let report = merge_sets(
      &mut conn,
      "upper-a",
      "curl",
      &[
        // Déjà en base, à la même signature — y compris un poids entier
        // écrit 30 côté fichier et 30.0 côté f64.
        input(8, 30.0, "2026-09-01T18:00:00.000Z"),
        input(6, 32.5, "2026-09-01T18:05:00.000Z"),
        // Doublon interne au fichier lui-même.
        input(6, 32.5, "2026-09-01T18:05:00.000Z"),
      ],
    )
    .unwrap();

    assert_eq!((report.ajoutees, report.ignorees), (1, 2));
    assert_eq!(report.exercise.sets.len(), 2);
  }

  #[test]
  fn a_bad_entry_rejects_the_whole_merge() {
    let mut conn = connection();

    let error = merge_sets(
      &mut conn,
      "upper-a",
      "curl",
      &[
        input(8, 30.0, "2026-09-01T18:00:00.000Z"),
        input(0, 30.0, "2026-09-01T18:05:00.000Z"),
      ],
    )
    .unwrap_err();

    assert_eq!(error.code, codes::REPETITIONS_INVALIDES);
    let count: i64 = conn
      .query_row("SELECT COUNT(*) FROM sets", [], |row| row.get(0))
      .unwrap();
    assert_eq!(count, 0);
  }
}
