import type { VueWrapper } from "@vue/test-utils"
import type { UnitPlanImport } from "@/pages/gradebook/types"
import { flushPromises, mount, shallowMount } from "@vue/test-utils"
import { ElMessage, ElTabs } from "element-plus/es"
import { createPinia, setActivePinia } from "pinia"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import UnitTeaching from "@/pages/gradebook/UnitTeaching.vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"

function input(short = false): UnitPlanImport {
  return {
    name: "数学单元",
    className: "一班",
    subjectId: "math",
    periods: [{ id: "unit-1", name: "1单元" }, ...short ? [] : [{ id: "unit-2", name: "2单元" }]],
    rows: [{ line: 2, number: "001", name: "学生甲", baseline: 50, level: "A", task: "拓展任务", scores: { "unit-1": { target: 60, actual: 70 }, ...short ? {} : { "unit-2": { target: 80, actual: 90 } } } }]
  }
}

describe("单元页面观察阶段", () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it("已有计划首次打开即显示最新单元统计；替换为较短计划后仍选择有效阶段", async () => {
    const store = useGradebookStore()
    store.addWorkspace("单元页面测试", "老师")
    store.updateSubjectSettings([{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }])
    const plan = store.importUnitPlan(input())
    const wrapper = shallowMount(UnitTeaching)
    await nextTick()
    expect(wrapper.find(".stat-value").text()).toContain("90")
    store.importUnitPlan(input(true))
    await nextTick()
    expect(store.workspace.unitPlans?.[0].id).toBe(plan.id)
    expect(wrapper.find(".stat-value").text()).toContain("70")
    wrapper.unmount()
  })
})

function rankingInput(): UnitPlanImport {
  return {
    name: "数学排名观察",
    className: "一班",
    subjectId: "math",
    periods: [{ id: "unit-1", name: "1单元" }, { id: "unit-2", name: "2单元" }],
    rows: [
      { line: 2, number: "001", name: "学生甲", baseline: 100, level: "A", task: "拓展任务", scores: { "unit-1": { target: 90, actual: 80 }, "unit-2": { target: 95, actual: 95 } } },
      { line: 3, number: "002", name: "学生乙", baseline: 90, level: "B", task: "基础任务", scores: { "unit-1": { target: 90, actual: 90 }, "unit-2": { target: 90, actual: 80 } } },
      { line: 4, number: "003", name: "学生丙", baseline: 80, level: "B", task: "基础任务", scores: { "unit-1": { target: 90, actual: 90 }, "unit-2": { target: 90, actual: 85 } } },
      { line: 5, number: "004", name: "学生丁", baseline: 70, level: "C", task: "基础任务", scores: { "unit-1": { target: 80, actual: null }, "unit-2": { target: 90, actual: 90 } } },
      { line: 6, number: "005", name: "学生戊", baseline: 0, level: "C", task: "基础任务", scores: { "unit-1": { target: 60, actual: 0 }, "unit-2": { target: 60, actual: 0 } } }
    ]
  }
}

describe("单元页面班级排名展示", () => {
  let wrapper: VueWrapper | undefined
  let target: HTMLDivElement

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    target = document.createElement("div")
    document.body.appendChild(target)
    vi.spyOn(ElMessage, "success").mockImplementation(() => ({ close: () => {} }))
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    target.remove()
    vi.restoreAllMocks()
  })

  async function open() {
    const store = useGradebookStore()
    store.updateSubjectSettings([{ id: "math", name: "数学", max: 100, pass: 60, excellent: 85 }])
    store.importUnitPlan(rankingInput())
    wrapper = mount(UnitTeaching, { attachTo: target, global: { stubs: {
      ChartPanel: true,
      UnitImportDialog: true,
      teleport: true,
      transition: true,
      ElSelect: { name: "ElSelect", props: ["modelValue"], emits: ["update:modelValue"], template: "<div><slot /></div>" },
      ElOption: true
    } } })
    await flushPromises()
    wrapper.findComponent(ElTabs).vm.$emit("update:modelValue", "students")
    await flushPromises()
    return { store, view: wrapper }
  }

  it("各单元分别显示并列名次和红绿排名变化，0分排名、缺考无名次且不跨缺失比较", async () => {
    const { view } = await open()
    const table = view.get("[aria-label=\"单元学生明细\"]")
    expect(table.text()).toContain("分数变化")
    expect(table.text()).not.toContain("进退步")
    expect(table.get("[aria-label=\"学生乙1单元班级排名\"]").text()).toBe("1")
    expect(table.get("[aria-label=\"学生丙1单元班级排名\"]").text()).toBe("1")
    expect(table.get("[aria-label=\"学生甲1单元班级排名\"]").text()).toBe("3")
    expect(table.get("[aria-label=\"学生戊1单元班级排名\"]").text()).toBe("4")
    expect(table.get("[aria-label=\"学生戊学情调研排名\"]").text()).toBe("5")
    expect(table.get("[aria-label=\"学生丁1单元班级排名\"]").text()).toBe("—")
    expect(table.get("[aria-label=\"学生丁2单元班级排名\"]").text()).toBe("2")
    expect(table.get("[aria-label=\"学生丁2单元排名变化\"]").text()).toBe("暂无对比")
    expect(table.get("[aria-label=\"学生丙1单元排名变化\"]").text()).toBe("↑ 2 名")
    expect(table.get("[aria-label=\"学生丙1单元排名变化\"] .rank-change").classes()).toContain("positive")
    expect(table.get("[aria-label=\"学生乙2单元排名变化\"]").text()).toBe("↓ 3 名")
    expect(table.get("[aria-label=\"学生乙2单元排名变化\"] .rank-change").classes()).toContain("negative")
    expect(view.text()).toContain("搜索及分层、作业筛选不改变排名")
  })

  it("搜索、分层和作业筛选不缩小排名母体，观察单元切换不覆盖其他单元排名", async () => {
    const { view } = await open()
    const selects = view.findAllComponents({ name: "ElSelect" })
    selects.find(select => select.attributes("aria-label") === "筛选分层")!.vm.$emit("update:modelValue", "B")
    selects.find(select => select.attributes("aria-label") === "筛选作业任务")!.vm.$emit("update:modelValue", "基础任务")
    await view.get("input[aria-label=\"搜索单元学生\"]").setValue("学生乙")
    await flushPromises()
    const table = view.get("[aria-label=\"单元学生明细\"]")
    expect(table.find("[aria-label=\"学生甲1单元班级排名\"]").exists()).toBe(false)
    expect(table.get("[aria-label=\"学生乙1单元班级排名\"]").text()).toBe("1")
    expect(table.get("[aria-label=\"学生乙2单元班级排名\"]").text()).toBe("4")
    expect(table.get("[aria-label=\"学生乙2单元排名变化\"]").text()).toBe("↓ 3 名")
    selects.find(select => select.attributes("aria-label") === "观察单元")!.vm.$emit("update:modelValue", "unit-1")
    await flushPromises()
    expect(table.get("[aria-label=\"学生乙2单元班级排名\"]").text()).toBe("4")
  })

  it("个人抽屉显示调研排名和每期名次变化，保存成绩会实时重算所有学生及相邻单元的变化", async () => {
    const { view } = await open()
    await view.get(".goal-matrix [aria-label=\"查看学生乙单元趋势\"]").trigger("click")
    await flushPromises()
    expect(view.get("[aria-label=\"个人学情调研排名\"]").text()).toBe("2")
    expect(view.get("[aria-label=\"个人1单元班级排名\"]").text()).toBe("1")
    expect(view.get("[aria-label=\"个人1单元排名变化\"]").text()).toBe("↑ 1 名")
    expect(view.get("[aria-label=\"个人2单元班级排名\"]").text()).toBe("4")
    await view.get("[aria-label=\"编辑学生乙单元记录\"]").trigger("click")
    await flushPromises()
    await view.get("input[aria-label=\"1单元测试成绩\"]").setValue("70")
    await view.get("[aria-label=\"保存单元记录\"]").trigger("click")
    await flushPromises()
    const table = view.get("[aria-label=\"单元学生明细\"]")
    expect(table.get("[aria-label=\"学生乙1单元班级排名\"]").text()).toBe("3")
    expect(table.get("[aria-label=\"学生甲1单元班级排名\"]").text()).toBe("2")
    expect(table.get("[aria-label=\"学生乙2单元排名变化\"]").text()).toBe("↓ 1 名")
    expect(view.get("[aria-label=\"个人1单元班级排名\"]").text()).toBe("3")
    expect(view.get("[aria-label=\"个人2单元排名变化\"]").text()).toBe("↓ 1 名")
    expect(ElMessage.success).toHaveBeenLastCalledWith("单元记录已保存，目标达成、排名和图表已更新")
  })
})
