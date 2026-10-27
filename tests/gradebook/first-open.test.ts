import { CacheKey } from "@@/constants/cache-key"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it } from "vitest"
import { createDemo, createWorkspace } from "@/pages/gradebook/demo"
import { parseArchive } from "@/pages/gradebook/validation"
import { useGradebookStore } from "@/pinia/stores/gradebook"

describe("首次打开空白档案", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it("无缓存时只创建一个真实空档案，不带学科、班级、学生、考试或单元计划", () => {
    const store = useGradebookStore()
    expect(store.loadError).toBe("")
    expect(store.archive.workspaces).toHaveLength(1)
    expect(store.workspace.name).toBe("我的教学档案")
    expect(store.workspace.demo).toBe(false)
    expect(store.workspace.subjects).toEqual([])
    expect(store.workspace.classes).toEqual([])
    expect(store.workspace.students).toEqual([])
    expect(store.workspace.exams).toEqual([])
    expect(store.workspace.records).toEqual([])
    expect(store.workspace.unitPlans ?? []).toEqual([])
    expect(store.workspace.selectedClassId).toBe("")
    expect(store.workspace.selectedExamId).toBe("")
    expect(store.rows).toEqual([])
    expect(store.exam).toBeUndefined()
    expect(store.stats.count).toBe(0)
    expect(() => parseArchive(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!))).not.toThrow()
  })

  it("首次空档案立即保存，关闭后重开保留同一个空档案", () => {
    const store = useGradebookStore()
    const saved = JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!)
    const id = store.workspace.id
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.loadError).toBe("")
    expect(reopened.workspace.id).toBe(id)
    expect(reopened.archive).toEqual(saved)
    expect(reopened.workspace.demo).toBe(false)
    expect(reopened.workspace.subjects).toEqual([])
    expect(reopened.workspace.students).toEqual([])
    expect(reopened.workspace.exams).toEqual([])
  })

  it("空档案工厂和新建档案不预填学科，新档案不沿用原档案配置", () => {
    expect(createWorkspace("独立空档案").subjects).toEqual([])
    const store = useGradebookStore()
    store.updateSubjectSettings([{ id: "math", name: "数学", max: 150, pass: 90, excellent: 128 }])
    const previousId = store.workspace.id
    store.addWorkspace("另一个教学档案", "测试老师")
    expect(store.workspace.subjects).toEqual([])
    expect(store.workspace.classes).toEqual([])
    expect(store.archive.workspaces.find(item => item.id === previousId)?.subjects[0].max).toBe(150)
    expect(() => parseArchive(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!))).not.toThrow()
  })

  it("没有学科的备份可恢复，恢复后保持为空且不触发分数线同步警告", () => {
    const store = useGradebookStore()
    const backup = JSON.parse(JSON.stringify(store.archive))
    expect(backup.workspaces[0].subjects).toEqual([])
    store.updateSubjectSettings([{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }])
    store.restore(backup)
    expect(store.loadError).toBe("")
    expect(store.subjectSyncWarning).toBe("")
    expect(store.workspace.subjects).toEqual([])
    expect(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!)).toEqual(backup)
  })

  it("可保存空学科设置，重开后仍为空且保留已有考试成绩和学科快照", () => {
    const data = createDemo()
    data.demo = false
    const store = useGradebookStore()
    store.restore({ version: 1, activeWorkspaceId: data.id, workspaces: [data] })
    const records = JSON.parse(JSON.stringify(store.workspace.records))
    const exams = JSON.parse(JSON.stringify(store.workspace.exams))
    store.updateSubjectSettings([])
    expect(store.workspace.subjects).toEqual([])
    expect(store.subjectSyncWarning).toBe("")
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.loadError).toBe("")
    expect(reopened.subjectSyncWarning).toBe("")
    expect(reopened.workspace.subjects).toEqual([])
    expect(reopened.workspace.records).toEqual(records)
    expect(reopened.workspace.exams).toEqual(exams)
  })

  it("允许档案没有学科，但普通考试仍必须配置至少一门有效学科", () => {
    const data = createWorkspace("考试校验档案")
    data.exams.push({ id: "invalid-exam", name: "空科目考试", date: "2026-10-15", subjects: [] })
    data.selectedExamId = "invalid-exam"
    expect(() => parseArchive({ version: 1, activeWorkspaceId: data.id, workspaces: [data] })).toThrow("考试数据无效")
  })

  it.each([false, true])("已有缓存 demo=%s 的档案、成绩和单元计划保持原样", (demo) => {
    const data = createDemo()
    data.demo = demo
    data.records[0].scores.math = 97
    data.unitPlans = [{
      id: "saved-unit-plan",
      name: "已保存的数学单元",
      classId: data.classes[0].id,
      subjectId: "math",
      periods: [{ id: "unit-1", name: "1单元" }],
      entries: [{ studentId: data.students[0].id, baseline: 70, level: "B", task: "基础巩固", scores: { "unit-1": { target: 80, actual: 75 } } }]
    }]
    const saved = { version: 1, activeWorkspaceId: data.id, workspaces: [data] }
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify(saved))
    const store = useGradebookStore()
    expect(store.loadError).toBe("")
    expect(store.archive).toEqual(saved)
    expect(store.workspace.records[0].scores.math).toBe(97)
    expect(store.workspace.unitPlans?.[0].entries[0].task).toBe("基础巩固")
    expect(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!)).toEqual(saved)
  })
})
