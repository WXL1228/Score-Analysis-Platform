import type { GradebookArchive, UnitPlanImport } from "@/pages/gradebook/types"
import { CacheKey } from "@@/constants/cache-key"
import { mount } from "@vue/test-utils"
import { ElMessageBox } from "element-plus/es"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMemoryHistory, createRouter } from "vue-router"
import { createWorkspace } from "@/pages/gradebook/demo"
import Students from "@/pages/gradebook/Students.vue"
import { parseArchive } from "@/pages/gradebook/validation"
import { useGradebookStore } from "@/pinia/stores/gradebook"

function sampleInput(overrides: Partial<UnitPlanImport> = {}): UnitPlanImport {
  return {
    name: "数学单元目标",
    className: "七年级测试班",
    subjectId: "math",
    periods: [{ id: "unit-1", name: "第一单元" }, { id: "unit-2", name: "第二单元" }],
    rows: [
      { number: "", name: "测试甲", gender: "女", line: 4, baseline: 70, level: "发展层", task: "巩固运算", scores: { "unit-1": { target: 80, actual: 85 }, "unit-2": { target: 90, actual: 88 } } },
      { number: "", name: "测试乙", gender: "男", line: 5, baseline: null, level: "基础层", task: "复习基础", scores: { "unit-1": { target: 60, actual: null }, "unit-2": { target: null, actual: null } } }
    ],
    ...overrides
  }
}

describe("单元目标存储与缓存", () => {
  beforeEach(() => {
    localStorage.clear()
    const data = createWorkspace("单元目标测试")
    data.subjects = [{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }]
    localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify({ version: 1, activeWorkspaceId: data.id, workspaces: [data] }))
    setActivePinia(createPinia())
  })

  it("导入单元计划创建班级与学生，并保留全部单元目标、分层和任务，不生成普通考试", () => {
    const store = useGradebookStore()
    const before = JSON.stringify({ exams: store.workspace.exams, records: store.workspace.records })
    const first = store.importUnitPlan(sampleInput())
    expect(store.schoolClass.name).toBe("七年级测试班")
    expect(store.students.map(student => [student.number, student.gender])).toEqual([["自动001", "女"], ["自动002", "男"]])
    expect(first.entries[0]).toMatchObject({ baseline: 70, level: "发展层", task: "巩固运算", scores: { "unit-1": { target: 80, actual: 85 }, "unit-2": { target: 90, actual: 88 } } })
    const second = store.importUnitPlan(sampleInput({ name: "第二学期数学目标" }))
    expect(second.id).not.toBe(first.id)
    expect(store.workspace.unitPlans).toHaveLength(2)
    expect(store.students).toHaveLength(2)
    expect(JSON.stringify({ exams: store.workspace.exams, records: store.workspace.records })).toBe(before)
  })

  it("已有名册按唯一姓名或学号匹配，未提供性别时保留原资料", () => {
    const store = useGradebookStore()
    store.initializeClass({ name: "七年级测试班", rows: [], setDefaultSubjects: false })
    store.upsertStudent({ id: "known-a", number: "001", name: "测试甲", gender: "女", classId: store.schoolClass.id, focus: true, note: "原有备注" })
    store.upsertStudent({ id: "known-b", number: "002", name: "测试乙", gender: "男", classId: store.schoolClass.id, focus: false, note: "" })
    const input = sampleInput()
    delete input.rows[0].gender
    input.rows[1].number = "002"
    const plan = store.importUnitPlan(input)
    expect(plan.entries.map(entry => entry.studentId)).toEqual(["known-a", "known-b"])
    expect(store.students).toHaveLength(2)
    expect(store.students[0]).toMatchObject({ gender: "女", focus: true, note: "原有备注" })
  })

  it("自动编号避开已有编号和本批次后续显式编号，再次导入完整替换计划但保留标识", () => {
    const store = useGradebookStore()
    const input = sampleInput()
    input.rows[1].number = "自动001"
    const first = store.importUnitPlan(input)
    expect(store.students.map(student => student.number)).toEqual(["自动002", "自动001"])
    input.rows[0].scores["unit-1"].actual = 90
    input.rows.pop()
    const updated = store.importUnitPlan(input)
    expect(updated.id).toBe(first.id)
    expect(store.workspace.unitPlans).toHaveLength(1)
    expect(updated.entries).toHaveLength(1)
    expect(updated.entries[0].scores["unit-1"].actual).toBe(90)
    expect(store.students).toHaveLength(2)
  })

  it("重名无学号、学号姓名冲突、重复行与越界分数均拒绝，并且不写入部分名册或计划", () => {
    const store = useGradebookStore()
    store.initializeClass({ name: "七年级测试班", rows: [], setDefaultSubjects: false })
    for (const [id, number] of [["known-a", "001"], ["known-b", "002"]]) store.upsertStudent({ id, number, name: "测试甲", classId: store.schoolClass.id, focus: false, note: "" })
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    expect(() => store.importUnitPlan(sampleInput())).toThrow("对应多个学生")
    const conflict = sampleInput()
    conflict.rows[0].number = "002"
    conflict.rows[0].name = "其他姓名"
    expect(() => store.importUnitPlan(conflict)).toThrow("请核对姓名")
    const duplicate = sampleInput({ className: "另一个班" })
    duplicate.rows[1].name = duplicate.rows[0].name
    expect(() => store.importUnitPlan(duplicate)).toThrow("重复的学生关联")
    const invalid = sampleInput({ className: "越界测试班" })
    invalid.rows[0].scores["unit-1"].actual = 101
    expect(() => store.importUnitPlan(invalid)).toThrow("0～100")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
    expect(store.workspace.unitPlans).toBeUndefined()
    expect(store.workspace.classes.some(group => group.name === "越界测试班")).toBe(false)
  })

  it("每次导入只保存一份完整缓存，重开和备份恢复均保留单元计划，旧档案没有此字段也能读取", () => {
    const store = useGradebookStore()
    expect(store.workspace.unitPlans).toBeUndefined()
    expect(() => parseArchive(store.archive)).not.toThrow()
    const writes: unknown[] = []
    const original = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === CacheKey.GRADEBOOK_DATA) writes.push(JSON.parse(value))
      original(key, value)
    })
    let planId = ""
    try {
      planId = store.importUnitPlan(sampleInput()).id
      expect(writes).toHaveLength(1)
      expect(() => parseArchive(writes[0])).not.toThrow()
    } finally {
      spy.mockRestore()
    }
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = useGradebookStore()
    expect(reopened.loadError).toBe("")
    expect(reopened.workspace.unitPlans?.[0].id).toBe(planId)
    const backup = JSON.parse(JSON.stringify(reopened.archive))
    reopened.deleteUnitPlan(planId)
    reopened.restore(backup)
    expect(reopened.workspace.unitPlans?.[0].entries).toHaveLength(2)
  })

  it("编辑保存使用当前学科满分，拒绝无效单元和越界输入，并且不保留调用方对象引用", () => {
    const store = useGradebookStore()
    const plan = store.importUnitPlan(sampleInput())
    const entry = structuredClone(plan.entries[0])
    entry.task = " 新任务 "
    entry.scores["unit-1"].actual = 95
    store.saveUnitEntry(plan.id, entry)
    entry.scores["unit-1"].actual = 0
    expect(store.workspace.unitPlans?.[0].entries[0].task).toBe("新任务")
    expect(store.workspace.unitPlans?.[0].entries[0].scores["unit-1"].actual).toBe(95)
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    entry.scores["unit-1"].target = Number.NaN
    expect(() => store.saveUnitEntry(plan.id, entry)).toThrow("0～100")
    entry.scores["unit-1"].target = 80
    entry.scores.unknown = { actual: 40, target: 60 }
    expect(() => store.saveUnitEntry(plan.id, entry)).toThrow("不存在的单元")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
    expect(() => store.saveUnitEntry("missing", entry)).toThrow("单元计划不存在")
  })

  it("删除计划仅删除本计划，删除班级同时清理关联单元计划", () => {
    const store = useGradebookStore()
    const first = store.importUnitPlan(sampleInput())
    const second = store.importUnitPlan(sampleInput({ name: "另一个计划" }))
    const records = JSON.stringify(store.workspace.records)
    const students = JSON.stringify(store.workspace.students)
    expect(store.deleteUnitPlan(first.id)).toBe(true)
    expect(store.deleteUnitPlan(first.id)).toBe(false)
    expect(store.workspace.unitPlans?.map(plan => plan.id)).toEqual([second.id])
    expect(JSON.stringify(store.workspace.records)).toBe(records)
    expect(JSON.stringify(store.workspace.students)).toBe(students)
    expect(store.deleteClass(second.classId)).toBe(true)
    expect(store.workspace.unitPlans).toEqual([])
    expect(() => parseArchive(store.archive)).not.toThrow()
  })

  it("学生管理删除学生时清理各计划的该学生记录，其他学生记录保留", async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useGradebookStore()
    const plan = store.importUnitPlan(sampleInput())
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/students", component: { template: "<div />" } }] })
    await router.push("/students")
    await router.isReady()
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    const wrapper = mount(Students, { global: { plugins: [pinia, router], stubs: { StudentDialog: true, ScoreDialog: true } } })
    try {
      await vi.waitFor(() => expect(wrapper.findAll("button").some(button => button.text() === "删除")).toBe(true))
      await wrapper.findAll("button").find(button => button.text() === "删除")!.trigger("click")
      await vi.waitFor(() => expect(store.workspace.unitPlans?.[0].entries).toHaveLength(1))
      expect(store.workspace.unitPlans?.[0].entries[0].studentId).toBe(plan.entries[1].studentId)
      expect(() => parseArchive(store.archive)).not.toThrow()
    } finally {
      wrapper.unmount()
      confirm.mockRestore()
      store.$dispose()
    }
  })

  it("备份验证阻止重复或悬空标识、无效单元及分数，失败恢复不覆盖当前档案", () => {
    const store = useGradebookStore()
    store.importUnitPlan(sampleInput())
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    const mutations: ((input: GradebookArchive) => void)[] = [
      (input) => {
        input.workspaces[0].unitPlans = null as unknown as undefined
      },
      (input) => {
        input.workspaces[0].unitPlans!.push(input.workspaces[0].unitPlans![0])
      },
      (input) => {
        input.workspaces[0].unitPlans![0].name = " "
      },
      (input) => {
        input.workspaces[0].unitPlans![0].classId = "missing"
      },
      (input) => {
        input.workspaces[0].unitPlans![0].subjectId = "missing"
      },
      (input) => {
        input.workspaces[0].unitPlans![0].periods[1].id = "unit-1"
      },
      (input) => {
        input.workspaces[0].unitPlans![0].periods[1].name = "第一单元"
      },
      (input) => {
        input.workspaces[0].unitPlans![0].entries[0].studentId = "missing"
      },
      (input) => {
        input.workspaces[0].unitPlans![0].entries.push(input.workspaces[0].unitPlans![0].entries[0])
      },
      (input) => {
        input.workspaces[0].unitPlans![0].entries[0].baseline = -1
      },
      (input) => {
        input.workspaces[0].unitPlans![0].entries[0].scores["unit-1"].actual = 101
      },
      (input) => {
        input.workspaces[0].unitPlans![0].entries[0].scores.unknown = { actual: null, target: null }
      },
      (input) => {
        input.workspaces[0].unitPlans![0].entries[0].level = 1 as unknown as string
      }
    ]
    for (const mutate of mutations) {
      const input = JSON.parse(JSON.stringify(store.archive)) as typeof store.archive
      mutate(input)
      expect(() => store.restore(input)).toThrow()
      expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
    }
  })

  it("调低学科满分时校验计划中的学情、目标和实考成绩，冲突时整体回滚", () => {
    const store = useGradebookStore()
    store.addWorkspace("单元测试档案", "")
    store.updateSubjectSettings([{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }])
    store.importUnitPlan(sampleInput())
    const before = localStorage.getItem(CacheKey.GRADEBOOK_DATA)
    expect(() => store.updateSubjectSettings(store.workspace.subjects.map(subject => subject.id === "math" ? { ...subject, max: 80, pass: 48, excellent: 68 } : subject))).toThrow("目标分数与实考分数须为 0～80")
    expect(localStorage.getItem(CacheKey.GRADEBOOK_DATA)).toBe(before)
  })
})
