# Kanban

## Todo

- Persist exercises and sets in `localStorage` so data survives refresh.
- Add an exercise list/menu to jump directly to any exercise.
- Add edit/delete actions for created exercises.
- Add validation feedback on the create exercise form.
- Add empty states for new exercises with no sets or graph data.
- Prepare mobile layout checks for small phone screens.

## Doing

- Define the simple local persistence approach before adding backend or SQLite.

## Done

- Create the initial bench press tracker.
- Add reps and positive integer weight entry.
- Store date and time when a set is added.
- Show only the last three sets in the set list.
- Add weekly volume graph.
- Mark weekly volume drops in red.
- Add latest session comparison.
- Show previous session as a ghost overlay behind the current session.
- Retheme the app around the Ghost Lift identity.
- Extract session diff into a separate component.
- Generalize the tracker from bench press to any exercise.
- Add Vue Router routes for exercises.
- Add Pinia store for shared exercise state.
- Add exercise creation flow.
- Add previous and next exercise navigation.
- Add global dark background styling.
