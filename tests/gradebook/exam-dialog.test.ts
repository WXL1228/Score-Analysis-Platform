import type { VueWrapper } from "@vue/test-utils"
import { CacheKey } from "@@/constants/cache-key"
import { flushPromises, mount } from "@vue/test-utils"
import { ElDatePicker, ElMessage, ElMessageBox, ElSelect } from "element-plus/es"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ExamDialog from "@/pages/gradebook/components/ExamDialog.vue"
import { createWorkspace } from "@/pages/gradebook/demo"
import { useGradebookStore } from "@/pinia/stores/gradebook"

let wrapper: VueWrapper | undefined
let target: HTMLDivElement

function setup(empty = false) {
  const data = createWorkspace("考试测试")
  if (!empty) {
    data.subjects = [
      { id: "math", name: "数学", max: 100, pass: 60, excellent: 85 },
      { id: "chinese", name: "语文", max: 100, pass: 60, excellent: 85 },
      { id: "english", name: "英语", max: 120, pass: 72, excellent: 102 }
    ]
    data.classes = [{ id: "class-a", name: "一班" }, { id: "class-b", name: "二班" }]
    data.students = [
      { id: "student-a", number: "001", name: "学生甲", classId: "class-a", focus: false, note: "" },
      { id: "student-b", number: "002", name: "学生乙", classId: "class-b", focus: false, note: "" }
    ]
    data.exams = [
      { id: "exam-a", name: "第一次考试", date: "2026-10-01", subjects: data.subjects.slice(0, 2).map(subject => ({ ...subject })) },
      { id: "exam-b", name: "另一次考试", date: "2026-10-08", subjects: data.subjects.slice(0, 2).map(subject => ({ ...subject })) }
    ]
    data.records = [
      { examId: "exam-a", studentId: "student-a", scores: { math: 0, chinese: 80 } },
      { examId: "exam-a", studentId: "student-b", scores: { math: 60, chinese: 90 } },
      { examId: "exam-b", studentId: "student-a", scores: { math: 50, chinese: 70 } }
    ]
    data.selectedClassId = "class-a"
    data.selectedExamId = "exam-a"
  }
  localStorage.setItem(CacheKey.GRADEBOOK_DATA, JSON.stringify({ version: 1, activeWorkspaceId: data.id, workspaces: [data] }))
  const pinia = createPinia()
  setActivePinia(pinia)
  return { pinia, store: useGradebookStore() }
}

async function open(options: ReturnType<typeof setup>, editing = true) {
  wrapper = mount(ExamDialog, {
    attachTo: target,
    props: { modelValue: false, exam: editing ? options.store.workspace.exams[0] : undefined },
    global: { plugins: [options.pinia], stubs: {
      teleport: true,
      transition: true,
      // happy-dom 下静态 ElSelect 多选组件也会触发布局递归，隔离下拉弹层并保留真实输入、表格。
      ElSelect: { name: "ElSelect", props: ["modelValue"], emits: ["update:modelValue"], template: "<div><slot /></div>" },
      ElOption: true
    } }
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

async function fill(view: VueWrapper, label: string, value: string) {
  await view.get(`input[aria-label="${label}"]`).setValue(value)
}

describe("考试独立学科与分数线编辑", () => {
  beforeEach(() => {
    localStorage.clear()
    target = document.createElement("div")
    document.body.appendChild(target)
    vi.spyOn(ElMessage, "error").mockImplementation(() => ({ close: () => {} }))
    vi.spyOn(ElMessage, "success").mockImplementation(() => ({ close: () => {} }))
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    target.remove()
    vi.restoreAllMocks()
  })

  it("只编辑草稿，取消后重新打开恢复原名称、日期及学科配置", async () => {
    const options = setup()
    const before = JSON.stringify(options.store.workspace)
    const view = await open(options)
    await fill(view, "考试名称", "未保存的名称")
    await fill(view, "考试学科1满分", "150")
    await view.get("[aria-label=\"移除考试学科2 语文\"]").trigger("click")
    await view.get("[aria-label=\"取消考试编辑\"]").trigger("click")
    expect(JSON.stringify(options.store.workspace)).toBe(before)
    await view.setProps({ modelValue: false })
    await view.setProps({ modelValue: true })
    await flushPromises()
    expect((view.get("input[aria-label=\"考试名称\"]").element as HTMLInputElement).value).toBe("第一次考试")
    expect((view.get("input[aria-label=\"考试学科1满分\"]").element as HTMLInputElement).value).toBe("100.0")
    expect(view.find("[aria-label=\"移除考试学科2 语文\"]").exists()).toBe(true)
  })

  it("档案没有学科也能手动创建本次学科，不写入档案默认设置", async () => {
    const options = setup(true)
    const confirm = vi.spyOn(ElMessageBox, "confirm")
    const view = await open(options, false)
    await fill(view, "考试名称", "数学单元测验")
    await view.get("[aria-label=\"添加考试学科\"]").trigger("click")
    await fill(view, "考试学科1名称", "数学")
    await fill(view, "考试学科1满分", "120")
    await fill(view, "考试学科1及格分", "72")
    await fill(view, "考试学科1优秀分", "102")
    await view.get("[aria-label=\"创建本次考试\"]").trigger("click")
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(options.store.workspace.subjects).toEqual([])
    expect(options.store.workspace.exams).toHaveLength(1)
    expect(options.store.exam).toMatchObject({ name: "数学单元测验", subjectsCustomized: true, subjects: [{ name: "数学", max: 120, pass: 72, excellent: 102 }] })
    expect(view.emitted("update:modelValue")?.at(-1)).toEqual([false])
  })

  it.each(["档案重选", "手动重建"])("旧考试同名学科ID不同，%s后仍保留原ID和成绩，不产生删除确认", async (mode) => {
    const options = setup()
    Object.assign(options.store.workspace.exams[0].subjects[0], { id: "legacy-math", max: 150, pass: 90, excellent: 130 })
    for (const record of options.store.workspace.records.filter(record => record.examId === "exam-a")) {
      record.scores["legacy-math"] = record.studentId === "student-a" ? 120 : record.scores.math
      delete record.scores.math
    }
    const before = JSON.stringify(options.store.workspace.records)
    const confirm = vi.spyOn(ElMessageBox, "confirm")
    const view = await open(options)
    view.findComponent(ElSelect).vm.$emit("update:modelValue", ["chinese"])
    await flushPromises()
    if (mode === "档案重选") {
      view.findComponent(ElSelect).vm.$emit("update:modelValue", ["math", "chinese"])
      await flushPromises()
    } else {
      await view.get("[aria-label=\"添加考试学科\"]").trigger("click")
      await fill(view, "考试学科2名称", "数学")
      await fill(view, "考试学科2满分", "150")
      await fill(view, "考试学科2及格分", "90")
      await fill(view, "考试学科2优秀分", "130")
    }
    await view.get("[aria-label=\"保存本次考试\"]").trigger("click")
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(options.store.workspace.exams[0].subjects.find(subject => subject.name === "数学")).toEqual({ id: "legacy-math", name: "数学", max: 150, pass: 90, excellent: 130 })
    expect(JSON.stringify(options.store.workspace.records)).toBe(before)
    expect(view.emitted("update:modelValue")?.at(-1)).toEqual([false])
  })

  it("移除确认统计所有班级并包含0分，确认时锁定编辑；保存只整理本次成绩且新增科目为缺考", async () => {
    const options = setup()
    const otherExam = JSON.stringify(options.store.workspace.exams[1])
    const otherRecord = JSON.stringify(options.store.workspace.records.find(record => record.examId === "exam-b"))
    const defaults = JSON.stringify(options.store.workspace.subjects)
    let approve: (value: Awaited<ReturnType<typeof ElMessageBox.confirm>>) => void = () => {}
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockImplementation(() => new Promise((resolve) => {
      approve = resolve
    }))
    const view = await open(options)
    const before = JSON.stringify(options.store.workspace)
    await fill(view, "考试名称", "调整后的考试")
    view.findComponent(ElDatePicker).vm.$emit("update:modelValue", "2026-11-02")
    view.findComponent(ElSelect).vm.$emit("update:modelValue", ["chinese", "english"])
    await flushPromises()
    await view.get("[aria-label=\"保存本次考试\"]").trigger("click")
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(String(confirm.mock.calls[0][0])).toContain("数学：2 条（一班 1 条、二班 1 条）")
    expect(String(confirm.mock.calls[0][0])).toContain("包含 0 分")
    expect(view.get("input[aria-label=\"考试名称\"]").attributes("disabled")).toBeDefined()
    expect(view.get("[aria-label=\"取消考试编辑\"]").attributes("disabled")).toBeDefined()
    expect(view.find(".el-dialog__headerbtn").exists()).toBe(false)
    expect(JSON.stringify(options.store.workspace)).toBe(before)
    approve("confirm" as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    await flushPromises()
    expect(options.store.workspace.exams[0]).toMatchObject({ id: "exam-a", name: "调整后的考试", date: "2026-11-02", subjectsCustomized: true, subjects: [{ id: "chinese" }, { id: "english", max: 120 }] })
    expect(options.store.workspace.records.filter(record => record.examId === "exam-a").map(record => record.scores)).toEqual([{ chinese: 80, english: null }, { chinese: 90, english: null }])
    expect(JSON.stringify(options.store.workspace.subjects)).toBe(defaults)
    expect(JSON.stringify(options.store.workspace.exams[1])).toBe(otherExam)
    expect(JSON.stringify(options.store.workspace.records.find(record => record.examId === "exam-b"))).toBe(otherRecord)
  })

  it("取消移除确认不修改数据，并保留草稿供继续编辑", async () => {
    const options = setup()
    const before = JSON.stringify(options.store.workspace)
    vi.spyOn(ElMessageBox, "confirm").mockRejectedValue("cancel")
    const view = await open(options)
    await view.get("[aria-label=\"移除考试学科1 数学\"]").trigger("click")
    await view.get("[aria-label=\"保存本次考试\"]").trigger("click")
    await flushPromises()
    expect(JSON.stringify(options.store.workspace)).toBe(before)
    expect(view.find("[aria-label=\"移除考试学科1 语文\"]").exists()).toBe(true)
    expect(view.emitted("update:modelValue")).toBeUndefined()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it("空科目、重名和低于已有成绩的满分均阻止保存，错误后仍可编辑", async () => {
    const options = setup()
    const before = JSON.stringify(options.store.workspace)
    const view = await open(options)
    await fill(view, "考试学科2名称", "数学")
    await view.get("[aria-label=\"保存本次考试\"]").trigger("click")
    expect(ElMessage.error).toHaveBeenLastCalledWith("学科名称和标识不能为空或重复")
    await fill(view, "考试学科2名称", "语文")
    await fill(view, "考试学科1优秀分", "45")
    await fill(view, "考试学科1及格分", "30")
    await fill(view, "考试学科1满分", "50")
    await view.get("[aria-label=\"保存本次考试\"]").trigger("click")
    await flushPromises()
    expect(ElMessage.error).toHaveBeenLastCalledWith(expect.stringContaining("已有 60 分成绩"))
    expect(JSON.stringify(options.store.workspace)).toBe(before)
    await view.get("[aria-label=\"移除考试学科1 数学\"]").trigger("click")
    await view.get("[aria-label=\"移除考试学科1 语文\"]").trigger("click")
    await view.get("[aria-label=\"保存本次考试\"]").trigger("click")
    expect(ElMessage.error).toHaveBeenLastCalledWith("至少保留一门学科")
    expect(view.emitted("update:modelValue")).toBeUndefined()
  })

  it("等待确认期间档案切换，确认后不会把考试保存到另一档案", async () => {
    const options = setup()
    const originalId = options.store.workspace.id
    const before = JSON.stringify(options.store.workspace)
    let approve: (value: Awaited<ReturnType<typeof ElMessageBox.confirm>>) => void = () => {}
    vi.spyOn(ElMessageBox, "confirm").mockImplementation(() => new Promise((resolve) => {
      approve = resolve
    }))
    const view = await open(options)
    await view.get("[aria-label=\"移除考试学科1 数学\"]").trigger("click")
    await view.get("[aria-label=\"保存本次考试\"]").trigger("click")
    options.store.addWorkspace("另一档案", "")
    approve("confirm" as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    await flushPromises()
    expect(options.store.workspace.exams).toEqual([])
    expect(JSON.stringify(options.store.archive.workspaces.find(workspace => workspace.id === originalId))).toBe(before)
    expect(ElMessage.error).toHaveBeenLastCalledWith("档案或编辑窗口已变化，请重新打开考试窗口")
  })

  it("等待确认期间考试被删除，确认后不会重新创建已删除的考试", async () => {
    const options = setup()
    let approve: (value: Awaited<ReturnType<typeof ElMessageBox.confirm>>) => void = () => {}
    vi.spyOn(ElMessageBox, "confirm").mockImplementation(() => new Promise((resolve) => {
      approve = resolve
    }))
    const view = await open(options)
    await view.get("[aria-label=\"移除考试学科1 数学\"]").trigger("click")
    await view.get("[aria-label=\"保存本次考试\"]").trigger("click")
    options.store.deleteExam("exam-a")
    const before = JSON.stringify(options.store.workspace)
    approve("confirm" as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    await flushPromises()
    expect(JSON.stringify(options.store.workspace)).toBe(before)
    expect(ElMessage.error).toHaveBeenLastCalledWith("考试已不存在，请重新打开窗口")
  })
})
