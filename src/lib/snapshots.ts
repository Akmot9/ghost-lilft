/**
 * Les instantanés tels que les écrans les lisent (#71) : la forme de fil
 * (`appApi.ts`), avec les dates redevenues des `Date` pour le formatage
 * local — c'est la seule chose que Vue leur ajoute.
 */

import type {
  DashboardSnapshotDto,
  ExerciseSetDto,
  ExerciseSnapshotDto,
  SeanceExerciseDto,
  SeanceSessionDto,
  SeanceSnapshotDto,
  TrainingSessionDto,
  WarmupDayDto,
  WeeklyVolumeDto,
} from './appApi'
import type { ExerciseSet, TrainingSession } from './trainingInsights'

export type WarmupDay = Omit<WarmupDayDto, 'sets'> & { sets: ExerciseSet[] }

export type PositionalGhost = {
  set: ExerciseSet
  position: number
  sessionKey: string
}

/** Le volume d'une semaine, avec son lundi en `Date` pour l'étiquette. */
export type WeeklyVolume = WeeklyVolumeDto & { weekStart: Date }

export type ExerciseSnapshot = Omit<
  ExerciseSnapshotDto,
  'sessions' | 'warmups' | 'ghost' | 'records' | 'weekly'
> & {
  sessions: TrainingSession[]
  warmups: WarmupDay[]
  ghost: PositionalGhost | null
  records: ExerciseSet[]
  weekly: WeeklyVolume[]
}

export type SeanceSession = SeanceSessionDto & { date: Date }

export type SeanceExercise = Omit<SeanceExerciseDto, 'lastSet'> & { lastSet: ExerciseSet | null }

export type SeanceSnapshot = Omit<
  SeanceSnapshotDto,
  'sessions' | 'latest' | 'previous' | 'exercises' | 'weekly'
> & {
  sessions: SeanceSession[]
  latest: SeanceSession | null
  previous: SeanceSession | null
  exercises: SeanceExercise[]
  weekly: WeeklyVolume[]
}

export type DashboardSnapshot = Omit<DashboardSnapshotDto, 'lastSetAt' | 'weekly'> & {
  lastSetAt: Date | null
  weekly: WeeklyVolume[]
}

export function fromSetDto(dto: ExerciseSetDto): ExerciseSet {
  return {
    id: dto.id,
    reps: dto.reps,
    weight: dto.weight,
    completedAt: new Date(dto.completedAt),
    isWarmup: dto.isWarmup,
    rpe: dto.rpe,
    isDeload: dto.isDeload,
  }
}

/** Un jour UTC `AAAA-MM-JJ` en `Date`, à minuit UTC. */
export function dateOfDay(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

export function fromTrainingSessionDto(dto: TrainingSessionDto): TrainingSession {
  return { ...dto, date: dateOfDay(dto.key), sets: dto.sets.map(fromSetDto) }
}

export function fromWeeklyVolumeDto(dto: WeeklyVolumeDto): WeeklyVolume {
  return { ...dto, weekStart: dateOfDay(dto.week) }
}

export function fromExerciseSnapshotDto(dto: ExerciseSnapshotDto): ExerciseSnapshot {
  return {
    ...dto,
    sessions: dto.sessions.map(fromTrainingSessionDto),
    warmups: dto.warmups.map((day) => ({ ...day, sets: day.sets.map(fromSetDto) })),
    ghost: dto.ghost && { ...dto.ghost, set: fromSetDto(dto.ghost.set) },
    records: dto.records.map(fromSetDto),
    weekly: dto.weekly.map(fromWeeklyVolumeDto),
  }
}

function fromSeanceSessionDto(dto: SeanceSessionDto | null): SeanceSession | null {
  return dto && { ...dto, date: dateOfDay(dto.key) }
}

export function fromSeanceSnapshotDto(dto: SeanceSnapshotDto): SeanceSnapshot {
  return {
    ...dto,
    sessions: dto.sessions.map((session) => fromSeanceSessionDto(session)!),
    latest: fromSeanceSessionDto(dto.latest),
    previous: fromSeanceSessionDto(dto.previous),
    exercises: dto.exercises.map((exercise) => ({
      ...exercise,
      lastSet: exercise.lastSet && fromSetDto(exercise.lastSet),
    })),
    weekly: dto.weekly.map(fromWeeklyVolumeDto),
  }
}

export function fromDashboardSnapshotDto(dto: DashboardSnapshotDto): DashboardSnapshot {
  return {
    ...dto,
    lastSetAt: dto.lastSetAt === null ? null : new Date(dto.lastSetAt),
    weekly: dto.weekly.map(fromWeeklyVolumeDto),
  }
}
