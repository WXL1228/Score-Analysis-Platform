export interface Subject {
  id: string
  name: string
  max: number
  pass: number
  excellent: number
}

export interface SchoolClass {
  id: string
  name: string
}

export interface Student {
  id: string
  number: string
  name: string
  gender?: string
  classId: string
  focus: boolean
  note: string
}

export interface Exam {
  id: string
  name: string
  date: string
  subjects: Subject[]
  subjectsCustomized?: boolean
}

export interface ScoreRecord {
  examId: string
  studentId: string
  scores: Record<string, number | null>
}

export interface UnitPeriod {
  id: string
  name: string
}

export interface UnitScores {
  target: number | null
  actual: number | null
}

export interface UnitTrackingEntry {
  studentId: string
  baseline: number | null
  level: string
  task: string
  scores: Record<string, UnitScores>
}

export interface UnitTrackingPlan {
  id: string
  name: string
  classId: string
  subjectId: string
  periods: UnitPeriod[]
  entries: UnitTrackingEntry[]
}

export interface UnitImportRow extends Omit<UnitTrackingEntry, "studentId"> {
  number: string
  name: string
  gender?: string
  line: number
}

export interface UnitImportPreview {
  periods: UnitPeriod[]
  rows: UnitImportRow[]
  errors: string[]
  warnings: string[]
}

export interface UnitPlanImport {
  name: string
  className: string
  subjectId: string
  periods: UnitPeriod[]
  rows: UnitImportRow[]
}

export interface Workspace {
  id: string
  name: string
  teacher: string
  demo: boolean
  warningThreshold: number
  classes: SchoolClass[]
  subjects: Subject[]
  students: Student[]
  exams: Exam[]
  records: ScoreRecord[]
  unitPlans?: UnitTrackingPlan[]
  selectedClassId: string
  selectedExamId: string
}

export interface GradebookArchive {
  version: 1
  activeWorkspaceId: string
  workspaces: Workspace[]
}

export interface RankedStudent extends Student {
  scores: Record<string, number | null>
  total: number | null
  average: number | null
  rank: number | null
  gradeRank: number | null
  previousRank: number | null
  change: number | null
  subjectRanks: Record<string, number | null>
  warnings: string[]
}

export interface Statistics {
  count: number
  average: number
  max: number
  min: number
  passRate: number
  excellentRate: number
}

export interface ImportRow {
  number: string
  name: string
  gender?: string
  className: string
  scores: Record<string, number | null>
  line: number
}

export interface ImportPreview {
  rows: ImportRow[]
  errors: string[]
  subjects: string[]
}

export interface ClassInitialization {
  name: string
  exam?: { name: string, date: string, subjects: Subject[] }
  rows: ImportRow[]
  setDefaultSubjects: boolean
}
