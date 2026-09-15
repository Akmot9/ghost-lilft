//! Le format de sauvegarde de Revenant, et sa validation (#70).
//!
//! Le codec vivait en TypeScript : le frontend lisait le fichier, le validait,
//! renumérotait les séries, puis passait un second DTO à Rust. Une sauvegarde
//! n'était donc jamais refusée par l'autorité qui écrit la base — seulement par
//! l'écran qui la lui présentait.
//!
//! Il vit maintenant ici. La commande d'import reçoit le **texte brut** choisi
//! par l'utilisateur, et rien n'atteint SQLite avant que le fichier entier ait
//! été accepté.
//!
//! Les messages d'erreur sont ceux que l'utilisateur lit : ils sont écrits en
//! français, nomment ce qui cloche, et ne changent pas de sens en traversant le
//! pont.

use serde_json::Value;

use crate::body_weight::BodyWeight;
use crate::contract::{codes, AppError, Exercise, ExerciseSet, Seance};

pub const FORMAT: &str = "ghost-lift-backup";

/// v1 : séances, exercices, historique.
/// v2 : ajoute `isWarmup` sur les séries et `isDumbbell` sur les exercices.
/// v3 : ajoute `rpe` (effort perçu, nullable) sur les séries.
/// v4 : ajoute `bodyWeights`, les pesées (#70).
/// v5 : ajoute `isDeload` sur les séries (#97).
/// v6 : ajoute `notes` sur les exercices (#44).
///
/// Une app plus ancienne refuse une version plus récente au lieu de la
/// restaurer en perdant ces champs en silence ; l'app courante lit encore les
/// v1 à v5.
pub const VERSION: i64 = 6;
const OLDEST_READABLE_VERSION: i64 = 1;

/// Ce qu'une sauvegarde contient : le programme avec son historique, et les
/// pesées, qui vivent à part des séances (`docs/app-api.md`).
#[derive(Debug, Clone, PartialEq)]
pub struct BackupPayload {
  pub seances: Vec<Seance>,
  pub body_weights: Vec<BodyWeight>,
}

fn invalide(message: impl Into<String>) -> AppError {
  AppError::new(codes::SAUVEGARDE_INVALIDE, message)
}

/// Lit une sauvegarde. Tout est vérifié avant que quoi que ce soit ne soit
/// rendu : un fichier à moitié bon n'existe pas.
pub fn parse(text: &str) -> Result<BackupPayload, AppError> {
  let payload: Value = serde_json::from_str(text)
    .map_err(|_| invalide("Fichier illisible : ce n'est pas un fichier JSON valide."))?;

  let object = payload
    .as_object()
    .ok_or_else(|| invalide("Fichier illisible : contenu inattendu."))?;

  if object.get("format").and_then(Value::as_str) != Some(FORMAT) {
    return Err(invalide("Ce fichier n'est pas une sauvegarde Revenant."));
  }

  let version = object
    .get("version")
    .and_then(Value::as_i64)
    .filter(|version| *version >= OLDEST_READABLE_VERSION)
    .ok_or_else(|| invalide("Fichier invalide : version de sauvegarde inconnue."))?;

  if version > VERSION {
    return Err(invalide(
      "Cette sauvegarde a été créée par une version plus récente de Revenant. Mets l'app à jour pour la restaurer.",
    ));
  }

  let mut seances = read_seances(object.get("seances"))?;

  // Un fichier valide mais vide, restauré, viderait la base : il inspire une
  // confiance qu'il ne mérite pas (#57). La garde sur les données réelles
  // protège déjà, mais le parseur doit refuser, c'est son rôle.
  if seances.is_empty() {
    return Err(invalide(
      "Fichier vide : cette sauvegarde ne contient aucune séance.",
    ));
  }

  apply_history(&mut seances, object.get("history"))?;

  Ok(BackupPayload {
    seances,
    body_weights: read_body_weights(object.get("bodyWeights"))?,
  })
}

/// Les séries à verser dans un exercice, extraites de n'importe quelle
/// sauvegarde Revenant. Seuls les exercices porteurs d'historique comptent : un
/// fichier peut décrire un programme entier dont un seul exercice a des séries,
/// et c'est celui-là qu'on veut.
pub fn read_exercise_sets(text: &str, exercise_slug: &str) -> Result<Vec<ExerciseSet>, AppError> {
  let carriers: Vec<Exercise> = parse(text)?
    .seances
    .into_iter()
    .flat_map(|seance| seance.exercises)
    .filter(|exercise| !exercise.sets.is_empty())
    .collect();

  if let Some(named) = carriers.iter().find(|exercise| exercise.slug == exercise_slug) {
    return Ok(named.sets.clone());
  }

  if carriers.is_empty() {
    return Err(invalide("Ce fichier ne contient aucune série à importer."));
  }

  // Un seul historique dans le fichier : aucune ambiguïté à lever, on le prend
  // même si son identifiant diffère. C'est ce qui permet de verser dans un
  // exercice l'historique exporté sous un autre nom.
  if carriers.len() == 1 {
    return Ok(carriers[0].sets.clone());
  }

  let noms = carriers
    .iter()
    .map(|exercise| format!("« {} »", exercise.name))
    .collect::<Vec<_>>()
    .join(", ");

  Err(invalide(format!(
    "Ce fichier contient plusieurs exercices avec un historique ({noms}). Exporte celui que tu veux importer depuis son propre écran."
  )))
}

fn read_seances(raw: Option<&Value>) -> Result<Vec<Seance>, AppError> {
  let entries = raw
    .and_then(Value::as_array)
    .ok_or_else(|| invalide("Fichier incomplet : aucune séance trouvée."))?;

  let mut seances = Vec::new();
  let mut seen = Vec::new();

  for entry in entries {
    let slug = non_empty_string(entry.get("slug"));
    let name = non_empty_string(entry.get("name"));

    let (slug, name) = match (slug, name) {
      (Some(slug), Some(name)) => (slug, name),
      _ => {
        return Err(invalide(
          "Fichier incomplet : une séance n'a ni identifiant ni nom.",
        ))
      }
    };

    if !is_valid_slug(&slug) {
      return Err(invalide(format!(
        "Fichier invalide : le slug de séance « {slug} » n'est pas au format attendu."
      )));
    }

    if seen.contains(&slug) {
      return Err(invalide(format!(
        "Fichier invalide : la séance « {slug} » apparaît en double."
      )));
    }
    seen.push(slug.clone());

    let exercises = read_exercises(entry.get("exercises"), &slug)?;

    seances.push(Seance {
      slug,
      name,
      // `isDemo` n'est jamais lu : une sauvegarde restaurée est la donnée de
      // l'utilisateur, elle ne doit pas ressusciter la bannière du mode
      // découverte.
      is_demo: false,
      exercises,
    });
  }

  Ok(seances)
}

fn read_exercises(raw: Option<&Value>, seance_slug: &str) -> Result<Vec<Exercise>, AppError> {
  let entries = raw.and_then(Value::as_array).ok_or_else(|| {
    invalide(format!(
      "Fichier incomplet : la séance « {seance_slug} » n'a pas d'exercices."
    ))
  })?;

  let mut exercises = Vec::new();
  let mut seen = Vec::new();

  for entry in entries {
    let slug = non_empty_string(entry.get("slug"));
    let name = non_empty_string(entry.get("name"));

    let (slug, name) = match (slug, name) {
      (Some(slug), Some(name)) => (slug, name),
      _ => {
        return Err(invalide(format!(
          "Fichier incomplet : un exercice de « {seance_slug} » est mal formé."
        )))
      }
    };

    if !is_valid_slug(&slug) {
      return Err(invalide(format!(
        "Fichier invalide : le slug d'exercice « {slug} » n'est pas au format attendu."
      )));
    }

    if seen.contains(&slug) {
      return Err(invalide(format!(
        "Fichier invalide : l'exercice « {slug} » apparaît en double."
      )));
    }
    seen.push(slug.clone());

    let default_reps = entry.get("defaultReps").and_then(Value::as_i64);
    let default_weight = finite_number(entry.get("defaultWeight"));
    let rest_seconds = entry.get("restSeconds").and_then(Value::as_i64);
    let weight_unit = non_empty_string(entry.get("weightUnit"));

    let (default_reps, default_weight, rest_seconds, weight_unit) =
      match (default_reps, default_weight, rest_seconds, weight_unit) {
        (Some(reps), Some(weight), Some(rest), Some(unit)) => (reps, weight, rest, unit),
        _ => {
          return Err(invalide(format!(
            "Fichier incomplet : l'exercice « {slug} » a des valeurs manquantes."
          )))
        }
      };

    let is_dumbbell = match entry.get("isDumbbell") {
      None | Some(Value::Null) => false,
      Some(Value::Bool(flag)) => *flag,
      Some(_) => {
        return Err(invalide(format!(
          "Fichier invalide : le mode haltères de « {slug} » est mal formé."
        )))
      }
    };

    let notes = match entry.get("notes") {
      None | Some(Value::Null) => String::new(),
      Some(Value::String(notes)) => notes.clone(),
      Some(_) => {
        return Err(invalide(format!(
          "Fichier invalide : les consignes de « {slug} » sont mal formées."
        )))
      }
    };

    exercises.push(Exercise {
      slug,
      name,
      default_reps,
      default_weight,
      weight_unit,
      rest_seconds,
      // Les sauvegardes v1 antérieures au mode haltères n'ont pas ce champ,
      // ni celles d'avant la v6 les consignes.
      is_dumbbell,
      notes,
      sets: Vec::new(),
    });
  }

  Ok(exercises)
}

/// Les pesées d'une sauvegarde. Absentes avant la v4 : un fichier ancien n'a
/// pas perdu ses pesées, il n'en portait pas.
fn read_body_weights(raw: Option<&Value>) -> Result<Vec<BodyWeight>, AppError> {
  let entries = match raw {
    None | Some(Value::Null) => return Ok(Vec::new()),
    Some(Value::Array(entries)) => entries,
    Some(_) => return Err(invalide("Fichier invalide : les pesées sont mal formées.")),
  };

  let mut weights = Vec::new();
  let mut seen = Vec::new();

  for entry in entries {
    let day = non_empty_string(entry.get("day")).filter(|day| is_calendar_day(day));

    let day = day.ok_or_else(|| {
      let shown = entry
        .get("day")
        .map(|value| match value {
          Value::String(text) => text.clone(),
          other => other.to_string(),
        })
        .unwrap_or_else(|| "undefined".to_string());

      invalide(format!(
        "Fichier invalide : la pesée « {shown} » n'est pas datée d'un jour calendaire (AAAA-MM-JJ)."
      ))
    })?;

    // Le dixième de kilogramme est la marche d'un pèse-personne ; les bornes
    // écartent la faute de frappe (7 kg pour 70) — les mêmes règles que
    // `body_weight.rs`, qui reste autoritaire.
    let kilograms = finite_number(entry.get("kilograms")).filter(|kilograms| {
      (kilograms * 10.0).round() == kilograms * 10.0 && *kilograms >= 20.0 && *kilograms <= 400.0
    });

    let kilograms = kilograms.ok_or_else(|| {
      invalide(format!(
        "Fichier invalide : la pesée du {day} s'écrit en kilogrammes, au dixième près, entre 20 et 400."
      ))
    })?;

    if seen.contains(&day) {
      return Err(invalide(format!(
        "Fichier invalide : deux pesées portent le jour {day}."
      )));
    }
    seen.push(day.clone());

    weights.push(BodyWeight { day, kilograms });
  }

  Ok(weights)
}

fn apply_history(seances: &mut [Seance], raw: Option<&Value>) -> Result<(), AppError> {
  let entries = match raw {
    None | Some(Value::Null) => return Ok(()),
    Some(Value::Array(entries)) => entries.clone(),
    Some(_) => return Err(invalide("Fichier invalide : l'historique est mal formé.")),
  };

  // `sets.id` est une clé primaire globale (AUTOINCREMENT) et `remove_set`
  // supprime par identifiant seul : une numérotation repartant de 1 à chaque
  // exercice entrerait en collision dès le deuxième exercice porteur de séries.
  // On numérote donc sur toute la sauvegarde.
  let mut next_id = 1;
  let mut seen_carriers: Vec<String> = Vec::new();

  for entry in &entries {
    let seance_slug = entry.get("seanceSlug").and_then(Value::as_str).unwrap_or("");
    let exercise_slug = entry
      .get("exerciseSlug")
      .and_then(Value::as_str)
      .unwrap_or("");

    let carrier = format!("{seance_slug}|{exercise_slug}");

    let exercise = seances
      .iter_mut()
      .find(|seance| seance.slug == seance_slug)
      .and_then(|seance| {
        seance
          .exercises
          .iter_mut()
          .find(|exercise| exercise.slug == exercise_slug)
      });

    let exercise = exercise.ok_or_else(|| {
      invalide(format!(
        "Fichier incohérent : l'historique référence « {exercise_slug} », absent des séances."
      ))
    })?;

    let sets = entry.get("sets").and_then(Value::as_array).ok_or_else(|| {
      invalide(format!(
        "Fichier invalide : les séries de « {exercise_slug} » sont mal formées."
      ))
    })?;

    // Deux entrées pour le même exercice s'écrasaient en silence — un chemin
    // de perte dans un parseur dont le rôle est justement de refuser (#57).
    if seen_carriers.contains(&carrier) {
      return Err(invalide(format!(
        "Fichier invalide : l'historique référence deux fois « {exercise_slug} »."
      )));
    }
    seen_carriers.push(carrier);

    let mut parsed = Vec::with_capacity(sets.len());

    for set in sets {
      let reps = set.get("reps").and_then(Value::as_i64);
      let weight = finite_number(set.get("weight"));

      let (reps, weight) = match (reps, weight) {
        (Some(reps), Some(weight)) => (reps, weight),
        _ => {
          return Err(invalide(format!(
            "Fichier incomplet : une série de « {exercise_slug} » est mal formée."
          )))
        }
      };

      let is_warmup = match set.get("isWarmup") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(_) => {
          return Err(invalide(format!(
            "Fichier invalide : le type de série de « {exercise_slug} » est mal formé."
          )))
        }
      };

      let is_deload = match set.get("isDeload") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(_) => {
          return Err(invalide(format!(
            "Fichier invalide : le marqueur de décharge d'une série de « {exercise_slug} » est mal formé."
          )))
        }
      };

      let rpe = match set.get("rpe") {
        None | Some(Value::Null) => None,
        Some(value) => Some(finite_number(Some(value)).ok_or_else(|| {
          invalide(format!(
            "Fichier invalide : le RPE d'une série de « {exercise_slug} » est mal formé."
          ))
        })?),
      };

      let completed_at = set
        .get("completedAt")
        .and_then(Value::as_str)
        .filter(|value| crate::contract::is_canonical_utc_timestamp(value))
        .ok_or_else(|| {
          invalide(format!(
            "Fichier invalide : une série de « {exercise_slug} » porte une date illisible."
          ))
        })?;

      // Les identifiants sont locaux : on renumérote plutôt que de faire
      // confiance au fichier, qui peut venir d'un autre appareil.
      parsed.push(ExerciseSet {
        id: next_id,
        reps,
        weight,
        completed_at: completed_at.to_string(),
        is_warmup,
        rpe,
        is_deload,
      });
      next_id += 1;
    }

    exercise.sets = parsed;
  }

  Ok(())
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
  value
    .and_then(Value::as_str)
    .filter(|text| !text.trim().is_empty())
    .map(str::to_string)
}

fn finite_number(value: Option<&Value>) -> Option<f64> {
  value
    .and_then(Value::as_f64)
    .filter(|number| number.is_finite())
}

/// `AAAA-MM-JJ`, jour réel du calendrier : un 30 février n'est pas un jour.
fn is_calendar_day(value: &str) -> bool {
  crate::contract::is_canonical_utc_timestamp(&format!("{value}T00:00:00.000Z"))
}

/// La forme que produit `slugify` : un slug étranger à cette grammaire (`/`,
/// espaces, majuscules) passerait le parseur puis casserait le routage
/// `/seances/:slug` sans message (#57).
fn is_valid_slug(value: &str) -> bool {
  !value.is_empty()
    && !value.starts_with('-')
    && !value.ends_with('-')
    && !value.contains("--")
    && value
      .chars()
      .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
}

/// La forme du **fichier**, distincte de celle du contrat : une sauvegarde
/// n'écrit ni `isDemo` ni les identifiants de séries, et sépare le programme
/// de son historique. Des structs plutôt qu'un `json!` : l'ordre des champs
/// est alors garanti par la déclaration, comme pour tout le reste du contrat.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile<'a> {
  format: &'static str,
  version: i64,
  exported_at: &'a str,
  seances: Vec<BackupSeance<'a>>,
  history: Vec<BackupHistory<'a>>,
  body_weights: Vec<BackupWeight<'a>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupSeance<'a> {
  slug: &'a str,
  name: &'a str,
  exercises: Vec<BackupExercise<'a>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupExercise<'a> {
  slug: &'a str,
  name: &'a str,
  default_reps: i64,
  #[serde(with = "crate::contract::kilograms")]
  default_weight: f64,
  weight_unit: &'a str,
  rest_seconds: i64,
  is_dumbbell: bool,
  notes: &'a str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupHistory<'a> {
  seance_slug: &'a str,
  exercise_slug: &'a str,
  sets: Vec<BackupSet<'a>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupSet<'a> {
  reps: i64,
  #[serde(with = "crate::contract::kilograms")]
  weight: f64,
  completed_at: &'a str,
  is_warmup: bool,
  #[serde(with = "crate::contract::rpe_scale")]
  rpe: Option<f64>,
  is_deload: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupWeight<'a> {
  day: &'a str,
  #[serde(with = "crate::contract::kilograms")]
  kilograms: f64,
}

/// Écrit une sauvegarde. Le modèle de séance et l'historique sont sérialisés
/// séparément : un fichier sans `history` est déjà un programme partageable, ce
/// qui évitera un nouveau format le jour où le partage de séance arrivera.
///
/// `isDemo` n'est jamais écrit — une sauvegarde restaurée est la donnée de
/// l'utilisateur, elle ne doit pas ressusciter la bannière du mode découverte.
/// Les identifiants de séries non plus : ce sont des autoincrement locaux,
/// réattribués à l'import.
pub fn serialize(seances: &[Seance], exported_at: &str, body_weights: &[BodyWeight]) -> String {
  let mut history = Vec::new();

  for seance in seances {
    for exercise in &seance.exercises {
      if exercise.sets.is_empty() {
        continue;
      }

      let mut sets: Vec<&ExerciseSet> = exercise.sets.iter().collect();
      sets.sort_by(|first, second| first.completed_at.cmp(&second.completed_at));

      history.push(BackupHistory {
        seance_slug: &seance.slug,
        exercise_slug: &exercise.slug,
        sets: sets
          .into_iter()
          .map(|set| BackupSet {
            reps: set.reps,
            weight: set.weight,
            completed_at: &set.completed_at,
            is_warmup: set.is_warmup,
            rpe: set.rpe,
            is_deload: set.is_deload,
          })
          .collect(),
      });
    }
  }

  // Du plus ancien au plus récent, comme l'historique des séries : un fichier
  // de sauvegarde se lit dans le sens du temps.
  let mut weights: Vec<&BodyWeight> = body_weights.iter().collect();
  weights.sort_by(|first, second| first.day.cmp(&second.day));

  let file = BackupFile {
    format: FORMAT,
    version: VERSION,
    exported_at,
    seances: seances
      .iter()
      .map(|seance| BackupSeance {
        slug: &seance.slug,
        name: &seance.name,
        exercises: seance
          .exercises
          .iter()
          .map(|exercise| BackupExercise {
            slug: &exercise.slug,
            name: &exercise.name,
            default_reps: exercise.default_reps,
            default_weight: exercise.default_weight,
            weight_unit: &exercise.weight_unit,
            rest_seconds: exercise.rest_seconds,
            is_dumbbell: exercise.is_dumbbell,
            notes: &exercise.notes,
          })
          .collect(),
      })
      .collect(),
    history,
    body_weights: weights
      .into_iter()
      .map(|weight| BackupWeight {
        day: &weight.day,
        kilograms: weight.kilograms,
      })
      .collect(),
  };

  format!(
    "{}\n",
    serde_json::to_string_pretty(&file).expect("une sauvegarde est toujours sérialisable")
  )
}

/// Le nom du fichier d'une sauvegarde complète.
pub fn file_name(exported_at: &str) -> String {
  format!("revenant-{}.json", &exported_at[..10])
}

/// Le nom du fichier d'une sauvegarde limitée à un exercice.
pub fn exercise_file_name(seance_slug: &str, exercise_slug: &str, exported_at: &str) -> String {
  format!(
    "revenant-{seance_slug}-{exercise_slug}-{}.json",
    &exported_at[..10]
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Le fichier de référence partagé avec TypeScript : la sauvegarde que
  /// `src/lib/__tests__/backup.spec.ts` produit, octet pour octet. Un champ
  /// ajouté d'un seul côté fait tomber un test au lieu de casser l'app.
  const REFERENCE_BACKUP: &str = include_str!("../../fixtures/contract-backup.json");

  fn payload() -> BackupPayload {
    parse(REFERENCE_BACKUP).expect("la sauvegarde de référence doit se lire")
  }

  #[test]
  fn the_reference_backup_round_trips_byte_for_byte() {
    let read = payload();

    let written = serialize(&read.seances, "2026-08-15T09:00:00.000Z", &read.body_weights);

    assert_eq!(written, REFERENCE_BACKUP);
  }

  #[test]
  fn a_backup_carries_its_history_onto_the_exercises() {
    let read = payload();

    let with_sets: usize = read
      .seances
      .iter()
      .flat_map(|seance| &seance.exercises)
      .filter(|exercise| !exercise.sets.is_empty())
      .count();

    assert!(with_sets > 0, "la référence doit porter de l'historique");
    // Les identifiants sont réattribués sur toute la sauvegarde, jamais repris
    // du fichier : ils doivent être uniques d'un exercice à l'autre.
    let mut ids: Vec<i64> = read
      .seances
      .iter()
      .flat_map(|seance| &seance.exercises)
      .flat_map(|exercise| &exercise.sets)
      .map(|set| set.id)
      .collect();
    let count = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), count);
  }

  #[test]
  fn a_file_from_another_app_is_refused() {
    let error = parse(r#"{"format":"autre-chose","version":1,"seances":[]}"#).unwrap_err();

    assert_eq!(error.code, codes::SAUVEGARDE_INVALIDE);
    assert!(error.message.contains("pas une sauvegarde Revenant"));
  }

  #[test]
  fn a_newer_version_is_refused_rather_than_read_half_way() {
    let text = format!(
      r#"{{"format":"{FORMAT}","version":{},"seances":[]}}"#,
      VERSION + 1
    );

    let error = parse(&text).unwrap_err();

    assert!(error.message.contains("version plus récente"));
  }

  #[test]
  fn an_empty_backup_is_refused_so_it_cannot_wipe_the_database() {
    let text = format!(r#"{{"format":"{FORMAT}","version":1,"seances":[]}}"#);

    let error = parse(&text).unwrap_err();

    assert!(error.message.contains("Fichier vide"));
  }

  #[test]
  fn a_version_one_backup_still_restores() {
    // Ce qu'une v1 portait : ni échauffement, ni RPE, ni pesées, ni consignes.
    let text = format!(
      r#"{{"format":"{FORMAT}","version":1,"exportedAt":"2026-08-15T09:00:00.000Z",
        "seances":[{{"slug":"upper-a","name":"Upper A","exercises":[
          {{"slug":"squat","name":"Squat","defaultReps":5,"defaultWeight":100,
            "weightUnit":"kg","restSeconds":180}}]}}],
        "history":[{{"seanceSlug":"upper-a","exerciseSlug":"squat","sets":[
          {{"reps":5,"weight":100,"completedAt":"2026-08-01T18:00:00.000Z"}}]}}]}}"#
    );

    let read = parse(&text).expect("une v1 doit encore se restaurer");
    let exercise = &read.seances[0].exercises[0];

    assert_eq!(exercise.sets.len(), 1);
    assert!(!exercise.sets[0].is_warmup);
    assert_eq!(exercise.sets[0].rpe, None);
    assert!(!exercise.sets[0].is_deload);
    assert_eq!(exercise.notes, "");
    assert!(read.body_weights.is_empty());
  }

  #[test]
  fn a_history_pointing_at_a_missing_exercise_is_refused() {
    let text = format!(
      r#"{{"format":"{FORMAT}","version":1,"seances":[
        {{"slug":"upper-a","name":"Upper A","exercises":[
          {{"slug":"squat","name":"Squat","defaultReps":5,"defaultWeight":100,
            "weightUnit":"kg","restSeconds":180}}]}}],
        "history":[{{"seanceSlug":"upper-a","exerciseSlug":"absent","sets":[]}}]}}"#
    );

    let error = parse(&text).unwrap_err();

    assert!(error.message.contains("absent des séances"));
  }

  #[test]
  fn a_single_exercise_history_is_taken_whatever_its_name() {
    // Aucune ambiguïté à lever : un fichier qui ne porte qu'un historique le
    // donne, même sous un autre nom. C'est ce qui permet de verser dans un
    // exercice l'historique exporté depuis un autre.
    let sets = read_exercise_sets(REFERENCE_BACKUP, "un-slug-qui-n-existe-pas").unwrap();

    assert!(!sets.is_empty());
  }

  #[test]
  fn several_histories_are_an_ambiguity_the_parser_refuses_to_settle() {
    let text = format!(
      r#"{{"format":"{FORMAT}","version":1,"seances":[
        {{"slug":"upper-a","name":"Upper A","exercises":[
          {{"slug":"squat","name":"Squat","defaultReps":5,"defaultWeight":100,
            "weightUnit":"kg","restSeconds":180}},
          {{"slug":"presse","name":"Presse","defaultReps":10,"defaultWeight":80,
            "weightUnit":"kg","restSeconds":90}}]}}],
        "history":[
          {{"seanceSlug":"upper-a","exerciseSlug":"squat","sets":[
            {{"reps":5,"weight":100,"completedAt":"2026-08-01T18:00:00.000Z"}}]}},
          {{"seanceSlug":"upper-a","exerciseSlug":"presse","sets":[
            {{"reps":10,"weight":80,"completedAt":"2026-08-01T18:10:00.000Z"}}]}}]}}"#
    );

    let error = read_exercise_sets(&text, "absent").unwrap_err();

    assert!(error.message.contains("plusieurs exercices"));
    assert!(error.message.contains("Squat"));
  }

  #[test]
  fn the_named_exercise_wins_when_the_file_holds_several() {
    let read = payload();
    let named = read
      .seances
      .iter()
      .flat_map(|seance| &seance.exercises)
      .find(|exercise| !exercise.sets.is_empty())
      .expect("la référence doit porter de l'historique");

    let sets = read_exercise_sets(REFERENCE_BACKUP, &named.slug).unwrap();

    assert_eq!(sets.len(), named.sets.len());
  }
}

/// Restaure une sauvegarde : la base est **remplacée** par le fichier, en une
/// seule transaction. Tout ou rien — une erreur en cours de route laisse la
/// base exactement dans l'état où elle était.
///
/// C'est le pendant de `parse` : rien n'atteint SQLite avant que le fichier
/// entier ait été accepté, et tout ce que le fichier porte est écrit. Le
/// chemin précédent passait par un DTO intermédiaire qui ignorait `is_deload`
/// et `notes` : une sauvegarde restaurée y perdait ses décharges et ses
/// consignes en silence.
pub fn restore(
  connection: &mut rusqlite::Connection,
  payload: &BackupPayload,
) -> Result<(), AppError> {
  // Hors transaction : ce PRAGMA est ignoré à l'intérieur d'une transaction.
  // Les clés étrangères refusent alors une série orpheline plutôt que de la
  // laisser dans une base que l'app ne saurait plus lire.
  connection
    .execute_batch("PRAGMA foreign_keys = ON;")
    .map_err(AppError::storage)?;

  let transaction = connection.transaction().map_err(AppError::storage)?;

  // Ordre imposé par les clés étrangères : les séries référencent les
  // exercices, qui référencent les séances.
  for statement in [
    "DELETE FROM sets",
    "DELETE FROM exercises",
    "DELETE FROM seances",
    "DELETE FROM body_weights",
  ] {
    transaction
      .execute(statement, [])
      .map_err(AppError::storage)?;
  }

  for seance in &payload.seances {
    // is_demo = 0 : ce que l'utilisateur restaure est à lui, la bannière du
    // mode découverte n'a pas à réapparaître.
    transaction
      .execute(
        "INSERT INTO seances (slug, name, is_demo) VALUES (?1, ?2, 0)",
        rusqlite::params![seance.slug, seance.name],
      )
      .map_err(AppError::storage)?;

    // L'ordre du tableau *est* l'ordre du programme : le fichier ne porte pas
    // de champ `position`, il porte la liste dans l'ordre où l'utilisateur
    // veut voir ses exercices. On le fige ici en colonne.
    for (position, exercise) in seance.exercises.iter().enumerate() {
      transaction
        .execute(
          "INSERT INTO exercises (seance_slug, slug, name, default_reps, default_weight, weight_unit, rest_seconds, is_dumbbell, notes, position)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
          rusqlite::params![
            seance.slug,
            exercise.slug,
            exercise.name,
            exercise.default_reps,
            exercise.default_weight,
            exercise.weight_unit,
            exercise.rest_seconds,
            exercise.is_dumbbell,
            exercise.notes,
            position as i64,
          ],
        )
        .map_err(AppError::storage)?;

      for set in &exercise.sets {
        transaction
          .execute(
            "INSERT INTO sets (id, seance_slug, exercise_slug, reps, weight, completed_at, is_warmup, rpe, is_deload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
              set.id,
              seance.slug,
              exercise.slug,
              set.reps,
              set.weight,
              set.completed_at,
              set.is_warmup,
              set.rpe,
              set.is_deload,
            ],
          )
          .map_err(AppError::storage)?;
      }
    }
  }

  for weight in &payload.body_weights {
    transaction
      .execute(
        "INSERT INTO body_weights (day, kilograms) VALUES (?1, ?2)",
        rusqlite::params![weight.day, weight.kilograms],
      )
      .map_err(AppError::storage)?;
  }

  transaction.commit().map_err(AppError::storage)
}
