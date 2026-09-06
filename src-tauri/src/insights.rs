//! Les règles d'entraînement, en Rust (#71).
//!
//! Le fantôme, la cible, le verdict, la stagnation, les records, le repos pris
//! et la gamme montante vivaient dans `src/lib/trainingInsights.ts`. Plusieurs
//! écrans y retriaient le même historique, chacun avec sa propre idée de ce
//! qu'est une journée.
//!
//! Ils vivent maintenant ici, et un **instantané** les rend d'un seul appel :
//! une lecture du tracker, pas un aller-retour par métrique.
//!
//! ## La journée, la semaine
//!
//! La journée d'entraînement est le **jour UTC** de la série, exactement comme
//! l'app la lisait : c'est ce qui regroupe les séries en séances, et ce que la
//! base porte déjà dans `completed_at`. Les semaines commencent le lundi. Rien
//! ici ne connaît de fuseau — le formatage local reste à Vue.

use crate::contract::ExerciseSet;

/// Une journée où l'exercice a été travaillé.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingSession {
  /// Jour UTC `AAAA-MM-JJ` : c'est lui qui regroupe les séries.
  pub key: String,
  /// De la plus récente à la plus ancienne, comme partout dans l'app.
  pub sets: Vec<ExerciseSet>,
  pub reps: i64,
  #[serde(with = "crate::contract::kilograms")]
  pub volume: f64,
  #[serde(with = "crate::contract::kilograms")]
  pub heaviest: f64,
  /// Séance allégée volontairement. Son volume reste compté — c'est du travail
  /// réel — mais elle ne sert ni de fantôme, ni de record, ni de plateau.
  pub is_deload: bool,
}

/// L'homologue positionnel d'une série : la N-ième d'aujourd'hui se mesure à
/// la N-ième de la séance de référence.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionalGhost {
  pub set: ExerciseSet,
  /// Numéro (1-based) de la série homologue dans la séance de référence.
  pub position: i64,
  pub session_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
  #[serde(with = "crate::contract::kilograms")]
  pub weight: f64,
  pub reps: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
  Progress,
  Equal,
  Regress,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetComparison {
  #[serde(with = "crate::contract::kilograms")]
  pub weight_delta: f64,
  pub reps_delta: i64,
  pub outcome: Outcome,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RampStep {
  #[serde(with = "crate::contract::kilograms")]
  pub weight: f64,
  pub reps: i64,
}

/// Ce qu'une lecture du tracker rend, d'un seul appel : les séries utiles, le
/// fantôme, la cible, la stagnation, les records et le repos réellement pris.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseSnapshot {
  pub sessions: Vec<TrainingSession>,
  pub ghost: Option<PositionalGhost>,
  pub target: Target,
  pub is_stagnant: bool,
  /// Du plus ancien au plus récent : l'histoire se lit dans le sens du temps.
  pub records: Vec<ExerciseSet>,
  /// Repos médian réellement pris entre deux séries de travail ; `null` tant
  /// qu'aucune séance n'en porte deux.
  pub median_rest_taken: Option<i64>,
  pub warmup_ramp: Vec<RampStep>,
}

/// Une série de travail : l'échauffement reste au carnet, hors statistiques.
pub fn is_working_set(set: &ExerciseSet) -> bool {
  !set.is_warmup
}

/// Clé de journée (UTC) : c'est elle qui regroupe les séries en séances.
pub fn date_key(completed_at: &str) -> &str {
  &completed_at[..10]
}

/// Le lundi de la semaine d'une journée UTC, en `AAAA-MM-JJ`.
pub fn week_start(day: &str) -> String {
  let days = days_from_civil(day);
  // 1970-01-01 était un jeudi : +3 amène le lundi à zéro.
  let monday = days - (days + 3).rem_euclid(7);

  civil_from_days(monday)
}

/// Regroupe les séries de travail en journées, de la plus récente à la plus
/// ancienne — et, dans chacune, de la plus récente à la plus ancienne.
pub fn group_into_sessions(sets: &[ExerciseSet]) -> Vec<TrainingSession> {
  let mut working: Vec<&ExerciseSet> = sets.iter().filter(|set| is_working_set(set)).collect();
  working.sort_by(|first, second| second.completed_at.cmp(&first.completed_at));

  let mut sessions: Vec<TrainingSession> = Vec::new();

  for set in working {
    let key = date_key(&set.completed_at).to_string();

    match sessions.last_mut() {
      Some(session) if session.key == key => session.sets.push(set.clone()),
      _ => sessions.push(TrainingSession {
        key,
        sets: vec![set.clone()],
        reps: 0,
        volume: 0.0,
        heaviest: 0.0,
        is_deload: false,
      }),
    }
  }

  for session in &mut sessions {
    session.reps = session.sets.iter().map(|set| set.reps).sum();
    session.volume = session
      .sets
      .iter()
      .map(|set| set.reps as f64 * set.weight)
      .sum();
    session.heaviest = session
      .sets
      .iter()
      .map(|set| set.weight)
      .fold(f64::NEG_INFINITY, f64::max);
    // Une séance est une décharge quand toutes ses séries de travail le sont :
    // une seule série allégée dans une séance normale est un ajustement.
    session.is_deload = session.sets.iter().all(|set| set.is_deload);
  }

  sessions
}

/// Le fantôme est positionnel : la N-ième série d'aujourd'hui se mesure à la
/// N-ième de la séance précédente. Un schéma pyramidal se reproduit donc série
/// par série au lieu d'être écrasé par « dernière série + 1 rep ». Au-delà du
/// nombre de séries de la référence, on reste sur sa dernière.
///
/// Une décharge ne sert pas de mètre étalon : on remonte à la dernière séance
/// qui n'en était pas une. Faute de mieux, elle reste préférable à pas de
/// fantôme du tout.
pub fn positional_ghost(sessions: &[TrainingSession], today: &str) -> Option<PositionalGhost> {
  let latest = sessions.first()?;
  let current = if latest.key == today { Some(latest) } else { None };
  let candidates = if current.is_some() {
    &sessions[1..]
  } else {
    sessions
  };

  let reference = candidates
    .iter()
    .find(|session| !session.is_deload)
    .or_else(|| candidates.first())?;

  let done_today = current.map_or(0, |session| session.sets.len());
  // session.sets va de la plus récente à la plus ancienne : on remet la séance
  // de référence dans l'ordre où elle a été exécutée.
  let index = done_today.min(reference.sets.len().saturating_sub(1));
  let set = reference.sets.iter().rev().nth(index)?;

  Some(PositionalGhost {
    set: set.clone(),
    position: index as i64 + 1,
    session_key: reference.key.clone(),
  })
}

/// La cible à viser : celle du fantôme, à l'identique. L'app ne propose jamais
/// « +1 » d'elle-même — la surcharge reste une décision (GL-22).
pub fn suggested_target(ghost: Option<&PositionalGhost>, fallback: Target) -> Target {
  match ghost {
    Some(ghost) => Target {
      weight: ghost.set.weight,
      reps: ghost.set.reps,
    },
    None => fallback,
  }
}

/// Deux séances identiques d'affilée. Une décharge n'est ni un plateau ni une
/// contre-performance : le plateau se lit sur les séances qui visaient la
/// performance.
pub fn is_exercise_stagnant(sessions: &[TrainingSession]) -> bool {
  let worked: Vec<&TrainingSession> = sessions.iter().filter(|s| !s.is_deload).collect();

  match worked.as_slice() {
    [latest, previous, ..] => latest.heaviest == previous.heaviest && latest.reps == previous.reps,
    _ => false,
  }
}

/// Compare une série à son homologue. Quand la charge et les répétitions
/// varient en sens contraire — le cas courant en pyramidal —, le verdict suit
/// la charge, mais les deux écarts restent exposés pour que le lifteur juge.
pub fn compare_to_ghost(set: (i64, f64), ghost: (i64, f64)) -> SetComparison {
  let weight_delta = set.1 - ghost.1;
  let reps_delta = set.0 - ghost.0;
  let decisive = if weight_delta != 0.0 {
    weight_delta
  } else {
    reps_delta as f64
  };

  SetComparison {
    weight_delta,
    reps_delta,
    outcome: if decisive > 0.0 {
      Outcome::Progress
    } else if decisive < 0.0 {
      Outcome::Regress
    } else {
      Outcome::Equal
    },
  }
}

/// Le chemin parcouru : les séries qui, le jour où elles ont été faites,
/// battaient tout ce qui précédait. Du plus ancien au plus récent.
///
/// L'échauffement et la décharge n'en sont pas, et une charge **égale** n'en
/// est pas un non plus. Le record porte sur la charge seule.
pub fn record_history(sets: &[ExerciseSet]) -> Vec<ExerciseSet> {
  let mut working: Vec<&ExerciseSet> = sets.iter().filter(|set| is_working_set(set)).collect();
  working.sort_by(|first, second| first.completed_at.cmp(&second.completed_at));

  let mut records = Vec::new();
  let mut heaviest = f64::NEG_INFINITY;

  for set in working {
    if set.is_deload || set.weight <= heaviest {
      continue;
    }

    heaviest = set.weight;
    records.push(set.clone());
  }

  records
}

/// Au-delà, l'écart entre deux séries n'est plus un repos : la séance a été
/// interrompue. Le seuil est large exprès — c'est une borne d'aberration, pas
/// une opinion sur la durée qu'un repos devrait avoir.
pub const MAX_REST_SECONDS: i64 = 15 * 60;

/// Ce que le repos gagne quand la série à venir est le sommet de la pyramide.
pub const HEAVIEST_SET_EXTRA_REST_SECONDS: i64 = 30;

/// Le repos réellement pris entre deux séries de travail, mesuré sur les
/// horodatages — pas le repos réglé sur le chrono. La première série d'une
/// séance n'a pas de repos : elle ne compte pas plutôt que de compter zéro.
/// Médiane et non moyenne : un aller aux toilettes ne déplace pas le chiffre.
pub fn median_rest_taken(sessions: &[TrainingSession]) -> Option<i64> {
  let mut rests: Vec<i64> = Vec::new();

  for session in sessions {
    let chronological: Vec<&ExerciseSet> = session.sets.iter().rev().collect();

    for pair in chronological.windows(2) {
      let rest = seconds_between(&pair[0].completed_at, &pair[1].completed_at);

      if rest <= MAX_REST_SECONDS {
        rests.push(rest);
      }
    }
  }

  if rests.is_empty() {
    return None;
  }

  rests.sort_unstable();
  let middle = rests.len() / 2;

  Some(if rests.len() % 2 == 1 {
    rests[middle]
  } else {
    (rests[middle - 1] + rests[middle]) / 2
  })
}

/// Le repos sert la série **à venir**. Quand la suivante est la plus lourde de
/// la séance de référence, il gagne trente secondes.
pub fn rest_after_set(
  rest_seconds: i64,
  position: Option<i64>,
  reference: Option<&TrainingSession>,
) -> i64 {
  let (Some(position), Some(reference)) = (position, reference) else {
    return rest_seconds;
  };

  let next = reference.sets.iter().rev().nth(position as usize);

  match next {
    Some(set) if set.weight >= reference.heaviest => {
      rest_seconds + HEAVIEST_SET_EXTRA_REST_SECONDS
    }
    _ => rest_seconds,
  }
}

/// Gamme montante proposée vers une charge de travail : la barre à vide en
/// répétitions explosives, puis des paliers en baissant les répétitions. Aux
/// haltères il n'y a pas de barre à vide : la rampe démarre à mi-charge.
pub fn warmup_ramp(target_weight: f64, is_dumbbell: bool, weight_unit: &str) -> Vec<RampStep> {
  let is_pounds = weight_unit.to_lowercase() == "lb";
  let bar = if is_pounds { 45.0 } else { 20.0 };
  let increment = if is_dumbbell {
    if is_pounds {
      5.0
    } else {
      2.0
    }
  } else if is_pounds {
    5.0
  } else {
    2.5
  };

  let mut steps: Vec<RampStep> = Vec::new();

  if !is_dumbbell && target_weight > bar {
    steps.push(RampStep {
      weight: bar,
      reps: 10,
    });
  }

  for (fraction, reps) in [(0.5, 6), (0.7, 3), (0.9, 1)] {
    let weight = ((target_weight * fraction) / increment).round() * increment;
    // À la barre, rien n'existe sous la barre à vide.
    let below_bar = !is_dumbbell && weight < bar;
    let not_climbing = steps.last().is_some_and(|previous| weight <= previous.weight);

    if weight <= 0.0 || below_bar || weight >= target_weight || not_climbing {
      continue;
    }

    steps.push(RampStep { weight, reps });
  }

  steps
}

/// L'instantané d'un exercice : tout ce que le tracker lit, d'un seul appel.
pub fn exercise_snapshot(
  sets: &[ExerciseSet],
  today: &str,
  fallback: Target,
  is_dumbbell: bool,
  weight_unit: &str,
) -> ExerciseSnapshot {
  let sessions = group_into_sessions(sets);
  let ghost = positional_ghost(&sessions, today);
  let target = suggested_target(ghost.as_ref(), fallback);

  ExerciseSnapshot {
    is_stagnant: is_exercise_stagnant(&sessions),
    records: record_history(sets),
    median_rest_taken: median_rest_taken(&sessions),
    warmup_ramp: warmup_ramp(target.weight, is_dumbbell, weight_unit),
    ghost,
    target,
    sessions,
  }
}

fn seconds_between(earlier: &str, later: &str) -> i64 {
  timestamp_seconds(later) - timestamp_seconds(earlier)
}

/// Un horodatage canonique `AAAA-MM-JJTHH:MM:SS.mmmZ` en secondes Unix. Le
/// format est déjà garanti par le contrat : pas de fuseau à deviner, pas de
/// bibliothèque de dates à embarquer.
fn timestamp_seconds(value: &str) -> i64 {
  let days = days_from_civil(&value[..10]);
  let hours: i64 = value[11..13].parse().unwrap_or(0);
  let minutes: i64 = value[14..16].parse().unwrap_or(0);
  let seconds: i64 = value[17..19].parse().unwrap_or(0);

  days * 86_400 + hours * 3_600 + minutes * 60 + seconds
}

/// Jours depuis le 1er janvier 1970, d'après `AAAA-MM-JJ` (algorithme de
/// Howard Hinnant, `days_from_civil`).
fn days_from_civil(day: &str) -> i64 {
  let year: i64 = day[..4].parse().unwrap_or(1970);
  let month: i64 = day[5..7].parse().unwrap_or(1);
  let date: i64 = day[8..10].parse().unwrap_or(1);

  let year = year - i64::from(month <= 2);
  let era = if year >= 0 { year } else { year - 399 } / 400;
  let year_of_era = year - era * 400;
  let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + date - 1;
  let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

  era * 146_097 + day_of_era - 719_468
}

/// L'inverse de `days_from_civil` : un `AAAA-MM-JJ` depuis un nombre de jours.
fn civil_from_days(days: i64) -> String {
  let days = days + 719_468;
  let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
  let day_of_era = days - era * 146_097;
  let year_of_era =
    (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
  let year = year_of_era + era * 400;
  let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
  let month_prime = (5 * day_of_year + 2) / 153;
  let date = day_of_year - (153 * month_prime + 2) / 5 + 1;
  let month = month_prime + if month_prime < 10 { 3 } else { -9 };
  let year = year + i64::from(month <= 2);

  format!("{year:04}-{month:02}-{date:02}")
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde::Deserialize;

  /// Le fichier de référence partagé avec TypeScript, produit par
  /// `src/lib/__tests__/insightsFixture.spec.ts`. C'est lui qui rend la
  /// migration falsifiable : une règle qui diverge d'un côté fait tomber un
  /// test de l'autre, au lieu de donner deux lectures différentes de la même
  /// progression selon l'écran.
  const CASES: &str = include_str!("../../fixtures/insights-cases.json");

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct Case {
    name: String,
    today: String,
    fallback: ExpectedTarget,
    is_dumbbell: bool,
    weight_unit: String,
    sets: Vec<ExerciseSet>,
    snapshot: Expected,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct Expected {
    sessions: Vec<ExpectedSession>,
    ghost: Option<ExpectedGhost>,
    target: ExpectedTarget,
    is_stagnant: bool,
    records: Vec<i64>,
    median_rest_taken: Option<i64>,
    warmup_ramp: Vec<ExpectedStep>,
    verdict_against_ghost: Option<ExpectedVerdict>,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct ExpectedSession {
    key: String,
    sets: Vec<i64>,
    reps: i64,
    volume: f64,
    heaviest: f64,
    is_deload: bool,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct ExpectedGhost {
    set_id: i64,
    position: i64,
    session_key: String,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct ExpectedTarget {
    weight: f64,
    reps: i64,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct ExpectedStep {
    weight: f64,
    reps: i64,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct ExpectedVerdict {
    weight_delta: f64,
    reps_delta: i64,
    outcome: String,
  }

  fn cases() -> Vec<Case> {
    serde_json::from_str(CASES).expect("la fixture des règles doit se désérialiser")
  }

  #[test]
  fn every_rule_agrees_with_the_typescript_reference() {
    for case in cases() {
      let snapshot = exercise_snapshot(
        &case.sets,
        &case.today,
        Target {
          weight: case.fallback.weight,
          reps: case.fallback.reps,
        },
        case.is_dumbbell,
        &case.weight_unit,
      );
      let expected = &case.snapshot;
      let name = &case.name;

      assert_eq!(
        snapshot.sessions.len(),
        expected.sessions.len(),
        "{name} : nombre de séances"
      );

      for (session, expected_session) in snapshot.sessions.iter().zip(&expected.sessions) {
        assert_eq!(session.key, expected_session.key, "{name} : journée");
        assert_eq!(
          session.sets.iter().map(|set| set.id).collect::<Vec<_>>(),
          expected_session.sets,
          "{name} : séries de la journée {}",
          session.key
        );
        assert_eq!(session.reps, expected_session.reps, "{name} : répétitions");
        assert_eq!(session.volume, expected_session.volume, "{name} : volume");
        assert_eq!(
          session.heaviest, expected_session.heaviest,
          "{name} : charge max"
        );
        assert_eq!(
          session.is_deload, expected_session.is_deload,
          "{name} : décharge"
        );
      }

      match (&snapshot.ghost, &expected.ghost) {
        (None, None) => {}
        (Some(ghost), Some(expected_ghost)) => {
          assert_eq!(ghost.set.id, expected_ghost.set_id, "{name} : série fantôme");
          assert_eq!(
            ghost.position, expected_ghost.position,
            "{name} : position du fantôme"
          );
          assert_eq!(
            ghost.session_key, expected_ghost.session_key,
            "{name} : séance de référence"
          );
        }
        _ => panic!("{name} : présence du fantôme"),
      }

      assert_eq!(snapshot.target.weight, expected.target.weight, "{name} : charge cible");
      assert_eq!(snapshot.target.reps, expected.target.reps, "{name} : reps cibles");
      assert_eq!(snapshot.is_stagnant, expected.is_stagnant, "{name} : stagnation");
      assert_eq!(
        snapshot.records.iter().map(|set| set.id).collect::<Vec<_>>(),
        expected.records,
        "{name} : records"
      );
      assert_eq!(
        snapshot.median_rest_taken, expected.median_rest_taken,
        "{name} : repos médian pris"
      );
      assert_eq!(
        snapshot
          .warmup_ramp
          .iter()
          .map(|step| (step.weight, step.reps))
          .collect::<Vec<_>>(),
        expected
          .warmup_ramp
          .iter()
          .map(|step| (step.weight, step.reps))
          .collect::<Vec<_>>(),
        "{name} : gamme montante"
      );

      if let (Some(ghost), Some(expected_verdict)) = (&snapshot.ghost, &expected.verdict_against_ghost)
      {
        let first = &case.sets[0];
        let verdict = compare_to_ghost((first.reps, first.weight), (ghost.set.reps, ghost.set.weight));

        assert_eq!(
          verdict.weight_delta, expected_verdict.weight_delta,
          "{name} : écart de charge"
        );
        assert_eq!(
          verdict.reps_delta, expected_verdict.reps_delta,
          "{name} : écart de répétitions"
        );
        assert_eq!(
          format!("{:?}", verdict.outcome).to_lowercase(),
          expected_verdict.outcome,
          "{name} : verdict"
        );
      }
    }
  }

  #[test]
  fn weeks_start_on_monday() {
    // 2026-09-06 est un dimanche : sa semaine a commencé le lundi 31 août.
    assert_eq!(week_start("2026-09-06"), "2026-08-31");
    assert_eq!(week_start("2026-08-31"), "2026-08-31");
    assert_eq!(week_start("2026-09-01"), "2026-08-31");
    // Un changement d'année ne déplace pas le lundi.
    assert_eq!(week_start("2027-01-01"), "2026-12-28");
  }

  #[test]
  fn the_rest_before_the_top_of_the_pyramid_is_longer() {
    let sessions = group_into_sessions(&[
      set(1, 8, 60.0, "2026-01-05T18:00:00.000Z"),
      set(2, 8, 70.0, "2026-01-05T18:04:00.000Z"),
      set(3, 6, 80.0, "2026-01-05T18:08:00.000Z"),
    ]);
    let reference = sessions.first();

    assert_eq!(rest_after_set(120, Some(1), reference), 120);
    assert_eq!(rest_after_set(120, Some(2), reference), 150);
    assert_eq!(rest_after_set(120, Some(3), reference), 120);
    assert_eq!(rest_after_set(120, None, reference), 120);
  }

  fn set(id: i64, reps: i64, weight: f64, completed_at: &str) -> ExerciseSet {
    ExerciseSet {
      id,
      reps,
      weight,
      completed_at: completed_at.to_string(),
      is_warmup: false,
      rpe: None,
      is_deload: false,
    }
  }
}

/// Un exercice qui stagne, tel que le dashboard l'annonce.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagnantExercise {
  pub seance_slug: String,
  pub seance_name: String,
  pub exercise_slug: String,
  pub exercise_name: String,
}

/// Le volume d'une semaine, lundi en tête.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyVolume {
  /// Lundi UTC de la semaine, `AAAA-MM-JJ`.
  pub week: String,
  #[serde(with = "crate::contract::kilograms")]
  pub volume: f64,
  pub sets: i64,
  pub training_days: i64,
}

/// Ce qu'une lecture du dashboard rend, d'un seul appel : les alertes et les
/// agrégats, sans que l'écran ait à reparcourir tout l'historique.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
  pub stagnant: Vec<StagnantExercise>,
  /// Chiffres clés de la fenêtre récente (séries de travail seules).
  pub training_days: i64,
  pub working_sets: i64,
  #[serde(with = "crate::contract::kilograms")]
  pub lifted_volume: f64,
  #[serde(with = "crate::contract::kilograms")]
  pub heaviest_weight: f64,
  /// Horodatage de la dernière série de travail, ou `null`.
  pub last_set_at: Option<String>,
  /// De la plus ancienne à la plus récente, comme un graphe se lit.
  pub weekly: Vec<WeeklyVolume>,
}

/// Fenêtre des chiffres clés, en jours — la même que celle du dashboard.
pub const KPI_WINDOW_DAYS: i64 = 30;

/// L'instantané du dashboard. `today` est la journée UTC courante : la fenêtre
/// des chiffres clés se compte en journées, pas en millisecondes, pour qu'une
/// séance faite ce matin ne sorte pas du compte selon l'heure qu'il est.
pub fn dashboard_snapshot(seances: &[crate::contract::Seance], today: &str) -> DashboardSnapshot {
  let mut stagnant = Vec::new();
  let mut recent: Vec<&ExerciseSet> = Vec::new();
  let mut all_working: Vec<&ExerciseSet> = Vec::new();
  let since = civil_from_days(days_from_civil(today) - KPI_WINDOW_DAYS);

  for seance in seances {
    for exercise in &seance.exercises {
      if is_exercise_stagnant(&group_into_sessions(&exercise.sets)) {
        stagnant.push(StagnantExercise {
          seance_slug: seance.slug.clone(),
          seance_name: seance.name.clone(),
          exercise_slug: exercise.slug.clone(),
          exercise_name: exercise.name.clone(),
        });
      }

      for set in exercise.sets.iter().filter(|set| is_working_set(set)) {
        all_working.push(set);

        if date_key(&set.completed_at) >= since.as_str() {
          recent.push(set);
        }
      }
    }
  }

  let mut training_days: Vec<&str> = recent.iter().map(|set| date_key(&set.completed_at)).collect();
  training_days.sort_unstable();
  training_days.dedup();

  let mut weekly: Vec<WeeklyVolume> = Vec::new();

  for set in &all_working {
    let week = week_start(date_key(&set.completed_at));
    let day = date_key(&set.completed_at).to_string();

    match weekly.iter_mut().find(|entry| entry.week == week) {
      Some(entry) => {
        entry.volume += set.reps as f64 * set.weight;
        entry.sets += 1;
        // `training_days` compte les journées : on s'appuie sur l'ordre trié
        // plus bas plutôt que de garder un ensemble par semaine.
        entry.training_days += i64::from(day.as_str() != entry.week);
      }
      None => weekly.push(WeeklyVolume {
        week,
        volume: set.reps as f64 * set.weight,
        sets: 1,
        training_days: 0,
      }),
    }
  }

  // Les journées par semaine se comptent proprement en repassant dessus : un
  // compteur incrémental ne saurait pas dédoublonner.
  for entry in &mut weekly {
    let mut days: Vec<&str> = all_working
      .iter()
      .map(|set| date_key(&set.completed_at))
      .filter(|day| week_start(day) == entry.week)
      .collect();
    days.sort_unstable();
    days.dedup();
    entry.training_days = days.len() as i64;
  }

  weekly.sort_by(|first, second| first.week.cmp(&second.week));

  DashboardSnapshot {
    stagnant,
    training_days: training_days.len() as i64,
    working_sets: recent.len() as i64,
    lifted_volume: recent
      .iter()
      .map(|set| set.reps as f64 * set.weight)
      .sum::<f64>()
      .round(),
    heaviest_weight: recent
      .iter()
      .map(|set| set.weight)
      .fold(0.0, f64::max),
    last_set_at: recent
      .iter()
      .map(|set| set.completed_at.clone())
      .max(),
    weekly,
  }
}
