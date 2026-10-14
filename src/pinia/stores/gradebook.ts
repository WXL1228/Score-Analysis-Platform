import type { ClassInitialization, GradebookArchive, ImportRow, SchoolClass, ScoreRecord, Student } from "@/pages/gradebook/types"
import { getGradebookData, setGradebookData } from "@@/utils/local-storage"
import { rankedStudents, totalStatistics } from "@/pages/gradebook/analytics"
import { createDemo, createWorkspace } from "@/pages/gradebook/demo"
import { createId } from "@/pages/gradebook/id"
import { parseArchive, validateWorkspace } from "@/pages/gradebook/validation"

export const useGradebookStore = defineStore("gradebook", () => {
  const loadError = ref<string>("")
  const saveError = ref<string>("")
  const savedAt = ref<string>("")
  let initial: GradebookArchive
  try {
    const cached = getGradebookData()
    const demo = cached ? null : createDemo()
    initial = cached ? parseArchive(cached) : { version: 1, activeWorkspaceId: demo!.id, workspaces: [demo!] }
  } catch {
    const fresh = createWorkspace("恢复工作区")
    initial = { version: 1, activeWorkspaceId: fresh.id, workspaces: [fresh] }
    loadError.value = "已有本地数据无法读取，原缓存已保留。请先下载原缓存或恢复备份，再继续保存。"
  }
  const archive = ref<GradebookArchive>(initial)
  const workspace = computed(() => archive.value.workspaces.find(item => item.id === archive.value.activeWorkspaceId)!)
  const schoolClass = computed(() => workspace.value.classes.find(item => item.id === workspace.value.selectedClassId) ?? { id: "", name: "未选择班级" })
  const exam = computed(() => workspace.value.exams.find(item => item.id === workspace.value.selectedExamId))
  const rows = computed(() => workspace.value.selectedClassId ? rankedStudents(workspace.value, workspace.value.selectedExamId, workspace.value.selectedClassId) : [])
  const stats = computed(() => totalStatistics(rows.value, exam.value))
  const students = computed(() => workspace.value.students.filter(item => item.classId === workspace.value.selectedClassId))

  // 同步保存，确保修改后立即关闭页面也不会丢失尚未刷新的数据。
  const save = () => {
    if (loadError.value) return
    try {
      setGradebookData(archive.value)
      savedAt.value = new Date().toLocaleTimeString("zh-CN", { hour12: false })
      saveError.value = ""
    } catch {
      saveError.value = "浏览器保存失败，可能存储空间不足或被禁用。请立即导出备份。"
    }
  }
  watch(archive, save, { deep: true, flush: "sync" })
  save()

  const addWorkspace = (name: string, teacher: string) => {
    const data = createWorkspace(name.trim(), teacher.trim())
    archive.value.workspaces.push(data)
    archive.value.activeWorkspaceId = data.id
  }

  // 班级、名册、学科与首次考试校验完成后一起保存，失败时不写入部分数据。
  const initializeClass = (input: ClassInitialization): SchoolClass => {
    const data = workspace.value
    const name = input.name.trim()
    if (!name || data.classes.some(item => item.name === name)) throw new Error("班级名称不能为空或与已有班级重复")
    if (!input.exam && input.rows.length) throw new Error("导入成绩时必须提供考试信息")
    if (input.exam && (!input.rows.length || !input.exam.name.trim() || !input.exam.date)) throw new Error("请填写考试名称、日期，并导入有效成绩")
    const group = { id: createId(), name }
    const students: Student[] = input.rows.map(row => ({ id: createId(), number: row.number.trim(), name: row.name.trim(), classId: group.id, focus: false, note: "" }))
    if (new Set(students.map(student => student.number)).size !== students.length) throw new Error("同一班级的学号不能重复")
    const exam = input.exam ? { id: createId(), name: input.exam.name.trim(), date: input.exam.date, subjects: input.exam.subjects.map(subject => ({ ...subject })) } : undefined
    const records: ScoreRecord[] = exam ? input.rows.map((row, index) => ({ examId: exam.id, studentId: students[index].id, scores: Object.fromEntries(exam.subjects.map(subject => [subject.id, row.scores[subject.id] ?? null])) })) : []
    const next = {
      ...data,
      classes: [...data.classes, group],
      subjects: exam && input.setDefaultSubjects ? exam.subjects.map(subject => ({ ...subject })) : data.subjects,
      students: [...data.students, ...students],
      exams: exam ? [...data.exams, exam] : data.exams,
      records: [...data.records, ...records],
      selectedClassId: group.id,
      selectedExamId: exam?.id ?? data.selectedExamId
    }
    validateWorkspace(next)
    const index = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[index] = next
    return group
  }

  // 一次替换档案，避免同步缓存短暂保存到失效的班级或学生关联。
  const deleteClass = (classId: string): boolean => {
    const data = workspace.value
    if (!data.classes.some(item => item.id === classId)) return false
    const classes = data.classes.filter(item => item.id !== classId)
    const studentIds = new Set(data.students.filter(item => item.classId === classId).map(item => item.id))
    const index = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[index] = {
      ...data,
      classes,
      students: data.students.filter(item => !studentIds.has(item.id)),
      records: data.records.filter(item => !studentIds.has(item.studentId)),
      selectedClassId: classes.some(item => item.id === data.selectedClassId) ? data.selectedClassId : classes[0]?.id ?? ""
    }
    return true
  }

  // 考试属于整个档案，删除时清理所有班级的该次成绩。
  const deleteExam = (examId: string): boolean => {
    const data = workspace.value
    if (!data.exams.some(item => item.id === examId)) return false
    const exams = data.exams.filter(item => item.id !== examId)
    const index = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[index] = {
      ...data,
      exams,
      records: data.records.filter(item => item.examId !== examId),
      selectedExamId: exams.some(item => item.id === data.selectedExamId) ? data.selectedExamId : [...exams].sort((a, b) => b.date.localeCompare(a.date))[0]?.id ?? ""
    }
    return true
  }

  const upsertStudent = (student: Student) => {
    const data = workspace.value
    if (!data.classes.some(item => item.id === student.classId)) throw new Error("请先添加班级，再添加学生")
    if (data.students.some(item => item.id !== student.id && item.classId === student.classId && item.number === student.number)) throw new Error("该班级已有相同学号")
    const savedStudent: Student = { id: student.id, number: student.number, name: student.name, classId: student.classId, focus: student.focus, note: student.note }
    const index = data.students.findIndex(item => item.id === student.id)
    if (index < 0) data.students.push(savedStudent)
    else data.students[index] = savedStudent
  }

  const upsertScores = (record: ScoreRecord) => {
    const index = workspace.value.records.findIndex(item => item.examId === record.examId && item.studentId === record.studentId)
    if (index < 0) workspace.value.records.push(record)
    else workspace.value.records[index] = record
  }

  // 导入先在副本内完成，验证或取消不会产生半份数据。
  const importScores = (rows: ImportRow[]) => {
    const data = JSON.parse(JSON.stringify(workspace.value)) as typeof workspace.value
    for (const row of rows) {
      let group = data.classes.find(item => item.name === row.className)
      if (!group) {
        group = { id: createId(), name: row.className }
        data.classes.push(group)
      }
      let student = data.students.find(item => item.classId === group.id && item.number === row.number)
      if (student && student.name !== row.name) throw new Error(`第 ${row.line} 行：学号 ${row.number} 已属于 ${student.name}，请核对姓名`)
      if (!student) {
        student = { id: createId(), number: row.number, name: row.name, classId: group.id, focus: false, note: "" }
        data.students.push(student)
      }
      const index = data.records.findIndex(item => item.examId === data.selectedExamId && item.studentId === student.id)
      const record = { studentId: student.id, examId: data.selectedExamId, scores: { ...(index >= 0 ? data.records[index].scores : {}), ...row.scores } }
      if (index < 0) data.records.push(record)
      else data.records[index] = record
    }
    const index = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[index] = data
  }

  const restore = (value: unknown) => {
    const parsed = parseArchive(value)
    loadError.value = ""
    archive.value = parsed
    save()
  }

  return { archive, workspace, schoolClass, exam, rows, stats, students, savedAt, saveError, loadError, save, addWorkspace, initializeClass, deleteClass, deleteExam, upsertStudent, upsertScores, importScores, restore }
})
