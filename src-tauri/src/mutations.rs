//! Les mutations de séances et d'exercices (#68) : ce que Pinia faisait en
//! SQL depuis le frontend devient des cas d'usage Rust — normalisation des
//! noms, slugs et leur unicité compris — chacun dans une vraie transaction.
//! Chaque fonction rend l'agrégat *réellement persisté* (relu en base avant
//! commit) : le store applique le résultat canonique au lieu de reconstruire
//! un second état.
//!
//! Les échecs sont des `AppError` du contrat : validation refusée avant la
//! moindre écriture, `introuvable` pour une cible absente, et un rollback
//! automatique (la transaction rusqlite s'annule à l'abandon) pour tout échec
//! SQLite en cours de route.

use crate::contract::{codes, AppError, Exercise, Seance};
use crate::queries::{load_exercise, load_seance, load_seances};
use rusqlite::Connection;
use unicode_normalization::UnicodeNormalization;

/// Ce que les formulaires envoient pour créer un exercice. La seule forme du
/// contrat où des champs sont optionnels : Rust applique les défauts (`180`,
/// `false`) et rend toujours la forme canonique complète.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateExerciseInput {
  pub name: String,
  pub default_reps: i64,
  pub default_weight: f64,
  pub weight_unit: String,
  #[serde(default = "default_rest_seconds")]
  pub rest_seconds: i64,
  #[serde(default)]
  pub is_dumbbell: bool,
}

fn default_rest_seconds() -> i64 {
  180
}

/// Un cran vers le haut ou vers le bas — les deux boutons de l'écran.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
  Up,
  Down,
}

pub fn create_seance(
  connection: &mut Connection,
  name: &str,
  exercises: &[CreateExerciseInput],
) -> Result<Seance, AppError> {
  let seance_name = trimmed_name(name, "de la séance")?;

  if exercises.is_empty() {
    return Err(AppError::new(
      codes::SEANCE_SANS_EXERCICE,
      "Une séance se crée avec au moins un exercice.",
    ));
  }

  let normalized: Vec<NormalizedInput> = exercises
    .iter()
    .map(validate_input)
    .collect::<Result<_, _>>()?;

  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  // L'unicité du slug se décide dans la transaction, sur ce que la base
  // contient réellement — pas sur la copie mémoire d'un appelant.
  let existing = existing_seance_slugs(&transaction)?;
  let slug = unique_slug(&slugify(&seance_name), &existing);

  transaction
    .execute(
      "INSERT INTO seances (slug, name, is_demo) VALUES (?1, ?2, 0)",
      rusqlite::params![slug, seance_name],
    )
    .map_err(AppError::storage)?;

  let mut exercise_slugs: Vec<String> = Vec::new();

  for (position, input) in normalized.iter().enumerate() {
    let exercise_slug = unique_slug(&slugify(&input.name), &exercise_slugs);
    insert_exercise(&transaction, &slug, &exercise_slug, input, position as i64)?;
    exercise_slugs.push(exercise_slug);
  }

  let seance = reload_seance(&transaction, &slug)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(seance)
}

pub fn rename_seance(
  connection: &mut Connection,
  seance_slug: &str,
  name: &str,
) -> Result<Seance, AppError> {
  let seance_name = trimmed_name(name, "de la séance")?;

  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  let updated = transaction
    .execute(
      "UPDATE seances SET name = ?1 WHERE slug = ?2",
      rusqlite::params![seance_name, seance_slug],
    )
    .map_err(AppError::storage)?;

  if updated == 0 {
    return Err(seance_introuvable(seance_slug));
  }

  let seance = reload_seance(&transaction, seance_slug)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(seance)
}

pub fn add_exercise(
  connection: &mut Connection,
  seance_slug: &str,
  input: &CreateExerciseInput,
) -> Result<Exercise, AppError> {
  let normalized = validate_input(input)?;

  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  let existing = exercise_slugs_of(&transaction, seance_slug)?;

  if !seance_exists(&transaction, seance_slug)? {
    return Err(seance_introuvable(seance_slug));
  }

  let exercise_slug = unique_slug(&slugify(&normalized.name), &existing);

  // Un exercice ajouté arrive en fin de séance, là où l'écran le montre.
  insert_exercise(
    &transaction,
    seance_slug,
    &exercise_slug,
    &normalized,
    existing.len() as i64,
  )?;

  let exercise = reload_exercise(&transaction, seance_slug, &exercise_slug)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(exercise)
}

/// Déplace un exercice d'un cran dans sa séance. Aux extrémités, l'appel ne
/// fait rien et le dit (`None`) : c'est ce que l'appelant désactive à
/// l'écran. Toute la séance est renumérotée, pas seulement les deux voisins
/// échangés — même coût pour une poignée d'exercices, et cela rattrape des
/// positions qui auraient divergé (base d'avant la colonne, import partiel).
pub fn move_exercise(
  connection: &mut Connection,
  seance_slug: &str,
  exercise_slug: &str,
  direction: Direction,
) -> Result<Option<Seance>, AppError> {
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  if !seance_exists(&transaction, seance_slug)? {
    return Err(seance_introuvable(seance_slug));
  }

  let mut slugs = exercise_slugs_of(&transaction, seance_slug)?;

  let Some(from) = slugs.iter().position(|slug| slug == exercise_slug) else {
    return Err(exercise_introuvable(seance_slug, exercise_slug));
  };

  let to = match direction {
    Direction::Up => from.checked_sub(1),
    Direction::Down => Some(from + 1),
  };

  let Some(to) = to.filter(|target| *target < slugs.len()) else {
    return Ok(None);
  };

  let moved = slugs.remove(from);
  slugs.insert(to, moved);

  for (position, slug) in slugs.iter().enumerate() {
    transaction
      .execute(
        "UPDATE exercises SET position = ?1 WHERE seance_slug = ?2 AND slug = ?3",
        rusqlite::params![position as i64, seance_slug, slug],
      )
      .map_err(AppError::storage)?;
  }

  let seance = reload_seance(&transaction, seance_slug)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(Some(seance))
}

pub fn set_exercise_dumbbell(
  connection: &mut Connection,
  seance_slug: &str,
  exercise_slug: &str,
  is_dumbbell: bool,
) -> Result<Exercise, AppError> {
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  let updated = transaction
    .execute(
      "UPDATE exercises SET is_dumbbell = ?1 WHERE seance_slug = ?2 AND slug = ?3",
      rusqlite::params![is_dumbbell, seance_slug, exercise_slug],
    )
    .map_err(AppError::storage)?;

  if updated == 0 {
    return Err(exercise_introuvable(seance_slug, exercise_slug));
  }

  let exercise = reload_exercise(&transaction, seance_slug, exercise_slug)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(exercise)
}

/// Adopte le programme de démonstration : vide l'historique d'exemple (les
/// séries) mais garde les séances, qui deviennent celles de l'utilisateur
/// (plus marquées démo, la bannière disparaît). Tout ou rien : une adoption
/// interrompue ne laisse pas une séance adoptée et l'autre encore démo.
pub fn adopt_demo_seances(connection: &mut Connection) -> Result<Vec<Seance>, AppError> {
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  for slug in demo_slugs(&transaction)? {
    transaction
      .execute("DELETE FROM sets WHERE seance_slug = ?1", [&slug])
      .map_err(AppError::storage)?;
    transaction
      .execute("UPDATE seances SET is_demo = 0 WHERE slug = ?1", [&slug])
      .map_err(AppError::storage)?;
  }

  let seances = load_seances(&transaction).map_err(AppError::storage)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(seances)
}

/// Supprime le programme de démonstration entier — l'utilisateur repart sur
/// l'onboarding réel. Atomique pour la même raison que l'adoption.
pub fn delete_demo_data(connection: &mut Connection) -> Result<Vec<Seance>, AppError> {
  enable_foreign_keys(connection)?;
  let transaction = connection.transaction().map_err(AppError::storage)?;

  // Ordre imposé par les clés étrangères : les séries référencent les
  // exercices, qui référencent les séances.
  for slug in demo_slugs(&transaction)? {
    transaction
      .execute("DELETE FROM sets WHERE seance_slug = ?1", [&slug])
      .map_err(AppError::storage)?;
    transaction
      .execute("DELETE FROM exercises WHERE seance_slug = ?1", [&slug])
      .map_err(AppError::storage)?;
    transaction
      .execute("DELETE FROM seances WHERE slug = ?1", [&slug])
      .map_err(AppError::storage)?;
  }

  let seances = load_seances(&transaction).map_err(AppError::storage)?;
  transaction.commit().map_err(AppError::storage)?;

  Ok(seances)
}

/// La forme que produisait `slugify` côté TypeScript, à l'identique — les
/// slugs des utilisateurs existants en dépendent : minuscules, décomposition
/// NFD avec suppression des diacritiques combinants (U+0300–U+036F), toute
/// suite d'autres caractères devient un tiret simple, jamais en bord, et
/// `item` en dernier recours.
pub fn slugify(value: &str) -> String {
  let mut slug = String::new();
  let mut pending_dash = false;

  for character in value.trim().to_lowercase().nfd() {
    if ('\u{0300}'..='\u{036F}').contains(&character) {
      continue;
    }

    if character.is_ascii_lowercase() || character.is_ascii_digit() {
      if pending_dash && !slug.is_empty() {
        slug.push('-');
      }
      pending_dash = false;
      slug.push(character);
    } else {
      pending_dash = true;
    }
  }

  if slug.is_empty() {
    "item".to_string()
  } else {
    slug
  }
}

/// Suffixe `-2`, `-3`… jusqu'au premier libre : le même slug redemandé rend
/// toujours la même suite, l'unicité est stable d'un appel à l'autre.
pub fn unique_slug(base: &str, existing: &[String]) -> String {
  if !existing.iter().any(|slug| slug == base) {
    return base.to_string();
  }

  let mut suffix = 2;

  loop {
    let candidate = format!("{base}-{suffix}");

    if !existing.iter().any(|slug| slug == &candidate) {
      return candidate;
    }

    suffix += 1;
  }
}

/// Un `CreateExerciseInput` validé et normalisé : nom et unité débarrassés de
/// leurs espaces de bord, unité vide remplacée par `kg` — exactement ce que
/// faisait `buildExercise` côté store.
struct NormalizedInput {
  name: String,
  default_reps: i64,
  default_weight: f64,
  weight_unit: String,
  rest_seconds: i64,
  is_dumbbell: bool,
}

fn validate_input(input: &CreateExerciseInput) -> Result<NormalizedInput, AppError> {
  let name = trimmed_name(&input.name, "de l'exercice")?;

  if input.default_reps < 1 {
    return Err(AppError::new(
      codes::REPETITIONS_INVALIDES,
      format!("Exercice « {name} » : l'objectif de répétitions est d'au moins 1."),
    ));
  }

  if !crate::contract::is_half_kilo_step(input.default_weight) || input.default_weight < 0.0 {
    return Err(AppError::new(
      codes::CHARGE_INVALIDE,
      format!("Exercice « {name} » : la charge cible est un multiple positif de 0,5 kg."),
    ));
  }

  if input.rest_seconds < 0 {
    return Err(AppError::new(
      codes::REPOS_INVALIDE,
      format!("Exercice « {name} » : le repos ne peut pas être négatif."),
    ));
  }

  let weight_unit = input.weight_unit.trim();

  Ok(NormalizedInput {
    name,
    default_reps: input.default_reps,
    default_weight: input.default_weight,
    weight_unit: if weight_unit.is_empty() {
      "kg".to_string()
    } else {
      weight_unit.to_string()
    },
    rest_seconds: input.rest_seconds,
    is_dumbbell: input.is_dumbbell,
  })
}

fn trimmed_name(value: &str, of_what: &str) -> Result<String, AppError> {
  let trimmed = value.trim();

  if trimmed.is_empty() {
    return Err(AppError::new(
      codes::NOM_INVALIDE,
      format!("Le nom {of_what} ne peut pas être vide."),
    ));
  }

  Ok(trimmed.to_string())
}

fn seance_introuvable(seance_slug: &str) -> AppError {
  AppError::new(
    codes::INTROUVABLE,
    format!("La séance « {seance_slug} » n'existe pas."),
  )
}

fn exercise_introuvable(seance_slug: &str, exercise_slug: &str) -> AppError {
  AppError::new(
    codes::INTROUVABLE,
    format!("L'exercice « {exercise_slug} » n'existe pas dans la séance « {seance_slug} »."),
  )
}

// Hors transaction : ce PRAGMA est ignoré à l'intérieur d'une transaction.
fn enable_foreign_keys(connection: &Connection) -> Result<(), AppError> {
  connection
    .execute_batch("PRAGMA foreign_keys = ON;")
    .map_err(AppError::storage)
}

fn insert_exercise(
  connection: &Connection,
  seance_slug: &str,
  exercise_slug: &str,
  input: &NormalizedInput,
  position: i64,
) -> Result<(), AppError> {
  connection
    .execute(
      "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell, position)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      rusqlite::params![
        seance_slug,
        exercise_slug,
        input.name,
        input.default_reps,
        input.default_weight,
        input.weight_unit,
        input.rest_seconds,
        input.is_dumbbell,
        position,
      ],
    )
    .map_err(AppError::storage)?;

  Ok(())
}

fn existing_seance_slugs(connection: &Connection) -> Result<Vec<String>, AppError> {
  let mut stmt = connection
    .prepare("SELECT slug FROM seances")
    .map_err(AppError::storage)?;
  let slugs = stmt
    .query_map([], |row| row.get::<_, String>(0))
    .map_err(AppError::storage)?
    .collect::<rusqlite::Result<_>>()
    .map_err(AppError::storage)?;

  Ok(slugs)
}

fn exercise_slugs_of(connection: &Connection, seance_slug: &str) -> Result<Vec<String>, AppError> {
  let mut stmt = connection
    .prepare("SELECT slug FROM exercises WHERE seance_slug = ?1 ORDER BY position, rowid")
    .map_err(AppError::storage)?;
  let slugs = stmt
    .query_map([seance_slug], |row| row.get::<_, String>(0))
    .map_err(AppError::storage)?
    .collect::<rusqlite::Result<_>>()
    .map_err(AppError::storage)?;

  Ok(slugs)
}

fn demo_slugs(connection: &Connection) -> Result<Vec<String>, AppError> {
  let mut stmt = connection
    .prepare("SELECT slug FROM seances WHERE is_demo = 1 ORDER BY rowid")
    .map_err(AppError::storage)?;
  let slugs = stmt
    .query_map([], |row| row.get::<_, String>(0))
    .map_err(AppError::storage)?
    .collect::<rusqlite::Result<_>>()
    .map_err(AppError::storage)?;

  Ok(slugs)
}

fn seance_exists(connection: &Connection, seance_slug: &str) -> Result<bool, AppError> {
  let count: i64 = connection
    .query_row(
      "SELECT COUNT(*) FROM seances WHERE slug = ?1",
      [seance_slug],
      |row| row.get(0),
    )
    .map_err(AppError::storage)?;

  Ok(count > 0)
}

/// Relit ce qui vient d'être écrit : l'absence après écriture est un état
/// impossible, rapporté comme un échec de stockage plutôt qu'avalé.
fn reload_seance(connection: &Connection, slug: &str) -> Result<Seance, AppError> {
  load_seance(connection, slug)
    .map_err(AppError::storage)?
    .ok_or_else(|| AppError::storage("la séance écrite est introuvable à la relecture"))
}

fn reload_exercise(
  connection: &Connection,
  seance_slug: &str,
  exercise_slug: &str,
) -> Result<Exercise, AppError> {
  load_exercise(connection, seance_slug, exercise_slug)
    .map_err(AppError::storage)?
    .ok_or_else(|| AppError::storage("l'exercice écrit est introuvable à la relecture"))
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
    conn.execute_batch(crate::RPE_MIGRATION_SQL).unwrap();
  }

  fn input(name: &str) -> CreateExerciseInput {
    CreateExerciseInput {
      name: name.to_string(),
      default_reps: 8,
      default_weight: 60.0,
      weight_unit: "kg".to_string(),
      rest_seconds: 120,
      is_dumbbell: false,
    }
  }

  /// Une base comme l'app la laisse : une démo avec historique, une séance à
  /// l'utilisateur.
  fn seeded_connection() -> Connection {
    let conn = connection_with_schema();
    conn
      .execute_batch(
        "INSERT INTO seances (slug, name, is_demo) VALUES ('upper-a', 'Upper A', 1);
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell, position)
           VALUES ('upper-a', 'developpe-couche', 'Développé couché', 8, 70, 'kg', 120, 0, 0);
         INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup)
           VALUES (1, 'upper-a', 'developpe-couche', 8, 70, '2026-08-01T18:00:00.000Z', 0);
         INSERT INTO seances (slug, name, is_demo) VALUES ('ma-seance', 'Ma séance', 0);
         INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell, position)
           VALUES ('ma-seance', 'squat', 'Squat', 5, 100, 'kg', 180, 0, 0);
         INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup)
           VALUES (2, 'ma-seance', 'squat', 5, 100, '2026-08-02T18:00:00.000Z', 0);",
      )
      .unwrap();
    conn
  }

  #[test]
  fn slugify_matches_the_typescript_behaviour() {
    // Les mêmes exemples que la fonction TypeScript traitait : accents
    // décomposés, ponctuation en tiret simple, bords nettoyés.
    assert_eq!(slugify("Développé couché"), "developpe-couche");
    assert_eq!(slugify("  Ça va très bien !  "), "ca-va-tres-bien");
    assert_eq!(slugify("Curl (haltères) — 21s"), "curl-halteres-21s");
    assert_eq!(slugify("UPPER A"), "upper-a");
    assert_eq!(slugify("---"), "item");
    assert_eq!(slugify(""), "item");
  }

  #[test]
  fn unique_slug_suffixes_are_stable() {
    let existing = vec!["curl".to_string(), "curl-2".to_string()];

    assert_eq!(unique_slug("curl", &[]), "curl");
    assert_eq!(unique_slug("curl", &existing), "curl-3");
  }

  #[test]
  fn create_seance_writes_everything_in_order_and_returns_the_persisted_form() {
    let mut conn = seeded_connection();

    let seance = create_seance(
      &mut conn,
      "  Lower — Jambes  ",
      &[input("Squat"), input("Leg curl")],
    )
    .expect("la création doit réussir");

    assert_eq!(seance.slug, "lower-jambes");
    assert_eq!(seance.name, "Lower — Jambes");
    assert!(!seance.is_demo);
    assert_eq!(
      seance
        .exercises
        .iter()
        .map(|exercise| exercise.slug.as_str())
        .collect::<Vec<_>>(),
      vec!["squat", "leg-curl"]
    );
    // Le résultat rendu est ce que la base contient réellement.
    assert_eq!(seance, load_seance(&conn, "lower-jambes").unwrap().unwrap());
  }

  #[test]
  fn create_seance_applies_defaults_and_normalization() {
    let mut conn = connection_with_schema();
    let mut sparse = input("  Tractions  ");
    sparse.weight_unit = "  ".to_string();

    let seance = create_seance(&mut conn, "Dos", &[sparse]).unwrap();

    let exercise = &seance.exercises[0];
    assert_eq!(exercise.name, "Tractions");
    assert_eq!(exercise.weight_unit, "kg");
  }

  #[test]
  fn seance_slug_collisions_get_a_stable_suffix_inside_the_transaction() {
    let mut conn = seeded_connection();

    let first = create_seance(&mut conn, "Upper A", &[input("Curl")]).unwrap();
    let second = create_seance(&mut conn, "Upper A", &[input("Curl")]).unwrap();

    // 'upper-a' existe déjà (la démo) : la collision se résout sur l'état
    // réel de la base, et reste stable d'un appel à l'autre.
    assert_eq!(first.slug, "upper-a-2");
    assert_eq!(second.slug, "upper-a-3");
  }

  #[test]
  fn duplicate_exercise_names_are_suffixed_within_the_seance() {
    let mut conn = connection_with_schema();

    let seance = create_seance(&mut conn, "Bras", &[input("Curl"), input("Curl")]).unwrap();

    assert_eq!(
      seance
        .exercises
        .iter()
        .map(|exercise| exercise.slug.as_str())
        .collect::<Vec<_>>(),
      vec!["curl", "curl-2"]
    );
  }

  #[test]
  fn create_seance_rejects_invalid_input_before_writing() {
    let mut conn = connection_with_schema();

    let cases: Vec<(&str, Vec<CreateExerciseInput>, &str)> = vec![
      ("  ", vec![input("Curl")], codes::NOM_INVALIDE),
      ("Bras", vec![], codes::SEANCE_SANS_EXERCICE),
      (
        "Bras",
        vec![{
          let mut bad = input("Curl");
          bad.default_reps = 0;
          bad
        }],
        codes::REPETITIONS_INVALIDES,
      ),
      (
        "Bras",
        vec![{
          let mut bad = input("Curl");
          bad.default_weight = 0.3;
          bad
        }],
        codes::CHARGE_INVALIDE,
      ),
      (
        "Bras",
        vec![{
          let mut bad = input("Curl");
          bad.rest_seconds = -1;
          bad
        }],
        codes::REPOS_INVALIDE,
      ),
      (
        "Bras",
        vec![{
          let mut bad = input("Curl");
          bad.name = " ".to_string();
          bad
        }],
        codes::NOM_INVALIDE,
      ),
    ];

    for (name, exercises, expected) in cases {
      let error = create_seance(&mut conn, name, &exercises).unwrap_err();
      assert_eq!(error.code, expected);
    }

    let count: i64 = conn
      .query_row("SELECT COUNT(*) FROM seances", [], |row| row.get(0))
      .unwrap();
    assert_eq!(count, 0, "aucun refus ne doit avoir écrit quoi que ce soit");
  }

  #[test]
  fn rename_seance_trims_and_returns_the_updated_aggregate() {
    let mut conn = seeded_connection();

    let seance = rename_seance(&mut conn, "ma-seance", "  Ma séance B  ").unwrap();

    assert_eq!(seance.name, "Ma séance B");
    assert_eq!(
      seance.slug, "ma-seance",
      "le slug ne bouge pas au renommage"
    );
    assert_eq!(seance.exercises[0].sets.len(), 1, "l'historique est intact");
  }

  #[test]
  fn rename_seance_rejects_absent_seance_and_empty_name() {
    let mut conn = seeded_connection();

    assert_eq!(
      rename_seance(&mut conn, "absente", "Nom").unwrap_err().code,
      codes::INTROUVABLE
    );
    assert_eq!(
      rename_seance(&mut conn, "ma-seance", "  ")
        .unwrap_err()
        .code,
      codes::NOM_INVALIDE
    );
  }

  #[test]
  fn add_exercise_appends_at_the_end_with_a_unique_slug() {
    let mut conn = seeded_connection();

    let exercise = add_exercise(&mut conn, "ma-seance", &input("Squat")).unwrap();

    // 'squat' existe déjà dans cette séance : suffixe stable, position en fin.
    assert_eq!(exercise.slug, "squat-2");
    let seance = load_seance(&conn, "ma-seance").unwrap().unwrap();
    assert_eq!(
      seance
        .exercises
        .iter()
        .map(|e| e.slug.as_str())
        .collect::<Vec<_>>(),
      vec!["squat", "squat-2"]
    );
  }

  #[test]
  fn add_exercise_requires_an_existing_seance() {
    let mut conn = connection_with_schema();

    let error = add_exercise(&mut conn, "absente", &input("Curl")).unwrap_err();

    assert_eq!(error.code, codes::INTROUVABLE);
  }

  #[test]
  fn move_exercise_renumbers_the_whole_seance() {
    let mut conn = connection_with_schema();
    create_seance(
      &mut conn,
      "Lower",
      &[input("Squat"), input("Presse"), input("Leg curl")],
    )
    .unwrap();

    let seance = move_exercise(&mut conn, "lower", "leg-curl", Direction::Up)
      .unwrap()
      .expect("un cran au milieu doit déplacer");

    assert_eq!(
      seance
        .exercises
        .iter()
        .map(|e| e.slug.as_str())
        .collect::<Vec<_>>(),
      vec!["squat", "leg-curl", "presse"]
    );
    // Et c'est bien l'ordre persisté, pas un ordre de passage.
    assert_eq!(seance, load_seance(&conn, "lower").unwrap().unwrap());
  }

  #[test]
  fn move_exercise_at_the_edges_does_nothing_and_says_so() {
    let mut conn = connection_with_schema();
    create_seance(&mut conn, "Lower", &[input("Squat"), input("Presse")]).unwrap();

    assert!(move_exercise(&mut conn, "lower", "squat", Direction::Up)
      .unwrap()
      .is_none());
    assert!(move_exercise(&mut conn, "lower", "presse", Direction::Down)
      .unwrap()
      .is_none());
    assert_eq!(
      move_exercise(&mut conn, "lower", "absent", Direction::Up)
        .unwrap_err()
        .code,
      codes::INTROUVABLE
    );
  }

  #[test]
  fn set_exercise_dumbbell_flips_the_flag_on_the_right_exercise() {
    let mut conn = seeded_connection();

    let exercise = set_exercise_dumbbell(&mut conn, "ma-seance", "squat", true).unwrap();

    assert!(exercise.is_dumbbell);
    assert!(
      !load_exercise(&conn, "upper-a", "developpe-couche")
        .unwrap()
        .unwrap()
        .is_dumbbell,
      "les autres exercices ne bougent pas"
    );
    assert_eq!(
      set_exercise_dumbbell(&mut conn, "ma-seance", "absent", true)
        .unwrap_err()
        .code,
      codes::INTROUVABLE
    );
  }

  #[test]
  fn adopt_demo_clears_the_example_history_and_keeps_the_seances() {
    let mut conn = seeded_connection();

    let seances = adopt_demo_seances(&mut conn).unwrap();

    let upper = seances.iter().find(|s| s.slug == "upper-a").unwrap();
    assert!(!upper.is_demo);
    assert!(
      upper.exercises[0].sets.is_empty(),
      "l'historique d'exemple est vidé"
    );
    let mine = seances.iter().find(|s| s.slug == "ma-seance").unwrap();
    assert_eq!(
      mine.exercises[0].sets.len(),
      1,
      "les données réelles sont intactes"
    );
  }

  #[test]
  fn delete_demo_data_removes_only_the_demo() {
    let mut conn = seeded_connection();

    let seances = delete_demo_data(&mut conn).unwrap();

    assert_eq!(
      seances.iter().map(|s| s.slug.as_str()).collect::<Vec<_>>(),
      vec!["ma-seance"]
    );
    let orphans: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM sets WHERE seance_slug = 'upper-a'",
        [],
        |row| row.get(0),
      )
      .unwrap();
    assert_eq!(orphans, 0, "les séries de la démo partent avec elle");
  }

  /// Le rollback sur fichier réel : la table `exercises` est supprimée, la
  /// création échoue donc après l'insertion de la séance — et le fichier
  /// rouvert ne porte aucune trace de la séance à moitié créée.
  #[test]
  fn a_mid_transaction_failure_leaves_the_reopened_file_untouched() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_path_buf();

    {
      let mut conn = Connection::open(&path).unwrap();
      apply_schema(&conn);
      conn.execute_batch("DROP TABLE exercises;").unwrap();

      let error = create_seance(&mut conn, "Lower", &[input("Squat")]).unwrap_err();
      assert_eq!(error.code, codes::STOCKAGE_INDISPONIBLE);
    }

    let conn = Connection::open(&path).unwrap();
    let count: i64 = conn
      .query_row("SELECT COUNT(*) FROM seances", [], |row| row.get(0))
      .unwrap();
    assert_eq!(count, 0);
  }
}
