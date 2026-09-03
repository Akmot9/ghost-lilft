import ActivityKit
import Foundation

// La forme partagée entre l'app (qui démarre l'activité) et l'extension
// widget (qui la dessine). ActivityKit apparie les deux processus sur ce
// type : il doit être identique des deux côtés — la CI copie CE fichier
// dans la cible de l'extension, il n'existe qu'ici.
@available(iOS 16.2, *)
struct RestActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // L'échéance du repos : le système dessine le décompte lui-même
    // (Text(timerInterval:)), l'app n'a rien à rafraîchir.
    var endsAt: Date
  }

  // Ce qui ne change pas pendant le repos.
  var exerciseName: String
  // La cible de la prochaine série (« 6 × 92 kg »), le fantôme à battre.
  var target: String
}
