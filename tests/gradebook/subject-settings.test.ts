import { CacheKey } from "@@/constants/cache-key"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it } from "vitest"
import { statistics } from "@/pages/gradebook/analytics"
import { createDemo } from "@/pages/gradebook/demo"
import { buildReport, reportHtml } from "@/pages/gradebook/report"
import { useGradebookStore } from "@/pinia/stores/gradebook"

describe("档案分数线同步考试", () => {
  beforeEach(() => {
    localStorage.clear()
    const data = createDemo()
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify({ version: 1, activeWorkspaceId: data.id, workspaces: [data] }))
    setActivePinia(createPinia())
  })

  it("保存后所有已有考试同步满分、及格和优秀线，成绩保留且预警、统计和报告使用新设置", () => {
    const store = useGradebookStore()
    store.upsertScores({ examId: "exam-3", studentId: "class-1-0", scores: { chinese: 80, math: 90, english: 90, physics: 90, history: 90 } })
    const before = JSON.stringify(store.workspace.records)
    expect(store.rows.find(row => row.id === "class-1-0")?.warnings).not.toContain("语文未及格")
    store.updateSubjectSettings(store.workspace.subjects.map(subject => subject.id === "chinese" ? { ...subject, max: 150, pass: 90, excellent: 130 } : { ...subject }))
    expect(store.workspace.exams.every(exam => exam.subjects[0].max === 150 && exam.subjects[0].pass === 90 && exam.subjects[0].excellent === 130)).toBe(true)
    expect(JSON.stringify(store.workspace.records)).toBe(before)
    const row = store.rows.find(row => row.id === "class-1-0")!
    expect(row.total).toBe(440)
    expect(row.warnings).toContain("语文未及格")
    expect(statistics([row.scores.chinese], store.exam!.subjects[0].pass, store.exam!.subjects[0].excellent)).toMatchObject({ average: 80, passRate: 0, excellentRate: 0 })
    const report = buildReport(store.workspace, "student", row.id)
    expect(report.metrics[0].label).toBe("总分 / 550")
    expect(reportHtml(report)).toContain("80 / 150")
    store.$dispose()
    setActivePinia(createPinia())
    expect(useGradebookStore().exam?.subjects[0].max).toBe(150)
  })

  it("旧缓存和备份恢复自动按各档案自己的设置同步，不要求再次保存", () => {
    const first = createDemo()
    first.subjects[0] = { ...first.subjects[0], max: 150, pass: 90, excellent: 130 }
    const second = createDemo()
    second.id = "second-workspace"
    second.subjects[0] = { ...second.subjects[0], max: 120, pass: 72, excellent: 102 }
    const archive = { version: 1, activeWorkspaceId: first.id, workspaces: [first, second] }
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify(archive))
    const store = useGradebookStore()
    expect(store.subjectSyncWarning).toBe("")
    expect(store.exam?.subjects[0]).toMatchObject({ max: 150, pass: 90, excellent: 130 })
    store.archive.activeWorkspaceId = second.id
    expect(store.exam?.subjects[0]).toMatchObject({ max: 120, pass: 72, excellent: 102 })
    store.restore(archive)
    expect(store.exam?.subjects[0].max).toBe(150)
  })

  it("同名学科标识不同也同步分数线，并保留成绩关联和原考试科目组成", () => {
    const store = useGradebookStore()
    const subject = store.workspace.subjects[0]
    const before = JSON.stringify(store.workspace.records)
    store.updateSubjectSettings([{ ...subject, id: "different-chinese-id", max: 150, pass: 90, excellent: 130 }])
    expect(store.exam?.subjects[0]).toMatchObject({ id: "chinese", max: 150, pass: 90, excellent: 130 })
    expect(store.exam?.subjects).toHaveLength(5)
    expect(JSON.stringify(store.workspace.records)).toBe(before)
  })

  it("新满分低于已有成绩时整体拒绝保存，缓存和成绩保持原样", () => {
    const store = useGradebookStore()
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    expect(() => store.updateSubjectSettings(store.workspace.subjects.map(subject => subject.id === "chinese" ? { ...subject, max: 50, pass: 30, excellent: 45 } : { ...subject }))).toThrow("超过设置的满分 50")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
    expect(store.exam?.subjects[0].max).toBe(100)
  })

  it("旧数据满分冲突时保留整个档案并提示，修正设置后可同步", () => {
    const data = createDemo()
    data.subjects[0] = { ...data.subjects[0], max: 50, pass: 30, excellent: 45 }
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify({ version: 1, activeWorkspaceId: data.id, workspaces: [data] }))
    const store = useGradebookStore()
    expect(store.loadError).toBe("")
    expect(store.workspace.records).toHaveLength(144)
    expect(store.subjectSyncWarning).toContain("超过设置的满分 50")
    expect(store.exam?.subjects[0].max).toBe(100)
    store.updateSubjectSettings(store.workspace.subjects.map(subject => subject.id === "chinese" ? { ...subject, max: 150, pass: 90, excellent: 130 } : { ...subject }))
    expect(store.subjectSyncWarning).toBe("")
    expect(store.exam?.subjects[0].max).toBe(150)
  })
})
