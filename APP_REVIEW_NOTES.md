# App Review Information — Ghost Lift (iOS)

Réponse au rejet **Guideline 2.1 — Information Needed** (soumission
`9fd92689-3f3b-4af9-a227-3d6f540ca619`, 15 août 2026).

Deux versions de la même note : la **version EN** est celle à coller dans
App Store Connect → *App Review Information* → **Notes** (langue de l'équipe
App Review) ; la **version FR** est la même note, pour ta relecture et tes
archives.

Vérifié contre le code au 15 août 2026 : aucune requête réseau, aucun compte,
aucun achat intégré, aucune permission système demandée, base SQLite locale
(`@tauri-apps/plugin-sql`).

---

# Version EN — à coller dans App Store Connect

Ghost Lift is a fully offline strength-training logbook. There is no account,
no server, no purchase, and no permission prompt. Everything below can be
reproduced by simply launching the app.

**2. Devices and OS used for testing**

- iPhone 17 Pro Max — iOS 26 (physical device, build installed through
  TestFlight)

**3. App functions and target audience**

Ghost Lift is a workout logging app for people who train with weights on
their own, without a coach. The problem it solves: when you train alone, you
don't know what you lifted last time, so you repeat the same weight for weeks
without realizing you have stopped progressing.

The app lets the user:

- define one or more training sessions (a session = a named list of exercises);
- log each set (weight, reps) directly between sets at the gym;
- see the "ghost" of the previous session for the same exercise before
  lifting, so they know what to beat;
- get an immediate verdict after each set (progress / plateau / personal
  record);
- run an automatic rest timer between sets, per exercise;
- see a weekly volume chart and plateau warnings on the dashboard.

Target audience: adults doing recreational strength training / bodybuilding.
It is a general fitness tracking tool, not a medical or health-diagnosis app.

**4. Setup and access instructions**

No login is required and no demo account is needed — there is no user account
system in the app at all.

On first launch the app is preloaded with a sample program (three sessions:
"Upper A", "Lower", "Upper B") including sample set history, so every feature
is immediately reachable without any data entry. A banner lets the user either
adopt this program (keeps the exercises, clears the sample history) or delete
the sample data and create their own session.

To reach the core features:

1. Launch the app. The session list is shown ("Upper A" / "Lower" / "Upper B").
2. Tap a session to see its exercises.
3. Tap an exercise (for example "Développé couché" in "Upper B") to open the
   logging screen: the target suggested from the previous session is displayed,
   enter weight and reps, then validate the set. The rest timer starts
   automatically and the next set is pre-filled.
4. Use the top bar (always visible) to go back to the session list at any time.
5. Open "Dashboard" from the top bar to see the weekly volume chart and the
   plateau warnings.
6. To create your own content: "New session" from the session list, then
   "Add exercise" inside a session.

Note: the user interface is in French only.

**5. External services, tools and platforms**

None. The app performs no network requests whatsoever and works entirely in
airplane mode.

- Data providers: none. All content (exercises, sets) is created by the user;
  the preloaded sample program is authored by us and bundled in the app.
- Authentication services: none (no accounts, no sign-in).
- Payment processors: none (no in-app purchases, no subscriptions, no ads).
- AI services: none.
- Analytics / attribution / tracking SDKs: none.
- Storage: a local SQLite database on the device only. Nothing is uploaded or
  shared. Deleting the app deletes all data.
- The app is built with open-source frameworks compiled into the binary
  (Tauri 2 for the native shell, Vue 3 for the interface). These are build
  dependencies, not runtime services.

Because there is no account, there are no registration, login or account
deletion flows; because there is no server or sharing feature, there is no
user-generated content visible to other users, and therefore no reporting or
blocking mechanism is applicable. The app requests no access to location,
contacts, camera, photos, health data, or App Tracking Transparency, so no
permission prompt appears.

**6. Regional differences**

None. The app behaves identically in every region and contains no
region-restricted feature or content. The interface is available in French
only, everywhere.

**7. Regulated industry / protected third-party material**

Not applicable. Ghost Lift is a general fitness logging tool. It makes no
medical claims, provides no medical or nutritional advice, does not use
HealthKit, and does not process health records. All in-app content (exercise
names, sample program, artwork) is our own; the app includes no licensed or
protected third-party material.

Privacy policy: the app collects no personal data at all; all data stays on
the device.

---

# Version FR — même note, pour relecture

Ghost Lift est un carnet d'entraînement en musculation entièrement hors ligne.
Il n'y a aucun compte, aucun serveur, aucun achat et aucune demande
d'autorisation système. Tout ce qui suit est reproductible en lançant
simplement l'app.

**2. Appareils et systèmes utilisés pour les tests**

- iPhone 17 Pro Max — iOS 26 (appareil physique, build installé via TestFlight)

**3. Fonctions de l'app et public visé**

Ghost Lift est une app de suivi de séances destinée aux personnes qui
s'entraînent en musculation seules, sans coach. Le problème résolu : quand on
s'entraîne seul, on ne sait plus ce qu'on a soulevé la fois précédente, donc on
répète le même poids pendant des semaines sans se rendre compte qu'on stagne.

L'app permet de :

- définir une ou plusieurs séances (une séance = une liste nommée d'exercices) ;
- logger chaque série (poids, répétitions) directement entre les séries, à la
  salle ;
- voir le « fantôme » de la séance précédente pour le même exercice avant de
  soulever, afin de savoir quoi viser ;
- obtenir un verdict immédiat après chaque série (progression / stagnation /
  record personnel) ;
- déclencher un chrono de repos automatique entre les séries, propre à chaque
  exercice ;
- consulter un graphe de volume hebdomadaire et des alertes de stagnation sur
  le dashboard.

Public visé : adultes pratiquant la musculation en loisir. C'est un outil de
suivi sportif généraliste, pas une app médicale ni de diagnostic de santé.

**4. Installation et accès aux fonctions principales**

Aucune connexion n'est requise et aucun compte de démonstration n'est
nécessaire : l'app ne comporte aucun système de compte utilisateur.

Au premier lancement, l'app est préchargée avec un programme d'exemple (trois
séances : « Upper A », « Lower », « Upper B ») incluant un historique de séries
d'exemple, si bien que toutes les fonctions sont immédiatement accessibles sans
aucune saisie. Une bannière permet soit d'adopter ce programme (les exercices
sont conservés, l'historique d'exemple est effacé), soit de supprimer les
données d'exemple et de créer sa propre séance.

Pour atteindre les fonctions principales :

1. Lancer l'app. La liste des séances s'affiche (« Upper A » / « Lower » /
   « Upper B »).
2. Toucher une séance pour voir ses exercices.
3. Toucher un exercice (par exemple « Développé couché » dans « Upper B ») pour
   ouvrir l'écran de saisie : la cible suggérée à partir de la séance
   précédente s'affiche, saisir le poids et les répétitions, puis valider la
   série. Le chrono de repos démarre automatiquement et la série suivante est
   pré-remplie.
4. Utiliser la barre du haut (toujours visible) pour revenir à la liste des
   séances à tout moment.
5. Ouvrir « Dashboard » depuis la barre du haut pour voir le graphe de volume
   hebdomadaire et les alertes de stagnation.
6. Pour créer son propre contenu : « Nouvelle séance » depuis la liste des
   séances, puis « Ajouter un exercice » à l'intérieur d'une séance.

Remarque : l'interface est uniquement en français.

**5. Services, outils et plateformes externes**

Aucun. L'app n'effectue absolument aucune requête réseau et fonctionne
intégralement en mode avion.

- Fournisseurs de données : aucun. Tout le contenu (exercices, séries) est créé
  par l'utilisateur ; le programme d'exemple préchargé est rédigé par nous et
  embarqué dans l'app.
- Services d'authentification : aucun (pas de compte, pas de connexion).
- Processeurs de paiement : aucun (pas d'achat intégré, pas d'abonnement, pas
  de publicité).
- Services d'IA : aucun.
- SDK d'analytics / d'attribution / de tracking : aucun.
- Stockage : une base SQLite locale, sur l'appareil uniquement. Rien n'est
  envoyé ni partagé. Supprimer l'app supprime toutes les données.
- L'app est construite avec des frameworks open source compilés dans le binaire
  (Tauri 2 pour la coque native, Vue 3 pour l'interface). Ce sont des
  dépendances de build, pas des services appelés à l'exécution.

Comme il n'y a pas de compte, il n'existe aucun flux d'inscription, de connexion
ou de suppression de compte ; comme il n'y a ni serveur ni fonction de partage,
aucun contenu utilisateur n'est visible par d'autres utilisateurs, et aucun
mécanisme de signalement ou de blocage n'est donc applicable. L'app ne demande
l'accès ni à la localisation, ni aux contacts, ni à l'appareil photo, ni aux
photos, ni aux données de santé, ni à l'App Tracking Transparency : aucune
demande d'autorisation n'apparaît.

**6. Différences régionales**

Aucune. L'app se comporte de façon identique dans toutes les régions et ne
contient aucune fonction ni aucun contenu restreint géographiquement.
L'interface est disponible en français uniquement, partout.

**7. Secteur réglementé / contenu tiers protégé**

Sans objet. Ghost Lift est un outil de suivi sportif généraliste. Il ne formule
aucune allégation médicale, ne fournit aucun conseil médical ou nutritionnel,
n'utilise pas HealthKit et ne traite aucune donnée de santé. Tout le contenu de
l'app (noms d'exercices, programme d'exemple, visuels) nous appartient ; l'app
n'inclut aucun contenu tiers sous licence ou protégé.

Politique de confidentialité : l'app ne collecte aucune donnée personnelle ;
toutes les données restent sur l'appareil.

---

## Point 1 — La vidéo, à faire toi-même

Apple exige un **enregistrement d'écran fait sur un iPhone physique**, sous la
dernière version d'iOS, qui **commence par le lancement de l'app**. Sur ton
iPhone 17 Pro Max : Réglages → Centre de contrôle → ajouter « Enregistrement
d'écran », puis enregistrer.

Déroulé à filmer (≈ 60–90 s, sans coupure) :

1. Écran d'accueil iOS, tap sur l'icône Ghost Lift (le lancement doit être
   visible).
2. Liste des séances (Upper A / Lower / Upper B) + la bannière du programme
   d'exemple.
3. Tap sur « Upper B » → liste des exercices.
4. Tap sur « Développé couché » → montrer la cible fantôme, saisir poids +
   reps, valider la série → le verdict s'affiche et le chrono de repos démarre.
5. Logger une 2ᵉ série (montre le pré-remplissage).
6. Retour à la liste via la barre du haut.
7. Dashboard : volume hebdomadaire + alerte de stagnation.
8. Créer une séance à soi : « Nouvelle séance » + ajout d'un exercice.

Rien à filmer pour compte / achat / contenu utilisateur / permissions : l'app
n'en a aucun — la note ci-dessus l'explique explicitement.

## À vérifier avant de resoumettre

- **Screenshots App Store** (guideline 2.3.3) : ils doivent montrer l'app en
  usage réel (écran de saisie, dashboard), pas le logo ni un écran de
  démarrage.
- **Numéro de version** : `src-tauri/tauri.conf.json` porte `0.1.0` alors que
  la soumission est en `1.0` — vérifier que le workflow CI force bien la
  marketing version envoyée à App Store Connect.
- Coller la **version EN** dans le champ *Notes* de App Review Information
  (elle y restera pour les soumissions suivantes), et répondre dans le fil App
  Review avec le même contenu + la vidéo.

---

# Version courte — champ « Répondre » (limite 4000 caractères)

Texte réellement envoyé à App Review le 15 août 2026 (3 940 caractères) :

```
Ghost Lift is a fully offline strength-training logbook. No account, no server, no purchase, no permission prompt. Everything below is reproducible by simply launching the app.

2. DEVICES AND OS TESTED
iPhone 17 Pro Max - iOS 26 (physical device, build installed through TestFlight).

3. FUNCTIONS AND TARGET AUDIENCE
Ghost Lift is a workout logbook for people who lift weights on their own, without a coach. Problem solved: when you train alone you forget what you lifted last time, so you repeat the same weight for weeks without realizing you have stopped progressing.
The app lets the user:
- create training sessions (a session = a named list of exercises);
- log each set (weight, reps) at the gym, between sets;
- see the "ghost" of the previous session for that exercise before lifting, so they know what to beat;
- get an immediate verdict after each set (progress / plateau / personal record);
- run an automatic rest timer between sets;
- see weekly training volume and plateau warnings on a dashboard.
Audience: adults doing recreational strength training. It is a general fitness tracking tool, not a medical app.

4. SETUP AND ACCESS
No login and no demo account are needed: the app has no user account system at all.
On first launch the app is preloaded with a sample program (sessions "Upper A", "Lower", "Upper B") including sample set history, so every feature is reachable without any data entry. A banner lets the user either adopt this program or delete the sample data and create their own.
Steps:
1) Launch the app: the session list appears.
2) Tap a session to see its exercises.
3) Tap an exercise (for example "Développé couché" in "Upper B"): the target suggested from the previous session is displayed; enter weight and reps, then validate the set. The rest timer starts automatically and the next set is pre-filled.
4) The top bar, always visible, returns to the session list at any time.
5) "Dashboard" in the top bar shows the weekly volume chart and plateau warnings.
6) To create your own content: "Nouvelle séance", then add exercises inside it.
The user interface is in French only.

5. EXTERNAL SERVICES, TOOLS AND PLATFORMS
None. The app performs no network request whatsoever and works entirely in airplane mode.
- Data providers: none. All content is created by the user; the preloaded sample program is authored by us and bundled in the app.
- Authentication services: none. Payment processors, in-app purchases, subscriptions, ads: none. AI services: none. Analytics or tracking SDKs: none.
- Storage: a local SQLite database on the device only. Nothing is uploaded or shared. Deleting the app deletes all data.
- Built with open-source frameworks compiled into the binary (Tauri 2 for the native shell, Vue 3 for the interface). These are build dependencies, not runtime services.
Because there is no account, there are no registration, login or account deletion flows. Because there is no server and no sharing feature, there is no user-generated content visible to other users, so reporting and blocking mechanisms are not applicable. The app requests no access to location, contacts, camera, photos, health data or App Tracking Transparency, so no permission prompt appears.

6. REGIONAL DIFFERENCES
None. The app behaves identically in every region and contains no region-restricted feature or content. The interface is in French everywhere.

7. REGULATED INDUSTRY / PROTECTED THIRD-PARTY MATERIAL
Not applicable. Ghost Lift is a general fitness logging tool: no medical claims, no medical or nutritional advice, no HealthKit, no health records. All in-app content (exercise names, sample program, artwork) is our own; the app includes no licensed or protected third-party material.
The app collects no personal data; all data stays on the device.

1. Screen recording, captured on iPhone 17 Pro Max running iOS 26 and starting from the app launch: https://www.youtube.com/watch?v=gpimFS6054c
```
