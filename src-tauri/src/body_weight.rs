//! Le poids de corps de l'utilisateur : une pesée par jour calendaire, en
//! kilogrammes, saisie à la main dans l'app.
//!
//! Le jour est celui du pèse-personne — le jour local de la pesée, tel que
//! l'appareil l'a noté. Il ne rejoint pas la journée d'entraînement (jour
//! UTC) : les deux ne se comparent qu'à l'échelle où un décalage d'un jour
//! ne change rien (tendance, moyenne).
//!
//! Une nouvelle pesée du même jour remplace l'ancienne : la dernière lecture
//! fait foi, comme sur le pèse-personne.

use crate::contract::{codes, AppError};

/// Une pesée sur le fil : camelCase, tous champs explicites.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BodyWeight {
  /// Jour calendaire de la pesée, `AAAA-MM-JJ`.
  pub day: String,
  /// Poids en kilogrammes, au dixième près (la marche d'un pèse-personne).
  #[serde(with = "crate::contract::kilograms")]
  pub kilograms: f64,
}

/// Toutes les pesées, de la plus récente à la plus ancienne — l'ordre
/// d'affichage, comme les séries.
pub fn list(connection: &rusqlite::Connection) -> Result<Vec<BodyWeight>, AppError> {
  let mut stmt = connection
    .prepare("SELECT day, kilograms FROM body_weights ORDER BY day DESC")
    .map_err(AppError::storage)?;

  let weights = stmt
    .query_map([], |row| {
      Ok(BodyWeight {
        day: row.get(0)?,
        kilograms: row.get(1)?,
      })
    })
    .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
    .map_err(AppError::storage)?;

  Ok(weights)
}

/// Enregistre (ou remplace) la pesée du jour donné, et rend l'état complet :
/// le store est une projection, il ne calcule rien.
pub fn log(
  connection: &rusqlite::Connection,
  day: &str,
  kilograms: f64,
) -> Result<Vec<BodyWeight>, AppError> {
  validate(day, kilograms)?;

  connection
    .execute(
      "INSERT INTO body_weights (day, kilograms) VALUES (?1, ?2)
       ON CONFLICT(day) DO UPDATE SET kilograms = excluded.kilograms",
      rusqlite::params![day, kilograms],
    )
    .map_err(AppError::storage)?;

  list(connection)
}

/// Remplace toutes les pesées par celles d'une sauvegarde restaurée (#70).
///
/// Un remplacement intégral, jamais une fusion : la restauration n'a lieu que
/// sur une app sans données, il n'y a rien à arbitrer. Tout est validé avant
/// la première écriture — un fichier douteux ne doit pas entamer la base.
pub fn import(
  connection: &mut rusqlite::Connection,
  weights: &[BodyWeight],
) -> Result<Vec<BodyWeight>, AppError> {
  let mut seen = std::collections::HashSet::new();

  for weight in weights {
    validate(&weight.day, weight.kilograms)?;

    if !seen.insert(weight.day.as_str()) {
      return Err(AppError::new(
        codes::DATE_INVALIDE,
        format!("Deux pesées portent le jour {} : il est unique.", weight.day),
      ));
    }
  }

  // Vider puis repeupler dans une vraie transaction : un échec en route rend
  // la base intacte, jamais une restauration à moitié faite.
  let transaction = connection.transaction().map_err(AppError::storage)?;

  transaction
    .execute("DELETE FROM body_weights", [])
    .map_err(AppError::storage)?;

  for weight in weights {
    transaction
      .execute(
        "INSERT INTO body_weights (day, kilograms) VALUES (?1, ?2)",
        rusqlite::params![weight.day, weight.kilograms],
      )
      .map_err(AppError::storage)?;
  }

  transaction.commit().map_err(AppError::storage)?;

  list(connection)
}

/// Supprime la pesée d'un jour. Supprimer un jour vide n'est pas une erreur :
/// l'intention — ce jour n'a pas de pesée — est déjà satisfaite.
pub fn delete(connection: &rusqlite::Connection, day: &str) -> Result<Vec<BodyWeight>, AppError> {
  connection
    .execute("DELETE FROM body_weights WHERE day = ?1", [day])
    .map_err(AppError::storage)?;

  list(connection)
}

fn validate(day: &str, kilograms: f64) -> Result<(), AppError> {
  if !is_calendar_day(day) {
    return Err(AppError::new(
      codes::DATE_INVALIDE,
      format!("Pesée : « {day} » n'est pas un jour calendaire (AAAA-MM-JJ)."),
    ));
  }

  // Le dixième de kilogramme est la marche d'un pèse-personne ; les bornes
  // écartent la faute de frappe (7 kg pour 70) sans juger personne.
  let tenths = kilograms * 10.0;
  if !kilograms.is_finite() || tenths.fract() != 0.0 || !(20.0..=400.0).contains(&kilograms) {
    return Err(AppError::new(
      codes::POIDS_CORPS_INVALIDE,
      format!(
        "Pesée du {day} : le poids s'écrit en kilogrammes, au dixième près, entre 20 et 400."
      ),
    ));
  }

  Ok(())
}

/// `AAAA-MM-JJ`, jour réel du calendrier — le préfixe exact d'un horodatage
/// canonique, revérifié par le même chemin.
fn is_calendar_day(value: &str) -> bool {
  value.len() == 10
    && crate::contract::is_canonical_utc_timestamp(&format!("{value}T00:00:00.000Z"))
}

#[cfg(test)]
mod tests {
  use super::*;
  use rusqlite::Connection;

  fn connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn
      .execute_batch(crate::BODY_WEIGHT_MIGRATION_SQL)
      .unwrap();
    conn
  }

  fn entry(day: &str, kilograms: f64) -> BodyWeight {
    BodyWeight {
      day: day.to_string(),
      kilograms,
    }
  }

  #[test]
  fn logging_upserts_the_day_and_returns_newest_first() {
    let conn = connection();

    log(&conn, "2026-08-30", 74.8).unwrap();
    log(&conn, "2026-09-01", 74.2).unwrap();
    let state = log(&conn, "2026-08-30", 75.1).unwrap();

    assert_eq!(
      state,
      vec![entry("2026-09-01", 74.2), entry("2026-08-30", 75.1)]
    );
  }

  #[test]
  fn deleting_a_day_is_idempotent() {
    let conn = connection();
    log(&conn, "2026-09-01", 74.2).unwrap();

    assert_eq!(delete(&conn, "2026-09-01").unwrap(), vec![]);
    assert_eq!(delete(&conn, "2026-09-01").unwrap(), vec![]);
  }

  #[test]
  fn weights_stay_on_the_tenth_between_20_and_400() {
    let conn = connection();

    for bad in [74.25, 19.9, 400.1, 0.0, -70.0, f64::NAN] {
      let error = log(&conn, "2026-09-01", bad).unwrap_err();
      assert_eq!(
        error.code,
        codes::POIDS_CORPS_INVALIDE,
        "poids refusé : {bad}"
      );
    }

    for good in [20.0, 74.2, 400.0] {
      assert!(
        log(&conn, "2026-09-01", good).is_ok(),
        "poids accepté : {good}"
      );
    }
  }

  #[test]
  fn days_must_be_real_calendar_days() {
    let conn = connection();

    for bad in [
      "",
      "2026-8-1",
      "2026-02-30",
      "2026-08-31T00:00:00.000Z",
      "31-08-2026",
    ] {
      let error = log(&conn, bad, 74.2).unwrap_err();
      assert_eq!(error.code, codes::DATE_INVALIDE, "jour refusé : {bad:?}");
    }
  }

  #[test]
  fn importing_replaces_every_weight_and_returns_newest_first() {
    let mut conn = connection();
    log(&conn, "2026-07-01", 80.0).unwrap();

    let state = import(
      &mut conn,
      &[entry("2026-08-30", 75.1), entry("2026-09-01", 74.2)],
    )
    .unwrap();

    assert_eq!(
      state,
      vec![entry("2026-09-01", 74.2), entry("2026-08-30", 75.1)]
    );
  }

  #[test]
  fn an_invalid_weight_leaves_the_previous_ones_untouched() {
    let mut conn = connection();
    log(&conn, "2026-07-01", 80.0).unwrap();

    let error = import(
      &mut conn,
      &[entry("2026-08-30", 75.1), entry("2026-09-01", 400.1)],
    )
    .unwrap_err();

    assert_eq!(error.code, codes::POIDS_CORPS_INVALIDE);
    assert_eq!(list(&conn).unwrap(), vec![entry("2026-07-01", 80.0)]);
  }

  #[test]
  fn importing_the_same_day_twice_is_refused() {
    let mut conn = connection();

    let error = import(
      &mut conn,
      &[entry("2026-09-01", 74.2), entry("2026-09-01", 75.0)],
    )
    .unwrap_err();

    assert_eq!(error.code, codes::DATE_INVALIDE);
    assert_eq!(list(&conn).unwrap(), vec![]);
  }

  /// Le remplacement vide la table avant de la repeupler : si une écriture
  /// échoue en route, la restauration doit rendre la base intacte, pas vide.
  /// Le déclencheur fait échouer la seconde insertion, comme le ferait une
  /// panne de stockage.
  #[test]
  fn a_failure_mid_write_leaves_the_previous_weights_in_place() {
    let mut conn = connection();
    log(&conn, "2026-07-01", 80.0).unwrap();
    conn
      .execute_batch(
        "CREATE TRIGGER refuse AFTER INSERT ON body_weights
         WHEN NEW.day = '2026-09-02'
         BEGIN SELECT RAISE(ABORT, 'stockage indisponible'); END;",
      )
      .unwrap();

    let error = import(
      &mut conn,
      &[entry("2026-08-30", 75.1), entry("2026-09-02", 74.2)],
    )
    .unwrap_err();

    assert_eq!(error.code, codes::STOCKAGE_INDISPONIBLE);
    assert_eq!(list(&conn).unwrap(), vec![entry("2026-07-01", 80.0)]);
  }

  #[test]
  fn importing_nothing_empties_the_table() {
    let mut conn = connection();
    log(&conn, "2026-07-01", 80.0).unwrap();

    assert_eq!(import(&mut conn, &[]).unwrap(), vec![]);
  }

  #[test]
  fn the_wire_form_is_camel_case_with_bare_integers() {
    let json = serde_json::to_value(entry("2026-09-01", 75.0)).unwrap();

    assert_eq!(
      json,
      serde_json::json!({ "day": "2026-09-01", "kilograms": 75 })
    );
  }
}
