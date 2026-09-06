# Temps de repos entre les séries — ce que disent les études

Point de départ : « les temps de récup ne sont jamais assez longs ». Cette
note résume la littérature sur le repos inter-séries et la confronte aux
valeurs que l'app propose aujourd'hui. Le persona (lifteur entraîné, trois
séries pyramidales par exercice, une séance par semaine) est exactement la
population où les repos longs font la différence.

## Ce que disent les études

### Adaptations à long terme (force, hypertrophie)

- **Schoenfeld et al., 2016** (J Strength Cond Res 30(7)) — 21 hommes
  entraînés, 8 semaines, 3 séries de 8–12 RM, **1 min vs 3 min**. Le groupe
  3 min gagne significativement plus en 1RM squat et développé couché et en
  épaisseur musculaire (quadriceps, triceps). C'est l'essai de référence pour
  un pratiquant expérimenté.
- **Grgic et al., 2018** (Sports Med 48(1), revue systématique force) — chez
  les **entraînés, il faut plus de 2 min** pour maximiser les gains de force ;
  chez les débutants, 60–120 s suffisent.
- **Grgic et al., 2017** (Eur J Sport Sci, revue hypertrophie) — repos courts
  et longs se valent chez les débutants ; **les repos longs sont avantageux
  dès qu'on a de l'expérience**.
- **Singer et al., 2024** (Front Sports Act Living, méta-analyse bayésienne)
  — petit bénéfice d'hypertrophie à dépasser 60 s, pas de différence
  détectable au-delà de 90 s. Le bénéfice passe probablement par le volume
  de charge conservé. Peu d'études comparent 2 min à 3 min ou plus, d'où
  l'absence de signal — pas une preuve que 90 s suffisent en pyramidal lourd.
- **Longo et al., 2022** (J Strength Cond Res 36(6)) — leg extension, 10
  semaines, repos long vs court avec ou sans volume égalisé. L'hypertrophie
  suit le **volume de charge** (13 % vs 7 % de section transversale) ; le
  repos court ne nuit que parce qu'il fait perdre des répétitions.
- **ACSM, position stand 2009** — 2–3 min minimum sur les exercices de base
  (squat, développé), 1–2 min sur les exercices d'assistance, **3–5 min pour
  les charges lourdes (1–6 RM)**.

### Performance dans la séance (répétitions tenues d'une série à l'autre)

- **Willardson & Burkett, 2005** — 4 séries à 8 RM, squat et développé
  couché. Répétitions totales sur les 4 séries :

  | Repos | Squat | Développé couché |
  |-------|-------|------------------|
  | 1 min | 22,5  | 17,1             |
  | 2 min | 25,5  | 21,6             |
  | 5 min | 28,8  | 25,7             |

  À 1 min on perd un tiers des répétitions par rapport à 5 min.
- **Willardson & Burkett, 2006** — même schéma à 15 RM : la chute des
  répétitions avec un repos court se retrouve aussi sur charge légère.
- **Senna et al., 2011** — 5 séries à 10 RM, 1 / 3 / 5 min, hommes
  entraînés. Développé couché : 3 min = 5 min > 1 min. Leg press, écarté et
  **leg extension : 1 < 3 < 5 min**. Même une isolation perd des répétitions
  sous 3 min. Le RPE est systématiquement plus haut à 1 min.
- **Étude 2025, J Strength Cond Res** (5 séries de développé couché et
  squat, 4 min vs 8 min vs alternance) — 8 min donne +24 % de volume au
  squat et +30 % au développé par rapport à 4 min. Alterner deux exercices
  (séries appariées) récupère l'essentiel du bénéfice en moitié moins de
  temps.

### Physiologie

- La phosphocréatine se resynthétise en deux phases : demi-vie rapide de
  **21–30 s**, puis une phase lente de demi-vie **> 170 s**. En pratique,
  environ 80 % à 2 min, quasi complet vers 3–5 min. Un repos de 90 s laisse
  une part du réservoir vide avant la série la plus lourde.

### Repos libre vs fixe

- Un préprint 2026 (SportRxiv) — 40 pratiquants entraînés, 8 semaines, repos
  libre vs fixe ~2 min : mêmes gains d'épaisseur, de force et d'endurance.
  Laisser le lifteur allonger le repos à sa guise ne coûte rien.
- En salle, la plupart des gens qui « contrôlent » leur repos prennent 60 s
  ou moins (questionnaire, 415 pratiquants). C'est une habitude, pas une
  recommandation.

## Ce que ça change pour l'app

Le programme du persona est du pyramidal sur trois séries, dont une lourde
(5–6 reps). C'est le cas « entraîné + charge lourde » : la littérature
converge sur **3 min sur les polyarticulaires, jamais moins de 2 min**, et
**90 s à 2 min sur les isolations** (Senna montre qu'elles perdent aussi des
répétitions à 1 min).

Valeurs actuelles dans `src/datasets/demoProgram.ts` et ce que les études
suggèrent :

| Exercice | Aujourd'hui | Suggéré | Pourquoi |
|----------|-------------|---------|----------|
| Développé incliné, overhead press | 150 s | 180 s | polyarticulaire lourd, 5–6 reps en S3 |
| Développé couché, high bar squat, tractions lestées | 120 s | 180 s | idem ; Willardson : 2 min coûte encore des reps vs 5 min |
| Romanian deadlift | 90 s | 150 s | polyarticulaire, 8–12 reps |
| Leg curl, leg extension | 30 s | 90 s | Senna 2011 : leg extension perd des reps à 1 min, a fortiori à 30 s |
| Élévations, curls, oiseau, upright row | 60–90 s | 90 s | isolation, ≥ 60 s suffisant (Singer 2024) |
| Extensions mollets | 60 s | 90 s | idem |

Le défaut du formulaire (`CreateExerciseView.vue`, 180 s) est déjà aligné.
Le repos d'échauffement à 60 s (GL-45) reste juste : ce n'est pas un effort à
récupérer.

Pistes qui découlent de la littérature, à décider séparément :

1. **Monter les défauts du programme de démo** au tableau ci-dessus. Le seul
   changement qui s'impose vraiment : leg curl / leg extension à 30 s.
2. **Repos qui grandit avec la charge** : en pyramidal montant, la série la
   plus coûteuse est la dernière. Un +30 s automatique avant la série la plus
   lourde suit la logique « le repos sert la série à venir ».
3. **Pas de +15 s mais +30 s** : sur une base de 3 min, 15 s est un réglage
   fin ; 30 s est l'unité que les études manipulent.
4. **Compter le repos réellement pris** : les séries ont un `completedAt`, le
   repos effectif entre deux séries se déduit. Le montrer dans le bilan
   dirait si le chrono est trop court ou si c'est le lifteur qui repart avant
   la fin — deux problèmes différents.
5. **Séries appariées** : alterner deux exercices pendant le repos (étude
   2025) est la seule façon d'avoir 4–8 min de repos réel sans doubler la
   séance. C'est un changement de structure de séance, pas du chrono.

## Sources

- Schoenfeld BJ et al. Longer interset rest periods enhance muscle strength
  and hypertrophy in resistance-trained men. J Strength Cond Res 2016;30(7):1805–12.
  https://journals.lww.com/nsca-jscr/fulltext/2016/07000/longer_interset_rest_periods_enhance_muscle.3.aspx
- Grgic J et al. Effects of rest interval duration in resistance training on
  measures of muscular strength: a systematic review. Sports Med 2018;48(1):137–51.
  https://pubmed.ncbi.nlm.nih.gov/28933024/
- Grgic J et al. The effects of short versus long inter-set rest intervals in
  resistance training on measures of muscle hypertrophy: a systematic review.
  Eur J Sport Sci 2017. https://onlinelibrary.wiley.com/doi/10.1080/17461391.2017.1340524
- Singer A et al. Give it a rest: a systematic review with Bayesian
  meta-analysis on the effect of inter-set rest interval duration on muscle
  hypertrophy. Front Sports Act Living 2024.
  https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full
- Longo AR et al. Volume load rather than resting interval influences muscle
  hypertrophy during high-intensity resistance training. J Strength Cond Res
  2022;36(6):1554–9. https://pubmed.ncbi.nlm.nih.gov/35622106/
- de Salles BF et al. Rest interval between sets in strength training. Sports
  Med 2009;39(9):765–77. https://pubmed.ncbi.nlm.nih.gov/19691365/
- ACSM. Progression models in resistance training for healthy adults. Med Sci
  Sports Exerc 2009. https://pubmed.ncbi.nlm.nih.gov/19204579/
- Willardson JM, Burkett LN. A comparison of 3 different rest intervals on the
  exercise volume completed during a workout. J Strength Cond Res 2005.
  https://www.researchgate.net/publication/8028008
- Willardson JM, Burkett LN. The effect of rest interval length on the
  sustainability of squat and bench press repetitions. J Strength Cond Res 2006.
  https://pubmed.ncbi.nlm.nih.gov/16686571/
- Senna G et al. The effect of rest interval length on multi and single-joint
  exercise performance and perceived exertion. J Strength Cond Res 2011.
  https://brookbushinstitute.com/articles/rest-interval-length-multi-single-joint-exercise-performance-perceived-exertion
- Effects of rest interval configuration between sets on volume load during
  five sets of bench press and back squat exercise. J Strength Cond Res 2025.
  https://pubmed.ncbi.nlm.nih.gov/40644659/
- Freedom of choice? Effects of self-selected rest intervals on muscular
  adaptations and time-efficiency. SportRxiv 2026 (préprint).
  https://sportrxiv.org/index.php/server/preprint/view/975
- Profiling rest intervals between sets and associated factors in resistance
  training participants. https://pmc.ncbi.nlm.nih.gov/articles/PMC6316470/
- Harris RC et al. The time course of phosphorylcreatine resynthesis during
  recovery of the quadriceps muscle in man. Pflügers Arch 1976.
  https://pubmed.ncbi.nlm.nih.gov/1034909/
