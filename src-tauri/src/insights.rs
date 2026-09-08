//! Les règles d'entraînement, en Rust (#71).
//!
//! Le fantôme, la cible, la stagnation, les records, le repos pris, la gamme
//! montante et les agrégats hebdomadaires vivaient dans
//! `src/lib/trainingInsights.ts`. Plusieurs écrans y retriaient le même
//! historique, chacun avec sa propre idée de ce qu'est une journée.
//!
//! Ils vivent maintenant ici, et un **instantané** les rend d'un seul appel :
//! une lecture du tracker, de l'écran de séance ou du dashboard, pas un
//! aller-retour par métrique. Vue ne recalcule plus rien : la seule lecture
//! qui reste de son côté est la comparaison d'une série à son fantôme, faite
//! à l'instant où la série est validée (`compare_to_ghost` en est la
//! référence, verrouillée par la fixture).
//!
//! ## La journée, la semaine
//!
//! La journée d'entraînement est le **jour UTC** de la série, exactement comme
//! l'app la lisait : c'est ce qui regroupe les séries en séances, et ce que la
//! base porte déjà dans `completed_at`. Les semaines commencent le lundi UTC.
//! Rien ici ne connaît de fuseau — le formatage local reste à Vue.
//!
//! ## La fixture partagée
//!
//! `fixtures/insights-cases.json` est écrit par l'adaptateur navigateur
//! (`src/lib/insightsBrowser.ts`) : pour chaque historique, l'instantané
//! complet, tel qu'il voyagerait sur le fil. Les tests d'ici relisent le
//! fichier et exigent le même JSON, champ pour champ. Une règle qui diverge
//! d'un côté fait tomber un test de l'autre.

use crate::contract::{Exercise, ExerciseSet, Seance};

/// Une journée où l'exercice a été travaillé.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingSession {
  /// Jour UTC `AAAA-MM-JJ` : c'est lui qui regroupe les séries.
  pub key: String,
  /// Lundi UTC de la semaine, `AAAA-MM-JJ`.
  pub week: String,
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

/// Une journée où l'exercice a été échauffé : sa gamme montante, telle que
/// faite. À part des séances : l'échauffement est hors statistiques, mais le
/// tracker montre la rampe du jour et celle de la dernière fois.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmupDay {
  pub key: String,
  pub week: String,
  /// De la plus récente à la plus ancienne.
  pub sets: Vec<ExerciseSet>,
  #[serde(with = "crate::contract::kilograms")]
  pub volume: f64,
  #[serde(with = "crate::contract::kilograms")]
  pub heaviest: f64,
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

/// Le volume d'une journée, pour la mèche des semaines à plusieurs séances.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayVolume {
  pub key: String,
  #[serde(with = "crate::contract::kilograms")]
  pub volume: f64,
}

/// Le volume d'une semaine, lundi en tête ; `days` du plus ancien au plus récent.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyVolume {
  /// Lundi UTC de la semaine, `AAAA-MM-JJ`.
  pub week: String,
  #[serde(with = "crate::contract::kilograms")]
  pub volume: f64,
  pub days: Vec<DayVolume>,
}

/// Ce qu'une lecture du tracker rend, d'un seul appel.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseSnapshot {
  /// La journée UTC pour laquelle l'instantané a été pris.
  pub today: String,
  pub sessions: Vec<TrainingSession>,
  pub warmups: Vec<WarmupDay>,
  pub ghost: Option<PositionalGhost>,
  pub target: Target,
  /// Le repos à lancer une fois la série visée validée : celui de l'exercice,
  /// allongé si la série suivante est le sommet de la pyramide (#94).
  pub rest_seconds: i64,
  pub is_stagnant: bool,
  /// Du plus ancien au plus récent : l'histoire se lit dans le sens du temps.
  pub records: Vec<ExerciseSet>,
  /// La série de travail la plus récente bat toute charge antérieure.
  pub is_latest_set_record: bool,
  /// … ou tient sa charge pour plus de répétitions que jamais (#95).
  pub is_latest_set_reps_record: bool,
  /// Meilleur 1RM estimé (Epley) ; `null` sans série de travail.
  #[serde(with = "crate::contract::optional_kilograms")]
  pub one_rep_max: Option<f64>,
  /// Jours écoulés depuis la dernière séance ; `null` sur un exercice jamais fait.
  pub days_away: Option<i64>,
  /// Charge de reprise suggérée après deux semaines d'arrêt ; `null` sinon.
  #[serde(with = "crate::contract::optional_kilograms")]
  pub return_load: Option<f64>,
  /// Repos médian réellement pris entre deux séries de travail ; `null` tant
  /// qu'aucune séance n'en porte deux.
  pub median_rest_taken: Option<i64>,
  pub warmup_ramp: Vec<RampStep>,
  /// De la plus ancienne à la plus récente, comme un graphe se lit.
  pub weekly: Vec<WeeklyVolume>,
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

fn newest_first<'a>(sets: impl Iterator<Item = &'a ExerciseSet>) -> Vec<&'a ExerciseSet> {
  let mut sorted: Vec<&ExerciseSet> = sets.collect();
  sorted.sort_by(|first, second| second.completed_at.cmp(&first.completed_at));
  sorted
}

/// Regroupe les séries de travail en journées, de la plus récente à la plus
/// ancienne — et, dans chacune, de la plus récente à la plus ancienne.
pub fn group_into_sessions(sets: &[ExerciseSet]) -> Vec<TrainingSession> {
  let mut sessions: Vec<TrainingSession> = Vec::new();

  for set in newest_first(sets.iter().filter(|set| is_working_set(set))) {
    let key = date_key(&set.completed_at).to_string();

    match sessions.last_mut() {
      Some(session) if session.key == key => session.sets.push(set.clone()),
      _ => sessions.push(TrainingSession {
        week: week_start(&key),
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
    session.volume = volume_of(session.sets.iter());
    session.heaviest = heaviest_of(session.sets.iter());
    // Une séance est une décharge quand toutes ses séries de travail le sont :
    // une seule série allégée dans une séance normale est un ajustement.
    session.is_deload = session.sets.iter().all(|set| set.is_deload);
  }

  sessions
}

/// Les journées d'échauffement, de la plus récente à la plus ancienne.
pub fn group_warmups(sets: &[ExerciseSet]) -> Vec<WarmupDay> {
  let mut days: Vec<WarmupDay> = Vec::new();

  for set in newest_first(sets.iter().filter(|set| !is_working_set(set))) {
    let key = date_key(&set.completed_at).to_string();

    match days.last_mut() {
      Some(day) if day.key == key => day.sets.push(set.clone()),
      _ => days.push(WarmupDay {
        week: week_start(&key),
        key,
        sets: vec![set.clone()],
        volume: 0.0,
        heaviest: 0.0,
      }),
    }
  }

  for day in &mut days {
    day.volume = volume_of(day.sets.iter());
    day.heaviest = heaviest_of(day.sets.iter());
  }

  days
}

fn volume_of<'a>(sets: impl Iterator<Item = &'a ExerciseSet>) -> f64 {
  sets.map(|set| set.reps as f64 * set.weight).sum()
}

fn heaviest_of<'a>(sets: impl Iterator<Item = &'a ExerciseSet>) -> f64 {
  sets.map(|set| set.weight).fold(f64::NEG_INFINITY, f64::max)
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
///
/// C'est la lecture que Vue garde (`compareSetToGhost`) : celle-ci en est la
/// référence, tenue d'accord par la fixture.
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
  let mut records = Vec::new();
  let mut heaviest = f64::NEG_INFINITY;

  for set in newest_first(sets.iter().filter(|set| is_working_set(set)))
    .into_iter()
    .rev()
  {
    if set.is_deload || set.weight <= heaviest {
      continue;
    }

    heaviest = set.weight;
    records.push(set.clone());
  }

  records
}

fn record_candidate(sets: &[ExerciseSet], set_id: i64) -> Option<&ExerciseSet> {
  sets
    .iter()
    .find(|set| set.id == set_id)
    .filter(|set| is_working_set(set) && !set.is_deload)
}

/// La série bat toute autre charge de travail de l'historique — y compris
/// celles qui la suivent, et celles d'une décharge.
pub fn is_new_record(sets: &[ExerciseSet], set_id: i64) -> bool {
  let Some(target) = record_candidate(sets, set_id) else {
    return false;
  };

  sets
    .iter()
    .filter(|set| is_working_set(set))
    .all(|set| set.id == target.id || set.weight < target.weight)
}

/// Un record à cible de répétitions : cette charge n'avait jamais été tenue
/// pour autant de répétitions. `is_new_record` ne compte que la charge ; 8 × 80
/// après 6 × 80 n'y est pas un record, alors que c'en est un pour n'importe
/// quel coach (#95).
pub fn is_new_record_for_reps(sets: &[ExerciseSet], set_id: i64) -> bool {
  let Some(target) = record_candidate(sets, set_id) else {
    return false;
  };

  sets.iter().filter(|set| is_working_set(set)).all(|set| {
    set.id == target.id || set.is_deload || set.weight < target.weight || set.reps < target.reps
  })
}

/// Le 1RM estimé par la formule d'Epley : charge × (1 + reps ÷ 30). Une seule
/// répétition rend la charge elle-même — la formule brute donnerait 103 % d'un
/// vrai 1RM, et estimer à partir de la chose mesurée doit rendre la chose
/// mesurée (#95).
pub fn estimate_one_rep_max(reps: i64, weight: f64) -> f64 {
  if reps <= 1 {
    weight
  } else {
    weight * (1.0 + reps as f64 / 30.0)
  }
}

/// Le meilleur 1RM estimé de l'historique de travail ; `None` s'il n'y en a pas.
pub fn best_estimated_one_rep_max(sets: &[ExerciseSet]) -> Option<f64> {
  sets
    .iter()
    .filter(|set| is_working_set(set))
    .map(|set| estimate_one_rep_max(set.reps, set.weight))
    .reduce(f64::max)
}

/// Au-delà de deux semaines sans un exercice, la force a baissé (#95).
pub const RETURN_BREAK_DAYS: i64 = 14;
const RETURN_LOAD_RATIO: f64 = 0.9;

/// Jours écoulés depuis la dernière séance de travail ; `None` sur un exercice
/// jamais fait — il n'y a pas d'arrêt sans reprise.
pub fn days_since_last_session(sessions: &[TrainingSession], today: &str) -> Option<i64> {
  let latest = sessions.first()?;

  Some((days_from_civil(today) - days_from_civil(&latest.key)).max(0))
}

/// Après deux semaines d'arrêt, le fantôme propose pourtant la charge d'avant :
/// on suggère −10 %, au demi-kilo — la marche des disques. Une proposition,
/// jamais un pré-remplissage.
pub fn suggest_return_load(weight: f64, days_away: Option<i64>) -> Option<f64> {
  match days_away {
    Some(days) if days >= RETURN_BREAK_DAYS => Some((weight * RETURN_LOAD_RATIO * 2.0).round() / 2.0),
    _ => None,
  }
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

/// Le volume des séries de travail par semaine, de la plus ancienne à la plus
/// récente, avec le détail par journée pour les semaines à plusieurs séances.
pub fn weekly_volumes<'a>(sets: impl Iterator<Item = &'a ExerciseSet>) -> Vec<WeeklyVolume> {
  let mut weeks: Vec<WeeklyVolume> = Vec::new();

  for set in sets.filter(|set| is_working_set(set)) {
    let key = date_key(&set.completed_at);
    let week = week_start(key);
    let volume = set.reps as f64 * set.weight;

    let entry = match weeks.iter_mut().find(|entry| entry.week == week) {
      Some(entry) => entry,
      None => {
        weeks.push(WeeklyVolume {
          week,
          volume: 0.0,
          days: Vec::new(),
        });
        weeks.last_mut().expect("la semaine vient d'être ajoutée")
      }
    };

    match entry.days.iter_mut().find(|day| day.key == key) {
      Some(day) => day.volume += volume,
      None => entry.days.push(DayVolume {
        key: key.to_string(),
        volume,
      }),
    }
  }

  weeks.sort_by(|first, second| first.week.cmp(&second.week));

  for entry in &mut weeks {
    entry.days.sort_by(|first, second| first.key.cmp(&second.key));
    entry.volume = entry.days.iter().map(|day| day.volume).sum();
  }

  weeks
}

/// L'instantané d'un exercice : tout ce que le tracker lit, d'un seul appel.
pub fn exercise_snapshot(exercise: &Exercise, today: &str) -> ExerciseSnapshot {
  let sets = &exercise.sets;
  let sessions = group_into_sessions(sets);
  let ghost = positional_ghost(&sessions, today);
  let target = suggested_target(
    ghost.as_ref(),
    Target {
      weight: exercise.default_weight,
      reps: exercise.default_reps,
    },
  );
  let reference = ghost
    .as_ref()
    .and_then(|ghost| sessions.iter().find(|session| session.key == ghost.session_key));
  let latest_set = sessions.first().and_then(|session| session.sets.first());
  let days_away = days_since_last_session(&sessions, today);

  ExerciseSnapshot {
    today: today.to_string(),
    warmups: group_warmups(sets),
    rest_seconds: rest_after_set(
      exercise.rest_seconds,
      ghost.as_ref().map(|ghost| ghost.position),
      reference,
    ),
    is_stagnant: is_exercise_stagnant(&sessions),
    records: record_history(sets),
    is_latest_set_record: latest_set.is_some_and(|set| is_new_record(sets, set.id)),
    is_latest_set_reps_record: latest_set.is_some_and(|set| is_new_record_for_reps(sets, set.id)),
    one_rep_max: best_estimated_one_rep_max(sets),
    days_away,
    return_load: suggest_return_load(target.weight, days_away),
    median_rest_taken: median_rest_taken(&sessions),
    warmup_ramp: warmup_ramp(target.weight, exercise.is_dumbbell, &exercise.weight_unit),
    weekly: weekly_volumes(sets.iter()),
    ghost,
    target,
    sessions,
  }
}

// ——— La séance ———

/// Une journée où la séance a été faite, tous exercices confondus.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeanceSession {
  pub key: String,
  /// Volume des séries de travail, dans l'unité dominante de la séance.
  #[serde(with = "crate::contract::kilograms")]
  pub volume: f64,
  pub reps: i64,
  /// Exercices de la séance ayant au moins une série ce jour-là.
  pub exercises_done: i64,
}

/// Un exercice de la séance : sa dernière séance face à la précédente.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeanceExercise {
  pub slug: String,
  pub name: String,
  pub weight_unit: String,
  /// Volume le jour de la dernière séance ; 0 si l'exercice a été sauté.
  #[serde(with = "crate::contract::kilograms")]
  pub latest: f64,
  /// Volume le jour de la séance précédente ; `null` sans séance précédente.
  #[serde(with = "crate::contract::optional_kilograms")]
  pub previous: Option<f64>,
  #[serde(with = "crate::contract::optional_kilograms")]
  pub delta: Option<f64>,
  /// Hors du volume total : son unité n'est pas celle de la séance.
  pub is_other_unit: bool,
  /// Repos réglé sur le chrono, en secondes.
  pub rest_seconds: i64,
  pub median_rest_taken: Option<i64>,
  /// La série de travail la plus récente, ou `null`.
  pub last_set: Option<ExerciseSet>,
}

/// Ce qu'une lecture de l'écran de séance rend, d'un seul appel.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeanceSnapshot {
  pub weight_unit: String,
  /// De la plus récente à la plus ancienne.
  pub sessions: Vec<SeanceSession>,
  pub latest: Option<SeanceSession>,
  pub previous: Option<SeanceSession>,
  #[serde(with = "crate::contract::optional_kilograms")]
  pub volume_delta: Option<f64>,
  /// Dans l'ordre de la séance.
  pub exercises: Vec<SeanceExercise>,
  pub weekly: Vec<WeeklyVolume>,
}

/// L'unité la plus fréquente parmi les exercices : celle dans laquelle les
/// volumes de la séance sont additionnés. À égalité, la première rencontrée ;
/// sans exercice, le kilogramme.
pub fn dominant_weight_unit(exercises: &[Exercise]) -> String {
  let mut counts: Vec<(&str, usize)> = Vec::new();

  for exercise in exercises {
    match counts.iter_mut().find(|(unit, _)| *unit == exercise.weight_unit) {
      Some((_, count)) => *count += 1,
      None => counts.push((&exercise.weight_unit, 1)),
    }
  }

  let mut dominant = "kg";
  let mut highest = 0;

  for (unit, count) in counts {
    if count > highest {
      dominant = unit;
      highest = count;
    }
  }

  dominant.to_string()
}

/// La série de travail la plus récente ; à égalité d'instant, la première.
pub fn most_recent_set(sets: &[ExerciseSet]) -> Option<&ExerciseSet> {
  let mut latest: Option<&ExerciseSet> = None;

  for set in sets.iter().filter(|set| is_working_set(set)) {
    if latest.is_none_or(|current| set.completed_at > current.completed_at) {
      latest = Some(set);
    }
  }

  latest
}

/// Le bilan d'une séance se lit à l'échelle de la journée : une « séance »
/// est un jour où l'un de ses exercices a été travaillé, et chaque exercice
/// se mesure ce jour-là face au jour de la séance précédente. Un exercice
/// sauté vaut zéro — c'est une information, pas une absence.
pub fn seance_snapshot(seance: &Seance) -> SeanceSnapshot {
  struct Day {
    key: String,
    volume: f64,
    reps: i64,
    exercises: Vec<String>,
  }

  let weight_unit = dominant_weight_unit(&seance.exercises);
  let mut dominant_sets: Vec<&ExerciseSet> = Vec::new();
  let mut days: Vec<Day> = Vec::new();
  let mut volume_by_exercise_and_day: Vec<(String, f64)> = Vec::new();

  for exercise in &seance.exercises {
    let is_other_unit = exercise.weight_unit != weight_unit;

    for set in exercise.sets.iter().filter(|set| is_working_set(set)) {
      let key = date_key(&set.completed_at);
      let volume = set.reps as f64 * set.weight;
      let per_exercise_key = format!("{}|{key}", exercise.slug);

      match volume_by_exercise_and_day
        .iter_mut()
        .find(|(candidate, _)| *candidate == per_exercise_key)
      {
        Some((_, total)) => *total += volume,
        None => volume_by_exercise_and_day.push((per_exercise_key, volume)),
      }

      let day = match days.iter_mut().position(|day| day.key == key) {
        Some(index) => &mut days[index],
        None => {
          days.push(Day {
            key: key.to_string(),
            volume: 0.0,
            reps: 0,
            exercises: Vec::new(),
          });
          days.last_mut().expect("la journée vient d'être ajoutée")
        }
      };

      if !day.exercises.contains(&exercise.slug) {
        day.exercises.push(exercise.slug.clone());
      }

      if !is_other_unit {
        day.volume += volume;
        day.reps += set.reps;
        dominant_sets.push(set);
      }
    }
  }

  let mut sessions: Vec<SeanceSession> = days
    .iter()
    .map(|day| SeanceSession {
      key: day.key.clone(),
      volume: day.volume,
      reps: day.reps,
      exercises_done: day.exercises.len() as i64,
    })
    .collect();
  sessions.sort_by(|first, second| second.key.cmp(&first.key));

  let latest = sessions.first().cloned();
  let previous = sessions.get(1).cloned();

  let volume_on = |slug: &str, session: &SeanceSession| -> f64 {
    let key = format!("{slug}|{}", session.key);

    volume_by_exercise_and_day
      .iter()
      .find(|(candidate, _)| *candidate == key)
      .map_or(0.0, |(_, volume)| *volume)
  };

  let exercises = seance
    .exercises
    .iter()
    .map(|exercise| {
      let latest_volume = latest
        .as_ref()
        .map_or(0.0, |session| volume_on(&exercise.slug, session));
      let previous_volume = previous
        .as_ref()
        .map(|session| volume_on(&exercise.slug, session));

      SeanceExercise {
        slug: exercise.slug.clone(),
        name: exercise.name.clone(),
        weight_unit: exercise.weight_unit.clone(),
        latest: latest_volume,
        previous: previous_volume,
        delta: previous_volume.map(|previous| latest_volume - previous),
        is_other_unit: exercise.weight_unit != weight_unit,
        rest_seconds: exercise.rest_seconds,
        median_rest_taken: median_rest_taken(&group_into_sessions(&exercise.sets)),
        last_set: most_recent_set(&exercise.sets).cloned(),
      }
    })
    .collect();

  SeanceSnapshot {
    weight_unit,
    volume_delta: match (&latest, &previous) {
      (Some(latest), Some(previous)) => Some(latest.volume - previous.volume),
      _ => None,
    },
    sessions,
    latest,
    previous,
    exercises,
    weekly: weekly_volumes(dominant_sets.into_iter()),
  }
}

// ——— Le dashboard ———

/// Un exercice qui stagne, tel que le dashboard l'annonce.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagnantExercise {
  pub seance_slug: String,
  pub seance_name: String,
  pub exercise_slug: String,
  pub exercise_name: String,
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
pub fn dashboard_snapshot(seances: &[Seance], today: &str) -> DashboardSnapshot {
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

  DashboardSnapshot {
    stagnant,
    training_days: training_days.len() as i64,
    working_sets: recent.len() as i64,
    lifted_volume: volume_of(recent.iter().copied()).round(),
    heaviest_weight: recent
      .iter()
      .map(|set| set.weight)
      .fold(0.0, f64::max),
    last_set_at: recent
      .iter()
      .map(|set| set.completed_at.clone())
      .max(),
    weekly: weekly_volumes(all_working.into_iter()),
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
  use serde_json::Value;

  /// Le fichier de référence partagé avec TypeScript, produit par
  /// `src/lib/__tests__/insightsFixture.spec.ts`. Pour chaque historique, il
  /// porte l'instantané **complet** que l'adaptateur navigateur rend ; on
  /// exige ici le même JSON, champ pour champ. C'est ce qui rend la copie
  /// TypeScript falsifiable : une règle qui diverge d'un côté fait tomber un
  /// test de l'autre, au lieu de donner au mode navigateur une autre lecture
  /// de la progression que celle de l'app.
  const CASES: &str = include_str!("../../fixtures/insights-cases.json");

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct Cases {
    exercises: Vec<ExerciseCase>,
    seances: Vec<SeanceCase>,
    dashboards: Vec<DashboardCase>,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct ExerciseCase {
    name: String,
    today: String,
    default_reps: i64,
    default_weight: f64,
    weight_unit: String,
    rest_seconds: i64,
    is_dumbbell: bool,
    sets: Vec<ExerciseSet>,
    snapshot: Value,
    verdict_against_ghost: Option<Value>,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct SeanceCase {
    name: String,
    seance: FixtureSeance,
    snapshot: Value,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct DashboardCase {
    name: String,
    today: String,
    seances: Vec<FixtureSeance>,
    snapshot: Value,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct FixtureSeance {
    slug: String,
    name: String,
    exercises: Vec<FixtureExercise>,
  }

  #[derive(Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct FixtureExercise {
    slug: String,
    name: String,
    default_reps: i64,
    default_weight: f64,
    weight_unit: String,
    rest_seconds: i64,
    is_dumbbell: bool,
    sets: Vec<ExerciseSet>,
  }

  impl FixtureSeance {
    fn to_seance(&self) -> Seance {
      Seance {
        slug: self.slug.clone(),
        name: self.name.clone(),
        is_demo: false,
        exercises: self
          .exercises
          .iter()
          .map(|exercise| Exercise {
            slug: exercise.slug.clone(),
            name: exercise.name.clone(),
            default_reps: exercise.default_reps,
            default_weight: exercise.default_weight,
            weight_unit: exercise.weight_unit.clone(),
            rest_seconds: exercise.rest_seconds,
            is_dumbbell: exercise.is_dumbbell,
            notes: String::new(),
            sets: exercise.sets.clone(),
          })
          .collect(),
      }
    }
  }

  fn cases() -> Cases {
    serde_json::from_str(CASES).expect("la fixture des règles doit se désérialiser")
  }

  fn to_json<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("un instantané se sérialise")
  }

  /// Un écart se lit mieux champ par champ que sur deux documents entiers.
  fn assert_same_json(name: &str, actual: &Value, expected: &Value) {
    if let (Value::Object(actual), Value::Object(expected)) = (actual, expected) {
      for (field, expected_value) in expected {
        let actual_value = actual.get(field).unwrap_or(&Value::Null);
        assert_eq!(actual_value, expected_value, "{name} : champ « {field} »");
      }

      assert_eq!(
        actual.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>(),
        "{name} : les champs de l'instantané"
      );

      return;
    }

    assert_eq!(actual, expected, "{name}");
  }

  #[test]
  fn every_exercise_snapshot_agrees_with_the_typescript_reference() {
    let cases = cases();
    assert!(!cases.exercises.is_empty());

    for case in cases.exercises {
      let exercise = Exercise {
        slug: "exercice".to_string(),
        name: "Exercice".to_string(),
        default_reps: case.default_reps,
        default_weight: case.default_weight,
        weight_unit: case.weight_unit.clone(),
        rest_seconds: case.rest_seconds,
        is_dumbbell: case.is_dumbbell,
        notes: String::new(),
        sets: case.sets.clone(),
      };
      let snapshot = exercise_snapshot(&exercise, &case.today);

      assert_same_json(&case.name, &to_json(&snapshot), &case.snapshot);

      // Le verdict reste calculé dans Vue : sa référence est ici.
      let verdict = match (&snapshot.ghost, case.sets.first()) {
        (Some(ghost), Some(first)) => Some(to_json(&compare_to_ghost(
          (first.reps, first.weight),
          (ghost.set.reps, ghost.set.weight),
        ))),
        _ => None,
      };
      assert_eq!(
        verdict,
        case.verdict_against_ghost,
        "{} : verdict face au fantôme",
        case.name
      );
    }
  }

  #[test]
  fn every_seance_snapshot_agrees_with_the_typescript_reference() {
    let cases = cases();
    assert!(!cases.seances.is_empty());

    for case in cases.seances {
      let snapshot = seance_snapshot(&case.seance.to_seance());

      assert_same_json(&case.name, &to_json(&snapshot), &case.snapshot);
    }
  }

  #[test]
  fn every_dashboard_snapshot_agrees_with_the_typescript_reference() {
    let cases = cases();
    assert!(!cases.dashboards.is_empty());

    for case in cases.dashboards {
      let seances: Vec<Seance> = case.seances.iter().map(FixtureSeance::to_seance).collect();
      let snapshot = dashboard_snapshot(&seances, &case.today);

      assert_same_json(&case.name, &to_json(&snapshot), &case.snapshot);
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

  #[test]
  fn a_single_repetition_estimates_its_own_load() {
    assert_eq!(estimate_one_rep_max(1, 100.0), 100.0);
    assert_eq!(estimate_one_rep_max(5, 90.0), 105.0);
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
