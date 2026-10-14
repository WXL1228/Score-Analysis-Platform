import { CacheKey } from "@@/constants/cache-key"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseArchive } from "@/pages/gradebook/validation"
import { useGradebookStore } from "@/pinia/stores/gradebook"

describe("班级与考试删除", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it("删除当前班级清理其学生及历次成绩，自动切换到其他班级", () => {
    const store = useGradebookStore()
    const otherStudents = JSON.parse(JSON.stringify(store.workspace.students.filter(item => item.classId === "class-2")))
    const otherIds = new Set(otherStudents.map((item: { id: string }) => item.id))
    const otherRecords = JSON.parse(JSON.stringify(store.workspace.records.filter(item => otherIds.has(item.studentId))))
    expect(store.deleteClass("class-1")).toBe(true)
    expect(store.schoolClass.id).toBe("class-2")
    expect(store.workspace.classes).toHaveLength(1)
    expect(store.workspace.students).toEqual(otherStudents)
    expect(store.workspace.records).toEqual(otherRecords)
    expect(store.workspace.exams).toHaveLength(3)
    expect(store.rows.every(row => row.gradeRank === row.rank)).toBe(true)
  })

  it("删除非当前班级不改变当前选择和本班学生", () => {
    const store = useGradebookStore()
    const ids = store.students.map(item => item.id)
    store.deleteClass("class-2")
    expect(store.schoolClass.id).toBe("class-1")
    expect(store.students.map(item => item.id)).toEqual(ids)
    expect(store.workspace.selectedExamId).toBe("exam-3")
  })

  it("最后一个班级可删除，空档案刷新与备份恢复均正常", () => {
    const store = useGradebookStore()
    store.deleteClass("class-1")
    store.deleteClass("class-2")
    expect(store.workspace.classes).toEqual([])
    expect(store.workspace.students).toEqual([])
    expect(store.workspace.records).toEqual([])
    expect(store.schoolClass.id).toBe("")
    expect(store.rows).toEqual([])
    const cached = parseArchive(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!))
    expect(cached.workspaces[0].selectedClassId).toBe("")
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.loadError).toBe("")
    expect(reopened.workspace.classes).toEqual([])
    reopened.workspace.classes.push({ id: "new-class", name: "新班级" })
    reopened.workspace.selectedClassId = "new-class"
    reopened.upsertStudent({ id: "new-student", name: "新学生", number: "001", classId: "new-class", focus: false, note: "" })
    expect(reopened.students).toHaveLength(1)
  })

  it("删除当前考试清理所有班级的该次成绩，并切换到最近考试", () => {
    const store = useGradebookStore()
    const studentIds = store.workspace.students.map(item => item.id)
    store.workspace.exams.reverse()
    expect(store.deleteExam("exam-3")).toBe(true)
    expect(store.workspace.selectedExamId).toBe("exam-2")
    expect(store.workspace.records).toHaveLength(96)
    expect(store.workspace.records.every(item => item.examId !== "exam-3")).toBe(true)
    expect(store.workspace.students.map(item => item.id)).toEqual(studentIds)
    expect(store.workspace.classes).toHaveLength(2)
  })

  it("删除历史考试保留当前选择，进退步对比自动使用剩余历史", () => {
    const store = useGradebookStore()
    store.deleteExam("exam-2")
    expect(store.workspace.selectedExamId).toBe("exam-3")
    expect(store.rows.find(row => row.number === "101")?.previousRank).toBe(2)
    expect(store.rows.find(row => row.number === "101")?.change).toBe(1)
  })

  it("最后一次考试可删除并恢复为空考试状态", () => {
    const store = useGradebookStore()
    for (const id of ["exam-1", "exam-2", "exam-3"]) store.deleteExam(id)
    expect(store.workspace.exams).toEqual([])
    expect(store.workspace.selectedExamId).toBe("")
    expect(store.exam).toBeUndefined()
    expect(store.workspace.records).toEqual([])
    expect(store.students).toHaveLength(24)
    const cached = parseArchive(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!))
    store.restore(cached)
    expect(store.loadError).toBe("")
    expect(store.exam).toBeUndefined()
  })

  it("删除不会产生无效的中间缓存，其他教师档案保持不变", () => {
    const store = useGradebookStore()
    const demoId = store.workspace.id
    store.addWorkspace("另一位教师", "李老师")
    const otherData = JSON.stringify(store.workspace)
    store.archive.activeWorkspaceId = demoId
    const writes: unknown[] = []
    const original = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === CacheKey.GRADEBOOK_DATA) writes.push(JSON.parse(value))
      original(key, value)
    })
    try {
      store.deleteClass("class-1")
      store.deleteClass("class-2")
      store.deleteExam("exam-3")
      expect(writes).toHaveLength(3)
      for (const value of writes) expect(() => parseArchive(value)).not.toThrow()
      expect(JSON.stringify(store.archive.workspaces.find(item => item.id !== demoId))).toBe(otherData)
    } finally {
      spy.mockRestore()
    }
  })

  it("不存在的对象不会触发删除，空班级不能新增悬空学生", () => {
    const store = useGradebookStore()
    const before = JSON.stringify(store.archive)
    expect(store.deleteClass("missing")).toBe(false)
    expect(store.deleteExam("missing")).toBe(false)
    expect(JSON.stringify(store.archive)).toBe(before)
    store.deleteClass("class-1")
    store.deleteClass("class-2")
    expect(() => store.upsertStudent({ id: "orphan", number: "001", name: "悬空学生", classId: "", focus: false, note: "" })).toThrow("请先添加班级")
  })
})
