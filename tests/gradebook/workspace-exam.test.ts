import type { Exam } from "@/pages/gradebook/types"
import { CacheKey } from "@@/constants/cache-key"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createDemo } from "@/pages/gradebook/demo"
import { parseScoreMatrix } from "@/pages/gradebook/files"
import { parseArchive } from "@/pages/gradebook/validation"
import { useGradebookStore } from "@/pinia/stores/gradebook"

const math = { id: "math", name: "数学", max: 150, pass: 90, excellent: 128 }
const geography = { id: "geography", name: "地理", max: 50, pass: 30, excellent: 45 }

describe("教学档案删除与独立考试配置", () => {
  beforeEach(() => {
    localStorage.clear()
    const data = createDemo()
    data.demo = false
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify({ version: 1, activeWorkspaceId: data.id, workspaces: [data] }))
    setActivePinia(createPinia())
  })

  it("删除当前档案及其班级、成绩和单元计划，并选中剩余首个档案", () => {
    const store = useGradebookStore()
    const id = store.workspace.id
    const student = store.students[0]
    store.importUnitPlan({ name: "待删除的单元计划", className: store.schoolClass.name, subjectId: "math", periods: [{ id: "unit-1", name: "1单元" }], rows: [{ number: student.number, name: student.name, baseline: 70, level: "A", task: "巩固", scores: { "unit-1": { target: 80, actual: 90 } }, line: 2 }] })
    store.addWorkspace("保留档案甲", "甲老师")
    const firstId = store.workspace.id
    store.addWorkspace("保留档案乙", "乙老师")
    const otherIds = store.archive.workspaces.filter(item => item.id !== id).map(item => item.id)
    store.archive.activeWorkspaceId = id
    expect(store.deleteWorkspace(id)).toBe(true)
    expect(store.archive.workspaces.map(item => item.id)).toEqual(otherIds)
    expect(store.workspace.id).toBe(firstId)
    expect(store.archive.workspaces.flatMap(item => item.unitPlans ?? [])).toEqual([])
    expect(() => parseArchive(JSON.parse(localStorage.getItem(CacheKey.GRADEBOOK_DATA)!))).not.toThrow()
  })

  it("删除非当前档案保持当前所有数据，不存在的档案不触发保存", () => {
    const store = useGradebookStore()
    const id = store.workspace.id
    const data = JSON.stringify(store.workspace)
    store.addWorkspace("待删除的其他档案", "老师")
    const otherId = store.workspace.id
    store.archive.activeWorkspaceId = id
    expect(store.deleteWorkspace(otherId)).toBe(true)
    expect(JSON.stringify(store.workspace)).toBe(data)
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    expect(store.deleteWorkspace("missing")).toBe(false)
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
  })

  it("删除最后档案创建全空档案并清理旧同步警告，刷新后不恢复已删除数据", () => {
    const data = createDemo()
    data.subjects[0] = { ...data.subjects[0], max: 50, pass: 30, excellent: 45 }
    const store = useGradebookStore()
    store.restore({ version: 1, activeWorkspaceId: data.id, workspaces: [data] })
    expect(store.subjectSyncWarning).not.toBe("")
    store.deleteWorkspace(data.id)
    const id = store.workspace.id
    expect(id).not.toBe(data.id)
    expect(store.workspace.name).toBe("我的教学档案")
    expect(store.workspace.demo).toBe(false)
    expect(store.workspace.subjects).toEqual([])
    expect(store.workspace.classes).toEqual([])
    expect(store.workspace.students).toEqual([])
    expect(store.workspace.exams).toEqual([])
    expect(store.workspace.records).toEqual([])
    expect(store.workspace.unitPlans ?? []).toEqual([])
    expect(store.subjectSyncWarning).toBe("")
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.loadError).toBe("")
    expect(reopened.workspace.id).toBe(id)
    expect(reopened.workspace.classes).toEqual([])
  })

  it("每次删除仅写一次完整有效缓存，删除前的备份仍可恢复", () => {
    const store = useGradebookStore()
    const backup = JSON.parse(JSON.stringify(store.archive))
    const writes: unknown[] = []
    const original = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === CacheKey.GRADEBOOK_DATA) writes.push(JSON.parse(value))
      original(key, value)
    })
    try {
      store.deleteWorkspace(store.workspace.id)
      expect(writes).toHaveLength(1)
      expect(() => parseArchive(writes[0])).not.toThrow()
    } finally {
      spy.mockRestore()
    }
    store.restore(backup)
    expect(store.archive).toEqual(backup)
    expect(store.workspace.records).toHaveLength(144)
  })

  it("新建考试可使用档案之外的学科，设置独立标识且不保存调用方对象引用", () => {
    const store = useGradebookStore()
    const configured: Exam = { id: "custom-exam", name: " 自定义考试 ", date: "2026-10-15", subjects: [{ ...geography, name: " 地理 " }] }
    const defaults = JSON.stringify(store.workspace.subjects)
    store.upsertExam(configured)
    expect(store.exam).toMatchObject({ id: "custom-exam", name: "自定义考试", subjectsCustomized: true, subjects: [geography] })
    expect(JSON.stringify(store.workspace.subjects)).toBe(defaults)
    configured.subjects[0].max = 500
    expect(store.exam?.subjects[0].max).toBe(50)
    expect(() => parseArchive(store.archive)).not.toThrow()
  })

  it("修改考试科目保留选中科目的分数、移除未选科目并为新科目填空，不影响其他考试", () => {
    const store = useGradebookStore()
    const defaults = JSON.stringify(store.workspace.subjects)
    const records = JSON.stringify(store.workspace.records.filter(record => record.examId !== "exam-3"))
    const previous = store.workspace.records.filter(record => record.examId === "exam-3").map(record => record.scores.math)
    store.upsertExam({ ...store.exam!, subjects: [math, geography] })
    const updated = store.workspace.records.filter(record => record.examId === "exam-3")
    expect(updated).toHaveLength(48)
    expect(updated.map(record => record.scores.math)).toEqual(previous)
    expect(updated.every(record => Object.keys(record.scores).join(",") === "math,geography" && record.scores.geography === null)).toBe(true)
    expect(JSON.stringify(store.workspace.records.filter(record => record.examId !== "exam-3"))).toBe(records)
    expect(JSON.stringify(store.workspace.subjects)).toBe(defaults)
  })

  it("独立考试不受档案分数线修改影响，旧考试继续同步，刷新与恢复保留独立配置", () => {
    const store = useGradebookStore()
    store.upsertExam({ ...store.exam!, subjects: [math] })
    store.upsertScores({ examId: "exam-3", studentId: "class-1-0", scores: { math: 140 } })
    store.updateSubjectSettings(store.workspace.subjects.map(subject => subject.id === "math" ? { ...subject, max: 120, pass: 72, excellent: 102 } : subject))
    expect(store.exam?.subjects).toEqual([math])
    expect(store.workspace.exams.filter(exam => exam.id !== "exam-3").every(exam => exam.subjects.find(subject => subject.id === "math")?.max === 120)).toBe(true)
    expect(store.rows.find(row => row.id === "class-1-0")?.scores.math).toBe(140)
    const backup = JSON.parse(JSON.stringify(store.archive))
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.loadError).toBe("")
    expect(reopened.subjectSyncWarning).toBe("")
    expect(reopened.exam?.subjects).toEqual([math])
    reopened.restore(backup)
    expect(reopened.exam?.subjects).toEqual([math])
  })

  it("编辑非当前考试保持当前选择，降满分或无效科目不能留下部分成绩与配置", () => {
    const store = useGradebookStore()
    const current = store.workspace.selectedExamId
    store.upsertExam({ ...store.workspace.exams[0], name: "编辑历史考试", subjects: [math] })
    expect(store.workspace.selectedExamId).toBe(current)
    store.upsertExam({ ...store.exam!, subjects: [math] })
    store.upsertScores({ examId: "exam-3", studentId: "class-1-0", scores: { math: 140 } })
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    expect(() => store.upsertExam({ ...store.exam!, name: "拒绝此次更名", subjects: [{ ...math, max: 130 }] })).toThrow("超过设置的满分 130")
    expect(() => store.upsertExam({ ...store.exam!, subjects: [] })).toThrow("至少保留一门学科")
    expect(() => store.upsertExam({ ...store.exam!, subjects: [math, { ...math }] })).toThrow("重复")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
  })

  it("考试更新仅写一份有效缓存，其他教师档案不变", () => {
    const store = useGradebookStore()
    const id = store.workspace.id
    store.addWorkspace("其他教师", "老师")
    const other = JSON.stringify(store.workspace)
    store.archive.activeWorkspaceId = id
    const writes: unknown[] = []
    const original = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === CacheKey.GRADEBOOK_DATA) writes.push(JSON.parse(value))
      original(key, value)
    })
    try {
      store.upsertExam({ ...store.exam!, subjects: [math] })
      expect(writes).toHaveLength(1)
      expect(() => parseArchive(writes[0])).not.toThrow()
      expect(JSON.stringify(store.archive.workspaces.find(item => item.id !== id))).toBe(other)
    } finally {
      spy.mockRestore()
    }
  })

  it("旧缓存与显式false继续同步，独立标识必须为布尔值，坏备份不能覆盖数据", () => {
    const store = useGradebookStore()
    const data = createDemo()
    data.subjects[1] = { ...data.subjects[1], max: 120, pass: 72, excellent: 102 }
    data.exams[0].subjectsCustomized = false
    data.exams[2].subjectsCustomized = true
    data.exams[2].subjects = [math]
    data.records = data.records.map(record => record.examId === "exam-3" ? { ...record, scores: { math: record.scores.math } } : record)
    store.restore({ version: 1, activeWorkspaceId: data.id, workspaces: [data] })
    expect(store.workspace.exams[0].subjects.find(subject => subject.id === "math")?.max).toBe(120)
    expect(store.workspace.exams[1].subjects.find(subject => subject.id === "math")?.max).toBe(120)
    expect(store.exam?.subjects).toEqual([math])
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    const invalid = JSON.parse(before!)
    invalid.workspaces[0].exams[0].subjectsCustomized = "yes"
    expect(() => store.restore(invalid)).toThrow("考试数据无效")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
  })

  it("导入按当前考试的科目与满分解析，档案中其他科目不进入该考试", () => {
    const store = useGradebookStore()
    store.upsertExam({ ...store.exam!, subjects: [math, geography] })
    const parsed = parseScoreMatrix([["学号", "姓名", "数学", "地理", "英语"], ["101", "陈星宇", 120, 45, 99]], store.exam!, store.schoolClass.name)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0].scores).toEqual({ math: 120, geography: 45 })
    store.importScores(parsed.rows)
    expect(store.workspace.records.find(record => record.examId === "exam-3" && record.studentId === "class-1-0")?.scores).toEqual({ math: 120, geography: 45 })
  })

  it("导入写入边界忽略未知科目，保留未上传的已配置分数和真实零分", () => {
    const store = useGradebookStore()
    store.upsertExam({ ...store.exam!, subjects: [math, geography] })
    store.upsertScores({ examId: "exam-3", studentId: "class-1-0", scores: { math: 120, geography: 45 } })
    store.importScores([{ line: 2, number: "101", name: "陈星宇", className: store.schoolClass.name, scores: { math: 0, english: 99, unknown: 999 } }])
    expect(store.workspace.records.find(record => record.examId === "exam-3" && record.studentId === "class-1-0")?.scores).toEqual({ math: 0, geography: 45 })
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    expect(() => store.importScores([{ line: 2, number: "new", name: "新增学生", className: "不应新增班级", scores: { unknown: 99 } }])).toThrow("没有匹配本次考试")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
  })

  it("旧预览分数超过新满分时整批回滚，无考试时不能导入", () => {
    const store = useGradebookStore()
    store.upsertExam({ ...store.exam!, subjects: [{ ...math, max: 120, excellent: 102 }] })
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    expect(() => store.importScores([
      { line: 2, number: "new", name: "临时新学生", className: "临时新班级", scores: { math: 80 } },
      { line: 3, number: "101", name: "陈星宇", className: store.schoolClass.name, scores: { math: 140 } }
    ])).toThrow("0～120")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
    for (const exam of [...store.workspace.exams]) store.deleteExam(exam.id)
    const withoutExam = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    expect(() => store.importScores([{ line: 2, number: "101", name: "陈星宇", className: store.schoolClass.name, scores: { math: 80 } }])).toThrow("请先选择考试")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(withoutExam)
  })
})
