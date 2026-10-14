import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWorkspace } from "@/pages/gradebook/demo"
import { createId } from "@/pages/gradebook/id"
import { useGradebookStore } from "@/pinia/stores/gradebook"

describe("公网 HTTP 的业务 ID 兼容性", () => {
  beforeEach(() => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal("crypto", { getRandomValues })
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => vi.unstubAllGlobals())

  it("hTTP 中生成的 ID 保持 UUID v4 格式，批量生成不会重复", () => {
    const ids = Array.from({ length: 1000 }, () => createId())
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  })

  it("没有 randomUUID 时仍可首次启动并创建新的教学档案", () => {
    const store = useGradebookStore()
    expect(store.workspace.demo).toBe(true)
    expect(store.loadError).toBe("")
    store.addWorkspace("我的班级", "陈老师")
    expect(store.workspace.name).toBe("我的班级")
    expect(store.schoolClass.id).toBe("")
    expect(store.workspace.classes).toEqual([])
  })

  it("没有 randomUUID 时仍可导入新班级和新学生", () => {
    const store = useGradebookStore()
    const data = createWorkspace("HTTP 测试档案")
    data.exams.push({ id: "http-exam", name: "阶段考试", date: "2026-10-13", subjects: structuredClone(data.subjects) })
    data.selectedExamId = "http-exam"
    store.restore({ version: 1, activeWorkspaceId: data.id, workspaces: [data] })
    store.importScores([{ line: 2, number: "001", name: "测试学生", className: "导入班级", scores: { math: 80 } }])
    const group = store.workspace.classes.find(item => item.name === "导入班级")!
    const student = store.workspace.students[0]
    expect(student.classId).toBe(group.id)
    expect(student.id).not.toBe(group.id)
    expect(store.workspace.records[0].studentId).toBe(student.id)
  })
})
