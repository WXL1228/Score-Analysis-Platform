import type { ClassInitialization, Exam, GradebookArchive, ImportRow, SchoolClass, ScoreRecord, Student, Subject, UnitPlanImport, UnitTrackingEntry, UnitTrackingPlan, Workspace } from "@/pages/gradebook/types"
import { getGradebookData, setGradebookData } from "@@/utils/local-storage"
import { rankedStudents, totalStatistics } from "@/pages/gradebook/analytics"
import { createWorkspace } from "@/pages/gradebook/demo"
import { createId } from "@/pages/gradebook/id"
import { parseArchive, validateSubjects, validateWorkspace } from "@/pages/gradebook/validation"

function applySubjectSettings(data: Workspace, subjects: Subject[]): Workspace {
  const error = subjects.length ? validateSubjects(subjects) : null
  if (error) throw new Error(error)
  const configured = subjects.map(subject => ({ ...subject, name: subject.name.trim() }))
  const next = {
    ...data,
    subjects: configured,
    exams: data.exams.map(exam => exam.subjectsCustomized
      ? exam
      : ({
          ...exam,
          subjects: exam.subjects.map((subject) => {
            const setting = configured.find(item => item.id === subject.id) ?? configured.find(item => item.name === subject.name.trim())
            return setting ? { ...subject, max: setting.max, pass: setting.pass, excellent: setting.excellent } : { ...subject }
          })
        }))
  }
  for (const record of next.records) {
    const exam = next.exams.find(item => item.id === record.examId)!
    for (const subject of exam.subjects) {
      const score = record.scores[subject.id]
      if (typeof score === "number" && score > subject.max) throw new Error(`「${exam.name}」的${subject.name}已有 ${score} 分成绩，超过设置的满分 ${subject.max}，请先核对成绩或调整满分`)
    }
  }
  validateWorkspace(next)
  return next
}

export const useGradebookStore = defineStore("gradebook", () => {
  const loadError = ref<string>("")
  const saveError = ref<string>("")
  const savedAt = ref<string>("")
  const subjectSyncWarnings = ref<Record<string, string>>({})
  const alignArchiveSubjects = (data: GradebookArchive): GradebookArchive => {
    subjectSyncWarnings.value = {}
    return {
      ...data,
      workspaces: data.workspaces.map((item) => {
        try {
          return applySubjectSettings(item, item.subjects)
        } catch (error) {
          subjectSyncWarnings.value[item.id] = `分数线尚未同步：${(error as Error).message}`
          return item
        }
      })
    }
  }
  let initial: GradebookArchive
  try {
    const cached = getGradebookData()
    if (cached) {
      initial = alignArchiveSubjects(parseArchive(cached))
    } else {
      const fresh = createWorkspace("我的教学档案")
      initial = { version: 1, activeWorkspaceId: fresh.id, workspaces: [fresh] }
    }
  } catch {
    const fresh = createWorkspace("恢复工作区")
    initial = { version: 1, activeWorkspaceId: fresh.id, workspaces: [fresh] }
    loadError.value = "已有本地数据无法读取，原缓存已保留。请先下载原缓存或恢复备份，再继续保存。"
  }
  const archive = ref<GradebookArchive>(initial)
  const workspace = computed(() => archive.value.workspaces.find(item => item.id === archive.value.activeWorkspaceId)!)
  const subjectSyncWarning = computed(() => subjectSyncWarnings.value[workspace.value.id] ?? "")
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

  const deleteWorkspace = (workspaceId: string): boolean => {
    const data = archive.value
    if (!data.workspaces.some(item => item.id === workspaceId)) return false
    const workspaces = data.workspaces.filter(item => item.id !== workspaceId)
    if (!workspaces.length) workspaces.push(createWorkspace("我的教学档案"))
    const next = { ...data, workspaces, activeWorkspaceId: data.activeWorkspaceId === workspaceId ? workspaces[0].id : data.activeWorkspaceId }
    parseArchive(next)
    archive.value = next
    delete subjectSyncWarnings.value[workspaceId]
    return true
  }

  const updateSubjectSettings = (subjects: Subject[]) => {
    const data = workspace.value
    const next = applySubjectSettings(data, subjects)
    const index = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[index] = next
    delete subjectSyncWarnings.value[data.id]
  }

  // 班级、名册、学科与首次考试校验完成后一起保存，失败时不写入部分数据。
  const initializeClass = (input: ClassInitialization): SchoolClass => {
    const data = workspace.value
    const name = input.name.trim()
    if (!name || data.classes.some(item => item.name === name)) throw new Error("班级名称不能为空或与已有班级重复")
    if (!input.exam && input.rows.length) throw new Error("导入成绩时必须提供考试信息")
    if (input.exam && (!input.rows.length || !input.exam.name.trim() || !input.exam.date)) throw new Error("请填写考试名称、日期，并导入有效成绩")
    const group = { id: createId(), name }
    const usedNumbers = new Set(input.rows.map(row => row.number.trim()).filter(Boolean))
    let automaticNumber = 1
    const students: Student[] = input.rows.map((row) => {
      let number = row.number.trim()
      if (!number) {
        while (usedNumbers.has(`自动${String(automaticNumber).padStart(3, "0")}`)) automaticNumber++
        number = `自动${String(automaticNumber++).padStart(3, "0")}`
        usedNumbers.add(number)
      }
      return { id: createId(), number, name: row.name.trim(), gender: row.gender, classId: group.id, focus: false, note: "" }
    })
    if (new Set(students.map(student => student.number)).size !== students.length) throw new Error("同一班级的学号不能重复")
    const exam = input.exam ? { id: createId(), name: input.exam.name.trim(), date: input.exam.date, subjects: input.exam.subjects.map(subject => ({ ...subject })), subjectsCustomized: true } : undefined
    const records: ScoreRecord[] = exam ? input.rows.map((row, index) => ({ examId: exam.id, studentId: students[index].id, scores: Object.fromEntries(exam.subjects.map(subject => [subject.id, row.scores[subject.id] ?? null])) })) : []
    let next = {
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
    if (input.setDefaultSubjects) next = applySubjectSettings(next, next.subjects)
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
      unitPlans: data.unitPlans?.filter(item => item.classId !== classId),
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

  // 自定义考试独立保存学科与分数线，调整科目时同步整理该考试全部班级的成绩。
  const upsertExam = (input: Exam) => {
    const error = validateSubjects(input.subjects)
    if (error) throw new Error(error)
    const data = workspace.value
    const exam: Exam = { ...input, name: input.name.trim(), subjects: input.subjects.map(subject => ({ ...subject, name: subject.name.trim() })), subjectsCustomized: true }
    const index = data.exams.findIndex(item => item.id === exam.id)
    const exams = [...data.exams]
    if (index < 0) exams.push(exam)
    else exams[index] = exam
    const records = data.records.map((record) => {
      if (record.examId !== exam.id) return record
      const scores = Object.fromEntries(exam.subjects.map((subject) => {
        const score = record.scores[subject.id] ?? null
        if (typeof score === "number" && score > subject.max) throw new Error(`「${exam.name}」的${subject.name}已有 ${score} 分成绩，超过设置的满分 ${subject.max}，请先核对成绩或调整满分`)
        return [subject.id, score]
      }))
      return { ...record, scores }
    })
    const next = { ...data, exams, records, selectedExamId: index < 0 ? exam.id : data.selectedExamId }
    validateWorkspace(next)
    const workspaceIndex = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[workspaceIndex] = next
  }

  const upsertStudent = (student: Student) => {
    const data = workspace.value
    if (!data.classes.some(item => item.id === student.classId)) throw new Error("请先添加班级，再添加学生")
    if (data.students.some(item => item.id !== student.id && item.classId === student.classId && item.number === student.number)) throw new Error("该班级已有相同学号")
    const savedStudent: Student = { id: student.id, number: student.number, name: student.name, gender: student.gender, classId: student.classId, focus: student.focus, note: student.note }
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
    const exam = data.exams.find(item => item.id === data.selectedExamId)
    if (!exam) throw new Error("请先选择考试，再导入成绩")
    for (const row of rows) {
      const scores = Object.fromEntries(Object.entries(row.scores).filter(([id]) => exam.subjects.some(subject => subject.id === id)))
      if (!Object.keys(scores).length) throw new Error(`第 ${row.line} 行：没有匹配本次考试的学科成绩`)
      for (const [id, score] of Object.entries(scores)) {
        const subject = exam.subjects.find(item => item.id === id)!
        if (score !== null && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > subject.max)) throw new Error(`第 ${row.line} 行：${subject.name}须为 0～${subject.max} 的数字或缺考`)
      }
      let group = data.classes.find(item => item.name === row.className)
      if (!group) {
        group = { id: createId(), name: row.className }
        data.classes.push(group)
      }
      if (!data.selectedClassId) data.selectedClassId = group.id
      const matchingNames = data.students.filter(item => item.classId === group.id && item.name === row.name)
      if (!row.number && matchingNames.length > 1) throw new Error(`第 ${row.line} 行：同班姓名 ${row.name} 对应多个学生，请填写学号`)
      let student = row.number ? data.students.find(item => item.classId === group.id && item.number === row.number) : matchingNames[0]
      if (student && student.name !== row.name) throw new Error(`第 ${row.line} 行：学号 ${row.number} 已属于 ${student.name}，请核对姓名`)
      if (!student) {
        let automaticNumber = 1
        while (data.students.some(item => item.classId === group.id && item.number === `自动${String(automaticNumber).padStart(3, "0")}`) || rows.some(item => item.className === row.className && item.number === `自动${String(automaticNumber).padStart(3, "0")}`)) automaticNumber++
        student = { id: createId(), number: row.number || `自动${String(automaticNumber).padStart(3, "0")}`, name: row.name, classId: group.id, focus: false, note: "" }
        data.students.push(student)
      }
      if (row.gender !== undefined) student.gender = row.gender
      const index = data.records.findIndex(item => item.examId === data.selectedExamId && item.studentId === student.id)
      const record = { studentId: student.id, examId: data.selectedExamId, scores: { ...(index >= 0 ? data.records[index].scores : {}), ...scores } }
      if (index < 0) data.records.push(record)
      else data.records[index] = record
    }
    validateWorkspace(data)
    const index = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[index] = data
  }

  // 单元目标保留独立教学记录，不从无日期的表格推断普通考试。
  const importUnitPlan = (input: UnitPlanImport): UnitTrackingPlan => {
    const data = JSON.parse(JSON.stringify(workspace.value)) as Workspace
    const name = input.name.trim()
    const className = input.className.trim()
    if (!name || !className || !input.rows.length) throw new Error("请填写计划名称、班级名称，并导入学生数据")
    let group = data.classes.find(item => item.name === className)
    if (!group) {
      group = { id: createId(), name: className }
      data.classes.push(group)
    }
    const usedNumbers = new Set([
      ...data.students.filter(item => item.classId === group.id).map(item => item.number),
      ...input.rows.map(row => row.number.trim()).filter(Boolean)
    ])
    let automaticNumber = 1
    const entries: UnitTrackingEntry[] = input.rows.map((row) => {
      const number = row.number.trim()
      const studentName = row.name.trim()
      if (!studentName) throw new Error(`第 ${row.line} 行：学生姓名不能为空`)
      const matchingNames = data.students.filter(item => item.classId === group.id && item.name === studentName)
      if (!number && matchingNames.length > 1) throw new Error(`第 ${row.line} 行：同班姓名 ${studentName} 对应多个学生，请填写学号`)
      let student = number ? data.students.find(item => item.classId === group.id && item.number === number) : matchingNames[0]
      if (student && student.name !== studentName) throw new Error(`第 ${row.line} 行：学号 ${number} 已属于 ${student.name}，请核对姓名`)
      if (!student) {
        while (usedNumbers.has(`自动${String(automaticNumber).padStart(3, "0")}`)) automaticNumber++
        const newNumber = number || `自动${String(automaticNumber++).padStart(3, "0")}`
        usedNumbers.add(newNumber)
        student = { id: createId(), number: newNumber, name: studentName, classId: group.id, focus: false, note: "" }
        data.students.push(student)
      }
      if (row.gender !== undefined) student.gender = row.gender
      return { studentId: student.id, baseline: row.baseline, level: row.level.trim(), task: row.task.trim(), scores: Object.fromEntries(Object.entries(row.scores).map(([id, scores]) => [id, { ...scores }])) }
    })
    const plans = data.unitPlans ?? []
    const existingIndex = plans.findIndex(item => item.classId === group.id && item.subjectId === input.subjectId && item.name === name)
    const plan: UnitTrackingPlan = {
      id: existingIndex < 0 ? createId() : plans[existingIndex].id,
      name,
      classId: group.id,
      subjectId: input.subjectId,
      periods: input.periods.map(period => ({ ...period, name: period.name.trim() })),
      entries
    }
    if (existingIndex < 0) plans.push(plan)
    else plans[existingIndex] = plan
    data.unitPlans = plans
    data.selectedClassId = group.id
    validateWorkspace(data)
    const index = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[index] = data
    return plan
  }

  const saveUnitEntry = (planId: string, entry: UnitTrackingEntry) => {
    const data = JSON.parse(JSON.stringify(workspace.value)) as Workspace
    const plan = data.unitPlans?.find(item => item.id === planId)
    if (!plan) throw new Error("单元计划不存在")
    const index = plan.entries.findIndex(item => item.studentId === entry.studentId)
    const saved = { ...entry, level: entry.level.trim(), task: entry.task.trim(), scores: Object.fromEntries(Object.entries(entry.scores).map(([id, scores]) => [id, { ...scores }])) }
    if (index < 0) plan.entries.push(saved)
    else plan.entries[index] = saved
    validateWorkspace(data)
    const workspaceIndex = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[workspaceIndex] = data
  }

  const deleteUnitPlan = (planId: string): boolean => {
    const data = workspace.value
    if (!data.unitPlans?.some(item => item.id === planId)) return false
    const index = archive.value.workspaces.findIndex(item => item.id === data.id)
    archive.value.workspaces[index] = { ...data, unitPlans: data.unitPlans.filter(item => item.id !== planId) }
    return true
  }

  const restore = (value: unknown) => {
    const parsed = parseArchive(value)
    loadError.value = ""
    archive.value = alignArchiveSubjects(parsed)
    save()
  }

  return { archive, workspace, schoolClass, exam, rows, stats, students, savedAt, saveError, loadError, subjectSyncWarning, save, addWorkspace, deleteWorkspace, updateSubjectSettings, initializeClass, deleteClass, deleteExam, upsertExam, upsertStudent, upsertScores, importScores, importUnitPlan, saveUnitEntry, deleteUnitPlan, restore }
})
