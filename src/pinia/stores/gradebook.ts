import type { GradebookArchive, ImportRow, ScoreRecord, Student } from "@/pages/gradebook/types"
import { getGradebookData, setGradebookData } from "@@/utils/local-storage"
import { rankedStudents, totalStatistics } from "@/pages/gradebook/analytics"
import { createDemo, createWorkspace } from "@/pages/gradebook/demo"
import { parseArchive } from "@/pages/gradebook/validation"
import { pinia } from "@/pinia"

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
  const schoolClass = computed(() => workspace.value.classes.find(item => item.id === workspace.value.selectedClassId)!)
  const exam = computed(() => workspace.value.exams.find(item => item.id === workspace.value.selectedExamId))
  const rows = computed(() => rankedStudents(workspace.value, workspace.value.selectedExamId, workspace.value.selectedClassId))
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

  const upsertStudent = (student: Student) => {
    const data = workspace.value
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
        group = { id: crypto.randomUUID(), name: row.className }
        data.classes.push(group)
      }
      let student = data.students.find(item => item.classId === group.id && item.number === row.number)
      if (student && student.name !== row.name) throw new Error(`第 ${row.line} 行：学号 ${row.number} 已属于 ${student.name}，请核对姓名`)
      if (!student) {
        student = { id: crypto.randomUUID(), number: row.number, name: row.name, classId: group.id, focus: false, note: "" }
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

  return { archive, workspace, schoolClass, exam, rows, stats, students, savedAt, saveError, loadError, save, addWorkspace, upsertStudent, upsertScores, importScores, restore }
})

/**
 * @description 在 SPA 应用中可用于在 pinia 实例被激活前使用 store
 * @description 在 SSR 应用中可用于在 setup 外使用 store
 */
export function useGradebookStoreOutside() {
  return useGradebookStore(pinia)
}
