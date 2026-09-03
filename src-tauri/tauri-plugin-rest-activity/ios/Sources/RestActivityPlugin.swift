import ActivityKit
import Foundation
import Tauri
import UIKit
import WebKit

struct StartArgs: Decodable {
  let exerciseName: String
  let target: String
  // Epoch en millisecondes : pas de chaîne de date, pas de fuseau à parser —
  // la leçon de tauri-apps/plugins-workspace#3256.
  let endsAtEpochMs: Double
}

struct UpdateArgs: Decodable {
  let endsAtEpochMs: Double
}

// Le porteur de l'activité en cours, isolé derrière une disponibilité :
// ActivityKit n'existe qu'à partir d'iOS 16.1, l'app vise 15.0.
@available(iOS 16.2, *)
final class RestActivityHolder {
  static let shared = RestActivityHolder()
  var activity: Activity<RestActivityAttributes>?

  func start(exerciseName: String, target: String, endsAt: Date) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      return
    }

    // Un seul repos à la fois : la nouvelle activité remplace l'ancienne.
    end()

    let attributes = RestActivityAttributes(exerciseName: exerciseName, target: target)
    let content = ActivityContent(
      state: RestActivityAttributes.ContentState(endsAt: endsAt),
      // Passé l'échéance, l'activité n'a plus rien à dire : le système peut
      // la ranger de lui-même si l'app ne l'a pas déjà fait.
      staleDate: endsAt.addingTimeInterval(30)
    )

    activity = try? Activity.request(attributes: attributes, content: content)
  }

  func update(endsAt: Date) {
    guard let activity else { return }

    let content = ActivityContent(
      state: RestActivityAttributes.ContentState(endsAt: endsAt),
      staleDate: endsAt.addingTimeInterval(30)
    )

    Task {
      await activity.update(content)
    }
  }

  func end() {
    guard let current = activity else { return }
    activity = nil

    let content = ActivityContent(
      state: RestActivityAttributes.ContentState(endsAt: Date()),
      staleDate: nil
    )

    Task {
      await current.end(content, dismissalPolicy: .immediate)
    }
  }
}

class RestActivityPlugin: Plugin {
  @objc func startActivity(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(StartArgs.self)

    if #available(iOS 16.2, *) {
      let endsAt = Date(timeIntervalSince1970: args.endsAtEpochMs / 1000.0)
      DispatchQueue.main.async {
        RestActivityHolder.shared.start(
          exerciseName: args.exerciseName, target: args.target, endsAt: endsAt)
      }
    }

    // Avant iOS 16.2 : pas d'activité, pas d'erreur — la notification de fin
    // de repos couvre déjà l'écran verrouillé.
    invoke.resolve()
  }

  @objc func updateActivity(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(UpdateArgs.self)

    if #available(iOS 16.2, *) {
      let endsAt = Date(timeIntervalSince1970: args.endsAtEpochMs / 1000.0)
      DispatchQueue.main.async {
        RestActivityHolder.shared.update(endsAt: endsAt)
      }
    }

    invoke.resolve()
  }

  @objc func endActivity(_ invoke: Invoke) {
    if #available(iOS 16.2, *) {
      DispatchQueue.main.async {
        RestActivityHolder.shared.end()
      }
    }

    invoke.resolve()
  }
}

@_cdecl("init_plugin_rest_activity")
func initPlugin() -> Plugin {
  return RestActivityPlugin()
}
