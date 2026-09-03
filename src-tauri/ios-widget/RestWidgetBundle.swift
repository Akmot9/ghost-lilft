import ActivityKit
import SwiftUI
import WidgetKit

// L'extension qui dessine la Live Activity du repos. Elle ne calcule rien :
// le décompte (Text(timerInterval:)) et la barre de progression
// (ProgressView(timerInterval:)) sont rendus par le système, seconde par
// seconde, sans réveiller personne.
//
// `RestActivityAttributes` est copié ici par la CI depuis le plugin
// (ios/Sources/RestActivityAttributes.swift) : ActivityKit apparie l'app et
// l'extension sur ce type, il doit être identique des deux côtés.

@main
struct RestWidgetBundle: WidgetBundle {
  var body: some Widget {
    RestActivityWidget()
  }
}

struct RestActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RestActivityAttributes.self) { context in
      // ——— Écran verrouillé ———
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Label("Repos", systemImage: "timer")
            .font(.caption.weight(.bold))
            .foregroundStyle(.secondary)
          Spacer()
          Text(context.attributes.exerciseName)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
        }

        HStack(alignment: .firstTextBaseline) {
          Text(timerInterval: Date.now...max(Date.now, context.state.endsAt), countsDown: true)
            .font(.system(size: 40, weight: .bold, design: .rounded))
            .monospacedDigit()
          Spacer()
          VStack(alignment: .trailing, spacing: 2) {
            Text("Prochaine série")
              .font(.caption2)
              .foregroundStyle(.secondary)
            Text(context.attributes.target)
              .font(.callout.weight(.bold))
          }
        }

        ProgressView(timerInterval: Date.now...max(Date.now, context.state.endsAt))
          .progressViewStyle(.linear)
          .labelsHidden()
          .tint(.orange)
      }
      .padding(14)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label("Repos", systemImage: "timer")
            .font(.caption.weight(.bold))
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.attributes.target)
            .font(.caption.weight(.bold))
        }
        DynamicIslandExpandedRegion(.center) {
          Text(timerInterval: Date.now...max(Date.now, context.state.endsAt), countsDown: true)
            .font(.title2.weight(.bold))
            .monospacedDigit()
            .multilineTextAlignment(.center)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.attributes.exerciseName)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      } compactLeading: {
        Image(systemName: "timer")
      } compactTrailing: {
        Text(timerInterval: Date.now...max(Date.now, context.state.endsAt), countsDown: true)
          .monospacedDigit()
          .frame(maxWidth: 44)
      } minimal: {
        Image(systemName: "timer")
      }
    }
  }
}
