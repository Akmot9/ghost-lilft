# Revenant vue par un coach et un médecin du sport

Analyse de l'app telle qu'elle est aujourd'hui (v1.12), lue non pas comme du
code mais comme un outil d'entraînement mis entre les mains d'un lifteur
autonome, sans coach, qui s'entraîne trois fois par semaine en pyramidal.
Chaque point renvoie au fichier qui porte le comportement, pour que la
critique soit actionnable.

Le repos entre séries a déjà sa note : `recherche-temps-de-repos.md` et
l'issue #94. Il n'est repris ici que pour sa place dans l'ensemble.

## 1. Ce que l'app fait juste

Ces choix sont rares dans les apps grand public et méritent d'être protégés.

- **Le fantôme positionnel** (`trainingInsights.ts`, `getPositionalGhost`).
  Comparer la N-ième série à la N-ième série est la seule comparaison honnête
  en pyramidal. La plupart des apps comparent à « la meilleure série » ou à
  « la dernière », ce qui annonce un recul par construction sur une série
  légère. C'est exactement ce qu'un coach fait avec un carnet papier.
- **Le verdict immédiat, sans jugement automatique** (`compareSetToGhost`).
  Quand charge et répétitions varient en sens contraire, l'app montre les
  deux écarts et laisse le lifteur juger. Un « +2 kg, −1 rep » est un
  échange que l'algorithme n'a pas à trancher.
- **Pas de +1 automatique** (GL-22). La surcharge progressive est une
  décision, pas une injonction. Une app qui pousse « +2,5 kg » chaque séance
  fabrique des séries ratées et des tendinopathies.
- **L'échauffement séparé du travail** (`isWorkingSet`). Les gammes
  montantes ne polluent ni le volume, ni les records, ni le fantôme. C'est
  la bonne frontière physiologique : une marche à 70 % ne produit pas
  d'adaptation, elle prépare.
- **La rampe proposée** (`suggestWarmupRamp`) : barre à vide × 10, 50 % × 6,
  70 % × 3, 90 % × 1. C'est un échauffement spécifique conforme aux
  recommandations : volume décroissant, charge croissante, une dernière
  série quasi maximale pour la potentiation, sans fatigue accumulée. Réserver
  la rampe calculée au premier polyarticulaire de la séance est aussi juste.
- **Le RPE en trois crans** (`RPE_CHOICES` : 7 / 8 / 9). Trois choix
  correspondent à ce qu'un lifteur peut réellement discriminer entre deux
  séries. La correspondance en répétitions en réserve (3 / 2 / 1-0) est
  correcte. Le fait que l'échauffement ne se note pas est correct aussi.
- **Le repos mesuré à l'horloge murale**, persistant, avec notification et
  Live Activity. Un chrono qui gèle en arrière-plan est le défaut numéro un
  des apps de salle ; celui-ci ne gèle pas.
- **Le poids de corps** à une pesée par jour, dernière lecture faisant foi.
  C'est la bonne granularité : le poids fluctue de 1 à 2 kg dans la journée.
- **Aucune donnée qui sort de l'appareil.** Pour des données de santé, c'est
  la posture qu'on recommande.

## 2. Le programme de démonstration, lu comme un programme

`src/datasets/demoProgram.ts` n'est pas seulement une démo : c'est le
programme de référence de l'utilisateur, et le premier que voit un nouvel
utilisateur. Il faut donc le lire comme une prescription.

### Répartition hebdomadaire par groupe musculaire

Séries de travail directes par semaine, trois séries par exercice :

| Groupe | Exercices | Séries/sem. | Fréquence | Lecture |
|--------|-----------|-------------|-----------|---------|
| Pectoraux | Développé incliné, développé couché | 6 | 2× | bas de la fourchette utile |
| Deltoïde antérieur | + élévations frontales | 9 + 3 | 2× | redondant, voir plus bas |
| Deltoïde latéral | Élévations latérales, upright row | 6 | 2× | correct |
| Deltoïde postérieur / haut du dos | Oiseau, upright row penché | 6 | 2× | correct |
| Grand dorsal | Tractions lestées, tractions neutres | 6 | 2× | correct, mais vertical seulement |
| Tirage horizontal (rowing) | aucun | 0 | 0× | **absent** |
| Triceps | aucun direct (9 séries de développé) | 0 direct | — | acceptable |
| Biceps | Curl incliné + tractions | 3 + 6 indirect | 2× | correct |
| Quadriceps | High bar squat, leg extension | 6 | 1× | bas |
| Ischio-jambiers | Romanian deadlift, leg curl | 6 | 1× | correct |
| Fessiers | indirect (squat, RDL) | 0 direct | 1× | acceptable |
| Mollets | Extensions mollets | 3 | 1× | bas |
| Tronc / gainage | aucun | 0 | 0× | **absent** |

Repères de la littérature : la relation dose-réponse (Schoenfeld, Ogborn &
Krieger 2017) montre un gain d'hypertrophie qui continue jusqu'à 10 séries et
plus par semaine et par muscle ; l'entraînement de chaque muscle deux fois par
semaine fait mieux qu'une fois à volume égal (Schoenfeld, Ogborn & Krieger
2016, méta-analyse fréquence). Le haut du corps est à 2× avec 6 séries : bas
mais tenable. Le bas du corps est à 1× avec 6 séries : c'est le maillon
faible du programme, et le squat de la démo est justement celui qui stagne.

### Trois déséquilibres à corriger

1. **Aucun tirage horizontal.** Six séries de développé horizontal (couché,
   incliné) contre zéro rowing. C'est le déséquilibre classique qui tire
   l'épaule en avant (rotation interne, coiffe des rotateurs sous tension,
   omoplates en protraction). Un médecin du sport le lit comme un facteur de
   risque de conflit sous-acromial à moyen terme. Remplacer les élévations
   frontales par un rowing (barre, haltère ou machine) règle les deux points
   suivants en même temps.
2. **Les élévations frontales sont redondantes.** Le deltoïde antérieur reçoit
   déjà neuf séries de développé par semaine. Trois séries d'isolation en
   plus ne rapportent rien et occupent un créneau que le dos aurait dû avoir.
3. **Upright row, deux fois par semaine.** C'est le mouvement le plus
   souvent cité pour le conflit sous-acromial : rotation interne de l'épaule
   sous charge avec abduction au-dessus de 90°. Prise large et coudes sous la
   ligne des épaules réduisent le risque ; un face pull ou un rowing coude
   haut fait le même travail sans le conflit. « Upright row penché », placé
   dans la séance jambes, est probablement un tirage postérieur : le nom
   mérite d'être clarifié pour que le fantôme et les records comparent le
   bon geste.

À noter aussi : aucun travail de gainage ni de mouvement unilatéral. Ce
n'est pas un problème d'hypertrophie, c'en est un de prévention : le squat et
le RDL lourds sans gainage dédié laissent le tronc dépendre de ce que les
mouvements principaux lui donnent, ce qui suffit chez un débutant et de moins
en moins ensuite.

### Fourchettes de répétitions

5–8 sur les polyarticulaires, 10–18 sur les isolations : cohérent avec les
objectifs (force et hypertrophie). Le pyramidal inversé de la démo Lower
(6×80, 6×70, 6×60) est un schéma valable ; le pyramidal montant (8×60,
8×68, 6×76) l'est aussi. Les deux ont un point commun : **la série la plus
lourde est celle qui coûte le plus et récupère le moins**, ce que le repos
uniforme par exercice ne prend pas en compte (issue #94, piste 2).

## 3. La logique de progression

### Ce qui compte comme « progrès »

L'app mesure quatre choses : le verdict série par série, le volume (reps ×
charge) par séance et par semaine, le record de charge, et la stagnation.
Chacune a un angle mort.

- **Le volume comme métrique principale** (`WeeklyVolumeGraph`,
  `SeanceOverview`, dashboard). Le tonnage est un proxy grossier : 3×12 à
  40 kg (1 440 kg) « bat » 3×5 à 90 kg (1 350 kg) alors que la seconde
  séance est plus lourde et plus efficace pour la force. En pyramidal, le
  tonnage monte quand on allège la S1 pour faire plus de reps. Un coach ne
  suit jamais le tonnage seul. Deux compléments changent tout :
  - **le 1RM estimé** (Epley ou Brzycki, sur la meilleure série de la
    journée). Il existe déjà dans Grafana, il n'existe pas dans l'app. C'est
    la mesure qui rend comparables 6×76 et 8×72, et donc qui dit si la
    pyramide a progressé au-delà du verdict série par série ;
  - **le nombre de séries de travail par muscle et par semaine**, la
    variable de dose que la littérature relie le mieux à l'hypertrophie.
- **Le record, c'est la charge seule** (`isNewRecord` : strictement plus
  lourd que tout l'historique). 8×80 après 6×80 n'est pas un record dans
  l'app ; c'en est un pour n'importe quel coach. Un record devrait exister
  par répétition cible (meilleure charge à 5, 6, 8 reps) ou par 1RM estimé.
- **La stagnation se déclenche sur deux séances identiques**
  (`isExerciseStagnant` : même charge max et même total de reps sur les deux
  dernières séances). C'est trop sensible et trop aveugle à la fois :
  - trop sensible : une séance tenue à l'identique, c'est une consolidation,
    pas un plateau. Un plateau se lit sur trois à quatre séances ;
  - trop aveugle : la même charge à RPE 7 après RPE 9 est un **progrès**
    (la même performance coûte moins). L'app a le RPE et ne s'en sert pas
    ici. Même charge, mêmes reps, RPE en baisse : pas de plateau. Même
    charge, mêmes reps, RPE en hausse : c'est de la fatigue, pas un plateau,
    et la réponse n'est pas « pousser plus » mais « décharger ».
- **La cible est le fantôme à l'identique.** Juste comme principe (voir
  §1). Mais l'app dispose de tout pour proposer une règle de double
  progression sans l'imposer : quand les trois séries ont atteint leur
  cible à RPE ≤ 8 deux séances de suite, suggérer +2,5 kg (barre) ou +1 rep.
  Un hint sous la cible, jamais un pré-remplissage.

### Ce qui manque : la fatigue

L'app ne connaît que la performance. Elle ne voit ni la fatigue, ni le
sommeil, ni la douleur. Concrètement :

- **Pas de décharge.** Un programme suivi huit semaines de suite en
  cherchant à battre le fantôme à chaque séance finit en surmenage ou en
  blessure. La pratique courante est une semaine allégée toutes les 4 à 8
  semaines (−40 % de volume ou −10 % de charge). Rien dans l'app ne permet
  de la planifier, et une semaine de décharge apparaît aujourd'hui comme une
  semaine « en recul » en rouge sur le graphe, puis déclenche le fantôme de
  la semaine légère à la reprise. Il faut au minimum pouvoir **marquer une
  séance comme décharge** : exclue du fantôme, dessinée en gris.
- **Pas de tendance de RPE.** Le RPE moyen par exercice sur quatre semaines,
  à charge stable, est le meilleur indicateur précoce de surmenage dont
  l'app dispose déjà dans ses données. Il est dans Grafana, pas dans l'app.
- **Pas de retour après une coupure.** Le dashboard sait dire « dernière
  série il y a 18 j », mais le fantôme propose quand même la charge d'il y a
  trois semaines. Après deux semaines d'arrêt, un médecin du sport
  recommande de reprendre à −10 à −20 %. Un simple avertissement sous la
  cible (« 18 jours sans cet exercice : vise plutôt 68 kg ») évite la
  blessure de reprise, qui est la plus fréquente chez l'autonome.
- **Pas de douleur.** Aucun endroit pour noter « épaule droite gênante »
  sur une série. Sans ça, impossible de relier après coup une tendinopathie
  à la semaine où l'upright row est passé à 25 kg. Un champ optionnel par
  série ou par séance, à la façon du RPE, avec une localisation et une
  intensité 0–10, suffit.

## 4. L'échauffement, vu de plus près

- La rampe spécifique est juste (§1). Ce qui manque, c'est **l'échauffement
  général** : cinq à dix minutes d'élévation de la température (vélo, rameur,
  marche rapide) et deux ou trois mouvements de mobilité (épaules, hanches)
  avant la première barre. L'app n'a pas à le chronométrer, mais un
  utilisateur qui découvre l'app par la démo doit savoir que la rampe ne
  commence pas à froid. Une ligne dans le panneau « Montée en charge »
  suffit.
- La rampe n'est proposée qu'au premier exercice. Sur le deuxième
  polyarticulaire lourd d'une séance, surtout quand il sollicite une autre
  articulation (overhead press après développé couché ; RDL après squat),
  une ou deux marches à 50–70 % restent recommandées. La logique « celle de
  la dernière fois si elle existe » couvre déjà le cas où le lifteur en fait
  une ; c'est seulement la première fois qu'il n'a rien.
- Le repos d'échauffement à 60 s est correct. La dernière marche à 90 % × 1
  gagnerait plutôt 90 à 120 s avant S1 : c'est celle qui produit la
  potentiation, et elle se dissipe si S1 part trop tôt ou trop tard.

## 5. Le repos

Voir `recherche-temps-de-repos.md` et #94. Résumé : le programme de démo est
sous les recommandations pour un pratiquant entraîné (3 min sur les
polyarticulaires, 90 s à 2 min sur les isolations ; leg curl et leg
extension à 30 s sont hors de toute recommandation). Le défaut du formulaire
à 180 s est juste.

## 6. Le poids de corps et la force relative

La pesée quotidienne est la bonne pratique. Ce qui manque pour qu'elle serve :

- **Une moyenne mobile sur 7 jours.** Le poids brut varie de ±1 kg d'un jour
  à l'autre (hydratation, glycogène, transit) ; l'écart entre deux pesées
  affiché aujourd'hui (`weightDelta`) est du bruit. La tendance
  hebdomadaire est ce qu'on lit.
- **La force relative** : 1RM estimé / poids de corps sur squat et développé.
  C'est la métrique qui reste juste quand le poids change, et celle qu'un
  lifteur en sèche ou en prise de masse devrait regarder. Grafana a « Volume
  rapporté au poids de corps » ; c'est la bonne idée avec la mauvaise
  métrique (le tonnage, encore).

## 7. Priorités, du point de vue coach

Par ordre de rapport bénéfice / coût, en distinguant ce qui relève du
programme (données de démo, aucune logique) et ce qui relève de l'app.

Programme (`demoProgram.ts`) :

1. Remonter les repos (#94).
2. Remplacer les élévations frontales par un rowing horizontal.
3. Remplacer au moins un des deux upright rows par un face pull ; renommer
   « Upright row penché » selon ce que c'est vraiment.
4. Ajouter un exercice de gainage à la séance Lower, sans fantôme ni volume
   si nécessaire (une durée plutôt qu'une charge).

App :

5. **Le 1RM estimé** par exercice, dans le tracker et sur le graphe, à côté
   du volume. Les données sont là ; la formule est déjà dans Grafana.
6. **La stagnation informée par le RPE** et sur trois séances : même
   performance à RPE en baisse n'est pas un plateau.
7. **Marquer une séance comme décharge** : hors fantôme, en gris sur les
   graphes. Et proposer la décharge quand le RPE moyen monte à charge
   stable sur trois semaines.
8. **Avertissement de reprise** quand le dernier passage sur l'exercice date
   de plus de 14 jours : proposer −10 %.
9. **Un record par cible de répétitions**, pas seulement la charge absolue.
10. **Une note de douleur** optionnelle par série (localisation, 0–10),
    exportée avec le reste.
11. **Le repos réellement pris**, déduit de `completedAt`, dans le bilan de
    séance : c'est l'indicateur qui dit si le chrono est trop court ou si le
    lifteur repart avant la fin.
12. Un mot sur l'échauffement général dans le panneau de rampe.

Ce que je ne recommande pas : un calcul automatique de la charge suivante
imposé dans le formulaire, un score de « readiness » à partir de rien
(l'app n'a ni sommeil ni FC), ou un suivi nutritionnel. L'app tient parce
qu'elle ne fait qu'une chose ; ces ajouts la diluent sans ajouter de valeur
médicale.

## Références

- Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between
  weekly resistance training volume and increases in muscle mass. J Sports
  Sci 2017;35(11):1073–82.
- Schoenfeld BJ, Ogborn D, Krieger JW. Effects of resistance training
  frequency on measures of muscle hypertrophy: a systematic review and
  meta-analysis. Sports Med 2016;46(11):1689–97.
- Helms ER et al. Application of the repetitions in reserve-based rating of
  perceived exertion scale for resistance training. Strength Cond J 2016.
- Zourdos MC et al. Novel resistance training-specific RPE scale measuring
  repetitions in reserve. J Strength Cond Res 2016;30(1):267–75.
- Kolber MJ et al. Shoulder injuries attributed to resistance training: a
  brief review. J Strength Cond Res 2010;24(6):1696–704.
- Schoenfeld BJ, Kolber MJ. Upright row: implications for preventing
  subacromial impingement. Strength Cond J 2011.
- Fradkin AJ, Zazryn TR, Smoliga JM. Effects of warming-up on physical
  performance: a systematic review with meta-analysis. J Strength Cond Res
  2010;24(1):140–8.
- Bell L et al. Overreaching and overtraining in strength sports and
  resistance training: a scoping review. J Sports Sci 2020;38(16):1897–1912.
- Bosquet L et al. Effect of training cessation on muscular performance: a
  meta-analysis. Scand J Med Sci Sports 2013;23(3):e140–9.
- Les références sur le repos sont dans `recherche-temps-de-repos.md`.
