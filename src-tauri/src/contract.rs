//! Le contrat AppApi : les DTO canoniques échangés entre Vue et Rust, leurs
//! invariants, et le format d'erreur métier (#66).
//!
//! La spécification lisible vit dans `docs/app-api.md` ; ce module en est la
//! moitié exécutable côté Rust, la moitié TypeScript étant
//! `src/lib/appApi.ts`. Les deux sont cousues par les fixtures
//! `fixtures/contract-seances.json` et `fixtures/contract-errors.json` : le
//! test TypeScript vérifie qu'elles sont octet pour octet ce que produit sa
//! sérialisation, les tests d'ici qu'elles se désérialisent, se valident et se
//! resérialisent à l'identique. Un champ renommé d'un seul côté casse l'une
//! des deux moitiés.
//!
//! Rust est autoritaire : c'est `validate_seances` qui dit ce qu'une donnée a
//! le droit d'être. La validation des formulaires Vue reste une aide de
//! saisie immédiate, jamais une garantie.

use serde::{Deserialize, Serialize};

/// Une série enregistrée. Forme canonique : tous les champs sont explicites,
/// y compris `isWarmup` — le contrat n'a pas de valeur par défaut, c'est aux
/// adaptateurs de compléter ce que d'anciennes données n'ont pas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExerciseSet {
  /// Unique sur toute la base, pas par exercice : la suppression se fait par
  /// identifiant seul.
  pub id: i64,
  pub reps: i64,
  /// Charge totale en kilogrammes, au demi-kilo près (haltères, rampes).
  #[serde(with = "kilograms")]
  pub weight: f64,
  /// Horodatage UTC canonique : `AAAA-MM-JJTHH:MM:SS.mmmZ`, exactement ce que
  /// produit `Date.prototype.toISOString()`.
  pub completed_at: String,
  pub is_warmup: bool,
  /// Effort perçu (RPE), optionnel : de 1 à 10 au demi-point près, `null`
  /// quand la série n'a pas été notée. Absent des sauvegardes d'avant la
  /// v3 — `default` le lit alors comme non noté.
  #[serde(default, with = "rpe_scale")]
  pub rpe: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Exercise {
  pub slug: String,
  pub name: String,
  pub default_reps: i64,
  /// Kilogrammes au demi-kilo près. Zéro admis : un exercice au poids du
  /// corps n'a pas de charge externe.
  #[serde(with = "kilograms")]
  pub default_weight: f64,
  pub weight_unit: String,
  pub rest_seconds: i64,
  /// Saisie en poids d'un haltère ; l'historique reste en charge totale.
  pub is_dumbbell: bool,
  /// L'ordre du tableau est l'ordre du programme (le plus récent en tête pour
  /// les séries, l'ordre d'enchaînement pour les exercices d'une séance).
  pub sets: Vec<ExerciseSet>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Seance {
  pub slug: String,
  pub name: String,
  /// Séance d'exemple du mode découverte, supprimable d'un geste.
  pub is_demo: bool,
  pub exercises: Vec<Exercise>,
}

/// L'erreur métier que toute commande peut rendre : un code stable pour que
/// le code s'y accroche, un message en français que Vue peut afficher tel
/// quel. Jamais de `Debug` brut d'une erreur technique dans `message`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppError {
  pub code: String,
  pub message: String,
}

impl AppError {
  pub fn new(code: &str, message: impl Into<String>) -> Self {
    Self {
      code: code.to_string(),
      message: message.into(),
    }
  }

  /// L'habillage unique des échecs SQLite : un seul code, un message qui
  /// porte le détail technique en `Display` (jamais en `Debug`).
  pub fn storage(error: impl std::fmt::Display) -> Self {
    Self::new(
      codes::STOCKAGE_INDISPONIBLE,
      format!("Base de données inaccessible : {error}"),
    )
  }
}

impl std::fmt::Display for AppError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "[{}] {}", self.code, self.message)
  }
}

impl std::error::Error for AppError {}

/// Les codes d'erreur du contrat. Stables : Vue et les tests des deux
/// langages s'y réfèrent par valeur. Les dix premiers sortent de
/// `validate_seances`, les suivants des commandes (`bootstrap.rs`,
/// `mutations.rs`).
pub mod codes {
  pub const SLUG_INVALIDE: &str = "slug-invalide";
  pub const SLUG_DUPLIQUE: &str = "slug-duplique";
  pub const NOM_INVALIDE: &str = "nom-invalide";
  pub const REPETITIONS_INVALIDES: &str = "repetitions-invalides";
  pub const CHARGE_INVALIDE: &str = "charge-invalide";
  pub const UNITE_INVALIDE: &str = "unite-invalide";
  pub const REPOS_INVALIDE: &str = "repos-invalide";
  pub const IDENTIFIANT_INVALIDE: &str = "identifiant-invalide";
  pub const IDENTIFIANT_DUPLIQUE: &str = "identifiant-duplique";
  pub const DATE_INVALIDE: &str = "date-invalide";
  pub const RPE_INVALIDE: &str = "rpe-invalide";
  /// Pesée mal formée (poids hors échelle) — porté par les commandes de
  /// poids de corps (`body_weight.rs`), pas par `validate_seances`.
  pub const POIDS_CORPS_INVALIDE: &str = "poids-corps-invalide";
  /// La graine de démonstration ne respecte pas sa forme (séance non-démo).
  pub const GRAINE_INVALIDE: &str = "graine-invalide";
  /// SQLite inaccessible ou en échec : le message porte le détail technique.
  pub const STOCKAGE_INDISPONIBLE: &str = "stockage-indisponible";
  /// La séance ou l'exercice visé n'existe pas (ou plus) dans la base.
  pub const INTROUVABLE: &str = "introuvable";
  /// Une séance se crée avec au moins un exercice.
  pub const SEANCE_SANS_EXERCICE: &str = "seance-sans-exercice";
}

/// Vérifie les invariants du contrat sur un lot complet de séances — la forme
/// sous laquelle voyagent le semis, la restauration et bientôt le CRUD.
/// Première violation rencontrée, première rendue : l'appelant n'a rien à
/// agréger, l'utilisateur reçoit un seul message clair.
pub fn validate_seances(seances: &[Seance]) -> Result<(), AppError> {
  let mut seance_slugs = std::collections::HashSet::new();
  let mut set_ids = std::collections::HashSet::new();

  for seance in seances {
    if !is_valid_slug(&seance.slug) {
      return Err(AppError::new(
        codes::SLUG_INVALIDE,
        format!(
          "Séance « {} » : un slug est en minuscules ascii, chiffres et tirets simples.",
          seance.slug
        ),
      ));
    }

    if !seance_slugs.insert(&seance.slug) {
      return Err(AppError::new(
        codes::SLUG_DUPLIQUE,
        format!("Deux séances portent le slug « {} ».", seance.slug),
      ));
    }

    if !is_trimmed_non_empty(&seance.name) {
      return Err(AppError::new(
        codes::NOM_INVALIDE,
        format!(
          "Séance « {} » : le nom est vide ou porte des espaces de bord.",
          seance.slug
        ),
      ));
    }

    let mut exercise_slugs = std::collections::HashSet::new();

    for exercise in &seance.exercises {
      validate_exercise(seance, exercise)?;

      if !exercise_slugs.insert(&exercise.slug) {
        return Err(AppError::new(
          codes::SLUG_DUPLIQUE,
          format!(
            "Séance « {} » : deux exercices portent le slug « {} ».",
            seance.slug, exercise.slug
          ),
        ));
      }

      for set in &exercise.sets {
        validate_set(exercise, set)?;

        if !set_ids.insert(set.id) {
          return Err(AppError::new(
            codes::IDENTIFIANT_DUPLIQUE,
            format!(
              "Deux séries portent l'identifiant {} : il est unique sur toute la base.",
              set.id
            ),
          ));
        }
      }
    }
  }

  Ok(())
}

fn validate_exercise(seance: &Seance, exercise: &Exercise) -> Result<(), AppError> {
  if !is_valid_slug(&exercise.slug) {
    return Err(AppError::new(
      codes::SLUG_INVALIDE,
      format!(
        "Exercice « {} » (séance « {} ») : un slug est en minuscules ascii, chiffres et tirets simples.",
        exercise.slug, seance.slug
      ),
    ));
  }

  if !is_trimmed_non_empty(&exercise.name) {
    return Err(AppError::new(
      codes::NOM_INVALIDE,
      format!(
        "Exercice « {} » : le nom est vide ou porte des espaces de bord.",
        exercise.slug
      ),
    ));
  }

  if exercise.default_reps < 1 {
    return Err(AppError::new(
      codes::REPETITIONS_INVALIDES,
      format!(
        "Exercice « {} » : l'objectif de répétitions est d'au moins 1.",
        exercise.slug
      ),
    ));
  }

  // Zéro admis (poids du corps), mais toujours sur la grille du demi-kilo.
  if !is_half_kilo_step(exercise.default_weight) || exercise.default_weight < 0.0 {
    return Err(AppError::new(
      codes::CHARGE_INVALIDE,
      format!(
        "Exercice « {} » : la charge cible est un multiple positif de 0,5 kg.",
        exercise.slug
      ),
    ));
  }

  if !is_trimmed_non_empty(&exercise.weight_unit) {
    return Err(AppError::new(
      codes::UNITE_INVALIDE,
      format!(
        "Exercice « {} » : l'unité de poids est vide.",
        exercise.slug
      ),
    ));
  }

  if exercise.rest_seconds < 0 {
    return Err(AppError::new(
      codes::REPOS_INVALIDE,
      format!(
        "Exercice « {} » : le repos ne peut pas être négatif.",
        exercise.slug
      ),
    ));
  }

  Ok(())
}

fn validate_set(exercise: &Exercise, set: &ExerciseSet) -> Result<(), AppError> {
  if set.id < 1 {
    return Err(AppError::new(
      codes::IDENTIFIANT_INVALIDE,
      format!(
        "Exercice « {} » : l'identifiant de série {} est invalide (au moins 1).",
        exercise.slug, set.id
      ),
    ));
  }

  if set.reps < 1 {
    return Err(AppError::new(
      codes::REPETITIONS_INVALIDES,
      format!(
        "Série {} : au moins une répétition pour être enregistrée.",
        set.id
      ),
    ));
  }

  // Contrairement à la cible d'un exercice, une série enregistrée porte une
  // vraie charge : le formulaire refuse déjà tout total sous 1 kg.
  if !is_half_kilo_step(set.weight) || set.weight < 1.0 {
    return Err(AppError::new(
      codes::CHARGE_INVALIDE,
      format!(
        "Série {} : la charge est un multiple de 0,5 kg, d'au moins 1 kg.",
        set.id
      ),
    ));
  }

  if !is_canonical_utc_timestamp(&set.completed_at) {
    return Err(AppError::new(
      codes::DATE_INVALIDE,
      format!(
        "Série {} : « {} » n'est pas un horodatage UTC canonique (AAAA-MM-JJTHH:MM:SS.mmmZ).",
        set.id, set.completed_at
      ),
    ));
  }

  // L'échelle RPE va de 1 (trivial) à 10 (échec) ; le demi-point (8,5) est
  // d'usage courant. `is_half_kilo_step` vérifie exactement ce pas.
  if let Some(rpe) = set.rpe {
    if !is_half_kilo_step(rpe) || !(1.0..=10.0).contains(&rpe) {
      return Err(AppError::new(
        codes::RPE_INVALIDE,
        format!(
          "Série {} : le RPE se note de 1 à 10, au demi-point près.",
          set.id
        ),
      ));
    }
  }

  Ok(())
}

/// La forme que produit `slugify` côté TypeScript : minuscules ascii et
/// chiffres, séparés par des tirets simples, jamais en bord.
fn is_valid_slug(value: &str) -> bool {
  !value.is_empty()
    && !value.starts_with('-')
    && !value.ends_with('-')
    && !value.contains("--")
    && value
      .bytes()
      .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn is_trimmed_non_empty(value: &str) -> bool {
  !value.is_empty() && value.trim() == value
}

/// La plus petite marche réelle du matériel : 0,5 kg (1,25 kg par côté d'une
/// barre n'existe pas dans l'app, un total impair sur deux haltères si).
/// Partagée avec les mutations, qui valident la même grille sur leurs entrées.
pub(crate) fn is_half_kilo_step(weight: f64) -> bool {
  weight.is_finite() && (weight * 2.0).fract() == 0.0
}

/// Exactement la forme de `Date.prototype.toISOString()` : 24 caractères,
/// millisecondes, suffixe `Z`. Volontairement plus étroit que ISO 8601 — un
/// décalage `+02:00` ou des secondes sans millisecondes sont refusés, car deux
/// écritures d'un même instant casseraient la déduplication par signature.
pub(crate) fn is_canonical_utc_timestamp(value: &str) -> bool {
  let bytes = value.as_bytes();

  if bytes.len() != 24 {
    return false;
  }

  let separators_ok = bytes[4] == b'-'
    && bytes[7] == b'-'
    && bytes[10] == b'T'
    && bytes[13] == b':'
    && bytes[16] == b':'
    && bytes[19] == b'.'
    && bytes[23] == b'Z';

  if !separators_ok {
    return false;
  }

  let all_digits = bytes
    .iter()
    .enumerate()
    .all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) || byte.is_ascii_digit());

  if !all_digits {
    return false;
  }

  let number = |range: std::ops::Range<usize>| value[range].parse::<u32>().unwrap();
  let (year, month, day) = (number(0..4), number(5..7), number(8..10));
  let (hour, minute, second) = (number(11..13), number(14..16), number(17..19));

  (1..=12).contains(&month)
    && (1..=days_in_month(year, month)).contains(&day)
    && hour < 24
    && minute < 60
    && second < 60
}

fn days_in_month(year: u32, month: u32) -> u32 {
  match month {
    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
    4 | 6 | 9 | 11 => 30,
    2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
    2 => 28,
    _ => 0,
  }
}

/// Sérialise les kilogrammes comme `JSON.stringify` : `60`, pas `60.0` — les
/// fixtures contractuelles se comparent octet pour octet. À la lecture, un
/// entier JSON entre aussi bien qu'un décimal.
pub(crate) mod kilograms {
  pub fn serialize<S: serde::Serializer>(weight: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if weight.fract() == 0.0 && weight.is_finite() {
      serializer.serialize_i64(*weight as i64)
    } else {
      serializer.serialize_f64(*weight)
    }
  }

  pub fn deserialize<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    serde::Deserialize::deserialize(deserializer)
  }
}

/// Comme `kilograms` : sur le fil, un RPE entier s'écrit sans décimale
/// (`8`, pas `8.0`), et une série non notée s'écrit `null`.
mod rpe_scale {
  pub fn serialize<S: serde::Serializer>(
    rpe: &Option<f64>,
    serializer: S,
  ) -> Result<S::Ok, S::Error> {
    match rpe {
      None => serializer.serialize_none(),
      Some(value) if value.fract() == 0.0 && value.is_finite() => {
        serializer.serialize_i64(*value as i64)
      }
      Some(value) => serializer.serialize_f64(*value),
    }
  }

  pub fn deserialize<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
  ) -> Result<Option<f64>, D::Error> {
    serde::Deserialize::deserialize(deserializer)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Le même fichier que compare octet pour octet le test TypeScript
  /// `src/lib/__tests__/appApi.spec.ts` : c'est lui le point de contact.
  const REFERENCE_SEANCES: &str = include_str!("../../fixtures/contract-seances.json");
  const REFERENCE_ERRORS: &str = include_str!("../../fixtures/contract-errors.json");

  fn reference_seances() -> Vec<Seance> {
    serde_json::from_str(REFERENCE_SEANCES)
      .expect("fixtures/contract-seances.json doit se désérialiser dans les DTO canoniques")
  }

  fn seance(slug: &str, exercises: Vec<Exercise>) -> Seance {
    Seance {
      slug: slug.to_string(),
      name: "Une séance".to_string(),
      is_demo: false,
      exercises,
    }
  }

  fn exercise(slug: &str, sets: Vec<ExerciseSet>) -> Exercise {
    Exercise {
      slug: slug.to_string(),
      name: "Un exercice".to_string(),
      default_reps: 8,
      default_weight: 60.0,
      weight_unit: "kg".to_string(),
      rest_seconds: 120,
      is_dumbbell: false,
      sets,
    }
  }

  fn set(id: i64) -> ExerciseSet {
    ExerciseSet {
      id,
      reps: 8,
      weight: 60.0,
      completed_at: "2026-08-15T09:00:00.000Z".to_string(),
      is_warmup: false,
      rpe: None,
    }
  }

  #[test]
  fn the_reference_seances_deserialize_and_are_valid() {
    let seances = reference_seances();

    // Garde-fou : une fixture dégénérée validerait sans rien prouver. Les
    // formes qui ont déjà divergé doivent y être : charge fractionnaire,
    // haltères, échauffement, exercice sans série, séance de démonstration.
    assert!(seances.len() > 1);
    let exercises: Vec<&Exercise> = seances.iter().flat_map(|s| &s.exercises).collect();
    let sets: Vec<&ExerciseSet> = exercises.iter().flat_map(|e| &e.sets).collect();
    assert!(seances.iter().any(|s| s.is_demo));
    assert!(seances.iter().any(|s| !s.is_demo));
    assert!(exercises.iter().any(|e| e.is_dumbbell));
    assert!(exercises.iter().any(|e| e.sets.is_empty()));
    assert!(exercises.iter().any(|e| e.default_weight.fract() != 0.0));
    assert!(sets.iter().any(|s| s.is_warmup));
    assert!(sets.iter().any(|s| s.weight.fract() != 0.0));

    validate_seances(&seances).expect("la fixture de référence doit être valide");
  }

  /// La resérialisation Rust rend exactement les octets écrits par
  /// TypeScript : mêmes noms de champs, même ordre, mêmes nombres (60, pas
  /// 60.0). C'est ce qui permet aux commandes Rust de *rendre* des séances,
  /// pas seulement d'en recevoir.
  #[test]
  fn the_reference_seances_reserialize_byte_for_byte() {
    let seances = reference_seances();

    let serialized = format!("{}\n", serde_json::to_string_pretty(&seances).unwrap());

    assert_eq!(serialized, REFERENCE_SEANCES);
  }

  #[test]
  fn the_reference_errors_round_trip_byte_for_byte() {
    let errors: Vec<AppError> = serde_json::from_str(REFERENCE_ERRORS)
      .expect("fixtures/contract-errors.json doit se désérialiser dans AppError");

    assert!(!errors.is_empty());
    assert!(errors.iter().all(|error| !error.message.is_empty()));

    let serialized = format!("{}\n", serde_json::to_string_pretty(&errors).unwrap());

    assert_eq!(serialized, REFERENCE_ERRORS);
  }

  /// Un champ que Rust ne connaît pas doit refuser la charge utile plutôt que
  /// d'être avalé en silence : c'est ainsi qu'un renommage d'un seul côté se
  /// voit en test au lieu de perdre des données chez l'utilisateur.
  #[test]
  fn unknown_fields_are_rejected() {
    let payload =
      r#"{ "slug": "upper-a", "name": "Upper A", "isDemo": false, "exercises": [], "extra": 1 }"#;

    let result: Result<Seance, _> = serde_json::from_str(payload);

    assert!(result.is_err());
  }

  #[test]
  fn a_valid_batch_passes() {
    let seances = vec![seance("upper-a", vec![exercise("curl", vec![set(1)])])];

    assert_eq!(validate_seances(&seances), Ok(()));
  }

  #[test]
  fn slugs_must_be_lowercase_ascii_with_single_dashes() {
    for bad in ["", "Upper A", "upper--a", "-upper", "upper-", "éveil"] {
      let seances = vec![seance(bad, vec![])];
      let error = validate_seances(&seances).unwrap_err();
      assert_eq!(error.code, codes::SLUG_INVALIDE, "slug refusé : {bad:?}");
    }

    let seances = vec![seance("upper-a", vec![exercise("Curl!", vec![])])];
    let error = validate_seances(&seances).unwrap_err();
    assert_eq!(error.code, codes::SLUG_INVALIDE);
  }

  #[test]
  fn duplicate_slugs_are_rejected_at_their_scope() {
    let seances = vec![seance("upper-a", vec![]), seance("upper-a", vec![])];
    assert_eq!(
      validate_seances(&seances).unwrap_err().code,
      codes::SLUG_DUPLIQUE
    );

    // Le même slug d'exercice dans deux séances différentes est légitime.
    let seances = vec![
      seance("upper-a", vec![exercise("curl", vec![])]),
      seance("upper-b", vec![exercise("curl", vec![])]),
    ];
    assert_eq!(validate_seances(&seances), Ok(()));

    let seances = vec![seance(
      "upper-a",
      vec![exercise("curl", vec![]), exercise("curl", vec![])],
    )];
    assert_eq!(
      validate_seances(&seances).unwrap_err().code,
      codes::SLUG_DUPLIQUE
    );
  }

  #[test]
  fn names_must_be_trimmed_and_non_empty() {
    for bad in ["", " Upper A", "Upper A "] {
      let mut invalid = seance("upper-a", vec![]);
      invalid.name = bad.to_string();
      let error = validate_seances(&[invalid]).unwrap_err();
      assert_eq!(error.code, codes::NOM_INVALIDE, "nom refusé : {bad:?}");
    }
  }

  #[test]
  fn reps_require_at_least_one() {
    let mut invalid = exercise("curl", vec![]);
    invalid.default_reps = 0;
    let seances = vec![seance("upper-a", vec![invalid])];
    assert_eq!(
      validate_seances(&seances).unwrap_err().code,
      codes::REPETITIONS_INVALIDES
    );

    let mut invalid_set = set(1);
    invalid_set.reps = 0;
    let seances = vec![seance("upper-a", vec![exercise("curl", vec![invalid_set])])];
    assert_eq!(
      validate_seances(&seances).unwrap_err().code,
      codes::REPETITIONS_INVALIDES
    );
  }

  #[test]
  fn weights_stay_on_the_half_kilo_grid() {
    // La cible d'un exercice : zéro admis (poids du corps), 0,3 refusé.
    let mut bodyweight = exercise("tractions", vec![]);
    bodyweight.default_weight = 0.0;
    assert_eq!(
      validate_seances(&[seance("upper-a", vec![bodyweight])]),
      Ok(())
    );

    for bad in [0.3, -0.5, f64::NAN, f64::INFINITY] {
      let mut invalid = exercise("curl", vec![]);
      invalid.default_weight = bad;
      let error = validate_seances(&[seance("upper-a", vec![invalid])]).unwrap_err();
      assert_eq!(error.code, codes::CHARGE_INVALIDE, "charge refusée : {bad}");
    }

    // Une série enregistrée : le demi-kilo passe, sous 1 kg rien ne passe.
    let mut half_kilo = set(1);
    half_kilo.weight = 32.5;
    assert_eq!(
      validate_seances(&[seance("upper-a", vec![exercise("curl", vec![half_kilo])])]),
      Ok(())
    );

    for bad in [0.0, 0.5, 60.3] {
      let mut invalid = set(1);
      invalid.weight = bad;
      let error =
        validate_seances(&[seance("upper-a", vec![exercise("curl", vec![invalid])])]).unwrap_err();
      assert_eq!(error.code, codes::CHARGE_INVALIDE, "charge refusée : {bad}");
    }
  }

  #[test]
  fn weight_unit_and_rest_are_checked() {
    let mut invalid = exercise("curl", vec![]);
    invalid.weight_unit = " ".to_string();
    assert_eq!(
      validate_seances(&[seance("upper-a", vec![invalid])])
        .unwrap_err()
        .code,
      codes::UNITE_INVALIDE
    );

    let mut invalid = exercise("curl", vec![]);
    invalid.rest_seconds = -1;
    assert_eq!(
      validate_seances(&[seance("upper-a", vec![invalid])])
        .unwrap_err()
        .code,
      codes::REPOS_INVALIDE
    );
  }

  #[test]
  fn set_ids_are_positive_and_globally_unique() {
    let mut invalid = set(0);
    invalid.id = 0;
    assert_eq!(
      validate_seances(&[seance("upper-a", vec![exercise("curl", vec![invalid])])])
        .unwrap_err()
        .code,
      codes::IDENTIFIANT_INVALIDE
    );

    // Le doublon traverse les séances : l'unicité est celle de la base.
    let seances = vec![
      seance("upper-a", vec![exercise("curl", vec![set(7)])]),
      seance("upper-b", vec![exercise("squat", vec![set(7)])]),
    ];
    assert_eq!(
      validate_seances(&seances).unwrap_err().code,
      codes::IDENTIFIANT_DUPLIQUE
    );
  }

  #[test]
  fn timestamps_must_be_canonical_utc() {
    // Ce que `toISOString` produit passe, y compris un 29 février bissextile.
    for good in ["2026-08-15T09:00:00.000Z", "2024-02-29T23:59:59.999Z"] {
      let mut valid = set(1);
      valid.completed_at = good.to_string();
      assert_eq!(
        validate_seances(&[seance("upper-a", vec![exercise("curl", vec![valid])])]),
        Ok(()),
        "date acceptée : {good}"
      );
    }

    // Toute autre écriture — même un instant équivalent — est refusée : deux
    // formes d'un même instant casseraient la déduplication par signature.
    for bad in [
      "",
      "2026-08-15",
      "2026-08-15T09:00:00Z",
      "2026-08-15T11:00:00.000+02:00",
      "2026-02-29T09:00:00.000Z",
      "2026-13-01T09:00:00.000Z",
      "2026-08-15T24:00:00.000Z",
      "2026-08-15t09:00:00.000z",
    ] {
      let mut invalid = set(1);
      invalid.completed_at = bad.to_string();
      let error =
        validate_seances(&[seance("upper-a", vec![exercise("curl", vec![invalid])])]).unwrap_err();
      assert_eq!(error.code, codes::DATE_INVALIDE, "date refusée : {bad:?}");
    }
  }

  #[test]
  fn rpe_is_optional_but_stays_on_the_half_point_scale() {
    // Non noté, entier, demi-point : les trois formes légitimes.
    for good in [None, Some(7.0), Some(8.5), Some(10.0), Some(1.0)] {
      let mut valid = set(1);
      valid.rpe = good;
      assert_eq!(
        validate_seances(&[seance("upper-a", vec![exercise("curl", vec![valid])])]),
        Ok(()),
        "RPE accepté : {good:?}"
      );
    }

    for bad in [0.0, 0.5, 10.5, 7.3, -8.0, f64::NAN, f64::INFINITY] {
      let mut invalid = set(1);
      invalid.rpe = Some(bad);
      let error =
        validate_seances(&[seance("upper-a", vec![exercise("curl", vec![invalid])])]).unwrap_err();
      assert_eq!(error.code, codes::RPE_INVALIDE, "RPE refusé : {bad}");
    }
  }

  #[test]
  fn app_errors_serialize_in_camel_case_without_technical_noise() {
    let error = AppError::new(codes::DATE_INVALIDE, "Message affichable.");

    let json = serde_json::to_value(&error).unwrap();

    assert_eq!(
      json,
      serde_json::json!({ "code": "date-invalide", "message": "Message affichable." })
    );
  }
}
