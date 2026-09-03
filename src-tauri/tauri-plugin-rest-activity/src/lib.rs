//! La Live Activity du repos : pendant qu'un repos court, iOS affiche un
//! chrono vivant sur l'écran verrouillé et dans le Dynamic Island — rendu
//! par le système, sans réveiller l'app.
//!
//! Plugin interne à Revenant, iOS seulement : ActivityKit n'existe que là.
//! Partout ailleurs (desktop, Android), chaque commande est un no-op qui
//! réussit — le minuteur à l'écran reste la source de vérité, l'activité
//! n'est qu'un reflet.
//!
//! Les échéances voyagent en **millisecondes epoch**, jamais en chaînes :
//! le bug de fuseau du plugin de notifications (tauri-apps/plugins-workspace
//! #3256) est exactement le genre d'accident que ce choix rend impossible.

use serde::Serialize;
use tauri::{
  plugin::{Builder, TauriPlugin},
  Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_rest_activity);

#[cfg(target_os = "ios")]
struct RestActivity<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartPayload {
  exercise_name: String,
  target: String,
  ends_at_epoch_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePayload {
  ends_at_epoch_ms: f64,
}

#[tauri::command]
async fn start_activity<R: Runtime>(
  app: tauri::AppHandle<R>,
  exercise_name: String,
  target: String,
  ends_at_epoch_ms: f64,
) -> Result<(), String> {
  #[cfg(target_os = "ios")]
  {
    use tauri::Manager;
    let state = app.state::<RestActivity<R>>();
    return state
      .0
      .run_mobile_plugin::<()>(
        "startActivity",
        StartPayload {
          exercise_name,
          target,
          ends_at_epoch_ms,
        },
      )
      .map_err(|error| error.to_string());
  }

  #[cfg(not(target_os = "ios"))]
  {
    let _ = (app, exercise_name, target, ends_at_epoch_ms);
    Ok(())
  }
}

#[tauri::command]
async fn update_activity<R: Runtime>(
  app: tauri::AppHandle<R>,
  ends_at_epoch_ms: f64,
) -> Result<(), String> {
  #[cfg(target_os = "ios")]
  {
    use tauri::Manager;
    let state = app.state::<RestActivity<R>>();
    return state
      .0
      .run_mobile_plugin::<()>("updateActivity", UpdatePayload { ends_at_epoch_ms })
      .map_err(|error| error.to_string());
  }

  #[cfg(not(target_os = "ios"))]
  {
    let _ = (app, ends_at_epoch_ms);
    Ok(())
  }
}

#[tauri::command]
async fn end_activity<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
  #[cfg(target_os = "ios")]
  {
    use tauri::Manager;
    let state = app.state::<RestActivity<R>>();
    return state
      .0
      .run_mobile_plugin::<()>("endActivity", ())
      .map_err(|error| error.to_string());
  }

  #[cfg(not(target_os = "ios"))]
  {
    let _ = app;
    Ok(())
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("rest-activity")
    .invoke_handler(tauri::generate_handler![
      start_activity,
      update_activity,
      end_activity
    ])
    .setup(|_app, _api| {
      #[cfg(target_os = "ios")]
      {
        use tauri::Manager;
        let handle = _api.register_ios_plugin(init_plugin_rest_activity)?;
        _app.manage(RestActivity(handle));
      }
      Ok(())
    })
    .build()
}
