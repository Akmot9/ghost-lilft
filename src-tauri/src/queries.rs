//! La lecture de la base vers les DTO canoniques du contrat — partagée par le
//! bootstrap (#55) et les mutations (#68) : toute commande rend l'état
//! *réellement persisté*, jamais une reconstruction côté appelant.
//!
//! Les ordres sont ceux du contrat (`docs/app-api.md`) : exercices dans
//! l'ordre du programme (`position`, `rowid` en départage pour les bases
//! migrées), séries de la plus récente à la plus ancienne.

use crate::contract::{Exercise, ExerciseSet, Seance};
use rusqlite::Connection;

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

  let mut seances = Vec::new();

  for (slug, name, is_demo) in seance_rows {
    let exercises = load_exercises_of(connection, &slug)?;
    seances.push(Seance {
      slug,
      name,
      is_demo,
      exercises,
    });
  }

  Ok(seances)
}

pub fn load_seance(connection: &Connection, slug: &str) -> rusqlite::Result<Option<Seance>> {
  let mut stmt = connection.prepare("SELECT slug, name, is_demo FROM seances WHERE slug = ?1")?;
  let mut rows = stmt.query_map([slug], |row| {
    Ok((
      row.get::<_, String>(0)?,
      row.get::<_, String>(1)?,
      row.get::<_, i64>(2)? == 1,
    ))
  })?;

  let Some(row) = rows.next() else {
    return Ok(None);
  };
  let (slug, name, is_demo) = row?;
  let exercises = load_exercises_of(connection, &slug)?;

  Ok(Some(Seance {
    slug,
    name,
    is_demo,
    exercises,
  }))
}

pub fn load_exercise(
  connection: &Connection,
  seance_slug: &str,
  exercise_slug: &str,
) -> rusqlite::Result<Option<Exercise>> {
  Ok(
    load_exercises_of(connection, seance_slug)?
      .into_iter()
      .find(|exercise| exercise.slug == exercise_slug),
  )
}

fn load_exercises_of(
  connection: &Connection,
  seance_slug: &str,
) -> rusqlite::Result<Vec<Exercise>> {
  let mut exercises_stmt = connection.prepare(
    "SELECT slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell
     FROM exercises WHERE seance_slug = ?1 ORDER BY position, rowid",
  )?;
  let mut sets_stmt = connection.prepare(
    "SELECT id, reps, weight, completed_at, is_warmup, rpe
     FROM sets WHERE seance_slug = ?1 AND exercise_slug = ?2 ORDER BY completed_at DESC",
  )?;

  let exercise_rows: Vec<(String, String, i64, f64, String, i64, bool)> = exercises_stmt
    .query_map([seance_slug], |row| {
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
      .query_map([seance_slug, &slug], |row| {
        Ok(ExerciseSet {
          id: row.get(0)?,
          reps: row.get(1)?,
          weight: row.get(2)?,
          completed_at: row.get(3)?,
          is_warmup: row.get::<_, i64>(4)? == 1,
          rpe: row.get(5)?,
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

  Ok(exercises)
}
