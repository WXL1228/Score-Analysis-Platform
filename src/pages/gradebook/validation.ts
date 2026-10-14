import type { GradebookArchive, Subject, Workspace } from "./types"

export function validateSubjects(subjects: Subject[]): string | null {
  if (!subjects.length) return "至少保留一门学科"
  const names = new Set<string>()
  const ids = new Set<string>()
  for (const subject of subjects) {
    if (!subject.id || !subject.name.trim() || names.has(subject.name.trim()) || ids.has(subject.id)) return "学科名称和标识不能为空或重复"
    if (![subject.max, subject.pass, subject.excellent].every(Number.isFinite)
      || subject.max <= 0 || subject.pass < 0 || subject.pass > subject.excellent || subject.excellent > subject.max) {
      return "分数须满足：0 ≤ 及格分 ≤ 优秀分 ≤ 满分，且满分大于 0"
    }
    names.add(subject.name.trim())
    ids.add(subject.id)
  }
  return null
}

function requireUniqueIds(items: { id: string }[]): void {
  if (items.some(item => !item.id || typeof item.id !== "string") || new Set(items.map(item => item.id)).size !== items.length) throw new Error("备份包含空标识或重复标识")
}

export function validateWorkspace(data: Workspace): void {
  if (!data || typeof data.id !== "string" || typeof data.name !== "string" || !data.name.trim()
    || typeof data.teacher !== "string" || typeof data.demo !== "boolean"
    || !Number.isInteger(data.warningThreshold) || data.warningThreshold < 1
    || ![data.classes, data.subjects, data.students, data.exams, data.records].every(Array.isArray)) {
    throw new Error("档案格式不正确")
  }
  requireUniqueIds(data.classes)
  requireUniqueIds(data.students)
  requireUniqueIds(data.exams)
  if (validateSubjects(data.subjects)) throw new Error("备份学科设置无效")
  if (data.classes.some(item => typeof item.name !== "string" || !item.name.trim())
    || new Set(data.classes.map(item => item.name.trim())).size !== data.classes.length) {
    throw new Error("备份班级名称无效或重复")
  }
  const classIds = new Set(data.classes.map(item => item.id))
  const studentIds = new Set(data.students.map(item => item.id))
  const identities = new Set<string>()
  for (const student of data.students) {
    const key = `${student.classId}:${student.number}`
    if (!classIds.has(student.classId) || typeof student.number !== "string" || !student.number.trim()
      || typeof student.name !== "string" || !student.name.trim() || typeof student.focus !== "boolean"
      || typeof student.note !== "string" || identities.has(key)) {
      throw new Error("备份学生数据无效或学号重复")
    }
    identities.add(key)
  }
  for (const exam of data.exams) {
    if (typeof exam.name !== "string" || !exam.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(exam.date)
      || !Array.isArray(exam.subjects) || validateSubjects(exam.subjects)) {
      throw new Error("备份考试数据无效")
    }
  }
  const recordKeys = new Set<string>()
  for (const record of data.records) {
    const exam = data.exams.find(item => item.id === record.examId)
    const key = `${record.examId}:${record.studentId}`
    if (!exam || !studentIds.has(record.studentId) || !record.scores || typeof record.scores !== "object" || recordKeys.has(key)) throw new Error("备份成绩关联无效或重复")
    for (const [id, score] of Object.entries(record.scores)) {
      const subject = exam.subjects.find(item => item.id === id)
      if (!subject || (score !== null && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > subject.max))) throw new Error("备份包含无效分数")
    }
    recordKeys.add(key)
  }
  if ((data.classes.length ? !classIds.has(data.selectedClassId) : data.selectedClassId !== "") || (data.exams.length ? !data.exams.some(item => item.id === data.selectedExamId) : data.selectedExamId !== "")) throw new Error("备份的当前班级或考试不存在")
}

export function parseArchive(value: unknown): GradebookArchive {
  if (!value || typeof value !== "object") throw new Error("备份格式不正确")
  const data = value as GradebookArchive
  if (data.version !== 1 || !Array.isArray(data.workspaces) || !data.workspaces.length) throw new Error("不支持此备份版本")
  requireUniqueIds(data.workspaces)
  data.workspaces.forEach(validateWorkspace)
  if (!data.workspaces.some(item => item.id === data.activeWorkspaceId)) throw new Error("当前档案不存在")
  return data
}
