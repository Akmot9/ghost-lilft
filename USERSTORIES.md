# User Stories

## Add Vue Router and Pinia exercise state

- As a lifter, I want to move between exercises with previous and next navigation so I can track a full workout without typing URLs.
- As a lifter, I want to create a new exercise from the app so I can expand my workout beyond the default bench press exercise.
- As a lifter, I want newly created exercises to be shared across routes so I can open them immediately after creation.
- As a lifter, I want added and removed sets to update shared exercise state so each exercise route reflects the current workout data.
- As a developer, I want exercises stored in Pinia instead of static data so routing, creation, and future persistence can use one source of truth.

## Generalize exercise tracker component

- As a lifter, I want the same tracker to work for any exercise so I can track bench press, squat, deadlift, or future movements consistently.
- As a lifter, I want each exercise to provide its own name, default reps, default weight, unit, and dataset so the tracker adapts to the selected exercise.
- As a developer, I want exercise data separated from the tracker component so future Vue Router views can reuse the same tracker with different exercise datasets.
- As a developer, I want the bench press data moved out of the generic tracker so the component is no longer coupled to one exercise.

## Refine Ghost Lift visual theme

- As a lifter, I want the app colors to match the Ghost Lift identity so the experience feels cohesive and recognizable.
- As a lifter, I want the previous session ghost overlay to stand out clearly so I can compare it against the current session at a glance.
- As a developer, I want the session diff extracted into its own component so the tracker stays focused on workout state and the comparison UI is easier to maintain.
- As a lifter, I want weekly volume drops to remain visually distinct in the dark theme so regressions stay easy to spot.

## Improve session progression visuals

- As a lifter, I want to compare my latest bench session against the previous one as an overlay so I can immediately see where the new session beat or missed the last one.
- As a lifter, I want the previous session to appear as a ghost behind the current session so heavier weight with lower reps or volume is visible without explanatory text.
- As a lifter, I want weekly volume drops to render in red so regressions stand out in the progression chart.
