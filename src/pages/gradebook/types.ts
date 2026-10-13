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
  classId: string
  focus: boolean
  note: string
}

export interface Exam {
  id: string
  name: string
  date: string
  subjects: Subject[]
}

export interface ScoreRecord {
  examId: string
  studentId: string
  scores: Record<string, number | null>
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
  className: string
  scores: Record<string, number | null>
  line: number
}

export interface ImportPreview {
  rows: ImportRow[]
  errors: string[]
  subjects: string[]
}
