import type { Workspace } from "@/pages/gradebook/types"
import { describe, expect, it } from "vitest"
import { createWorkspace } from "@/pages/gradebook/demo"
import { buildStudentUnitReports } from "@/pages/gradebook/unit-report"

function fixture(): Workspace {
  const data = createWorkspace("个人单元报告测试")
  data.subjects = [{ id: "math", name: "数学", max: 150, pass: 90, excellent: 128 }, { id: "english", name: "英语", max: 100, pass: 60, excellent: 85 }]
  data.classes = [{ id: "one", name: "一班" }, { id: "two", name: "二班" }]
  data.students = [
    { id: "a", number: "001", name: "同名学生", classId: "one", focus: false, note: "" },
    { id: "b", number: "001", name: "同名学生", classId: "two", focus: false, note: "" },
    { id: "c", number: "002", name: "其他学生", classId: "one", focus: false, note: "" }
  ]
  data.selectedClassId = "two"
  data.unitPlans = [{
    id: "math-plan",
    name: "数学本学期目标",
    classId: "one",
    subjectId: "math",
    periods: [{ id: "u1", name: "第一单元" }, { id: "u2", name: "第二单元" }, { id: "u3", name: "第三单元" }],
    entries: [
      { studentId: "a", baseline: 70.5, level: "A", task: "基础巩固", scores: { u1: { target: 75.5, actual: 80.5 }, u2: { target: 85, actual: 82.25 }, u3: { target: 90, actual: null } } },
      { studentId: "c", baseline: 100, level: "B", task: "其他任务", scores: { u1: { target: 110, actual: 120 } } }
    ]
  }]
  return data
}

describe("学生个人单元报告", () => {
  it("读取当前学生所有学科和计划，不依赖所选班级或考试，不改变原始数据", () => {
    const data = fixture()
    const first = data.unitPlans![0]
    data.unitPlans!.push(
      { ...first, id: "english-plan", name: "英语目标", subjectId: "english", entries: [{ ...first.entries[0], level: "自定义分层", task: "口语练习" }] },
      { ...first, id: "another-math-plan", name: "数学另一计划", entries: [{ ...first.entries[0], task: "专题练习" }] }
    )
    const before = JSON.stringify(data)
    const reports = buildStudentUnitReports(data, data.students[0])
    expect(reports.map(report => [report.title, report.subjectName, report.max])).toEqual([
      ["数学本学期目标", "数学", 150],
      ["英语目标", "英语", 100],
      ["数学另一计划", "数学", 150]
    ])
    expect(reports[1]).toMatchObject({ level: "自定义分层", task: "口语练习" })
    expect(JSON.stringify(data)).toBe(before)
  })

  it("同名学生按学生标识与班级关联隔离，不混入其他学生或其他班级计划", () => {
    const data = fixture()
    const first = data.unitPlans![0]
    data.unitPlans!.push({ ...first, id: "other-class", name: "二班数学", classId: "two", entries: [{ ...first.entries[0], studentId: "b", task: "二班专属任务" }] })
    expect(buildStudentUnitReports(data, data.students[0]).map(report => report.title)).toEqual(["数学本学期目标"])
    const otherClass = buildStudentUnitReports(data, data.students[1])
    expect(otherClass.map(report => report.title)).toEqual(["二班数学"])
    expect(otherClass[0].task).toBe("二班专属任务")
    expect(otherClass[0].baselineRank).toBe(1)
    expect(otherClass[0].rows[0].rank).toBe(1)
    expect(buildStudentUnitReports(data, data.students[0])[0].baselineRank).toBe(2)
    expect(buildStudentUnitReports(data, data.students[2])[0].rows[0].actual).toBe(120)
  })

  it("按计划顺序保留小数、目标和缺考，首单元比学情调研，后续比上一单元", () => {
    const data = fixture()
    const report = buildStudentUnitReports(data, data.students[0])[0]
    expect(report.baseline).toBe(70.5)
    expect(report.baselineRank).toBe(2)
    expect(report.rows).toEqual([
      { period: "第一单元", target: 75.5, actual: 80.5, gap: 5, change: 10, rank: 2, previousRank: 2, rankChange: 0, status: "已达标" },
      { period: "第二单元", target: 85, actual: 82.25, gap: -2.75, change: 1.75, rank: 1, previousRank: 2, rankChange: 1, status: "未达标" },
      { period: "第三单元", target: 90, actual: null, gap: null, change: null, rank: null, previousRank: 1, rankChange: null, status: "缺考或未录入" }
    ])
  })

  it("最新单元待录入时依据最近实测给建议，不能据空白生成假退步", () => {
    const data = fixture()
    const report = buildStudentUnitReports(data, data.students[0])[0]
    const advice = report.advice.join(" ")
    expect(advice).toContain("第二单元")
    expect(advice).toContain("距个人目标差 2.75 分")
    expect(advice).toContain("提高 1.75 分")
    expect(advice).toContain("后续单元成绩请及时补录")
    expect(advice).toContain("基础巩固")
    expect(advice).toContain("「第二单元」班级排名第 1 名")
    expect(advice).toContain("进步 1 名")
    expect(advice).not.toContain("「第三单元」班级排名")
    expect(advice).not.toContain("下降")
    expect(report.advice).toHaveLength(5)
  })

  it("真实零分与零目标有效，空白相邻阶段不跨过计算变化", () => {
    const data = fixture()
    const entry = data.unitPlans![0].entries[0]
    entry.baseline = 0
    entry.scores = { u1: { target: 0, actual: 0 }, u2: { target: 60, actual: null }, u3: { target: 0, actual: 0 } }
    const report = buildStudentUnitReports(data, data.students[0])[0]
    expect(report.rows[0]).toMatchObject({ gap: 0, change: 0, rank: 2, previousRank: 2, rankChange: 0, status: "已达标" })
    expect(report.rows[1]).toMatchObject({ actual: null, gap: null, change: null, rank: null, previousRank: 2, rankChange: null, status: "缺考或未录入" })
    expect(report.rows[2]).toMatchObject({ actual: 0, gap: 0, change: null, rank: 1, previousRank: null, rankChange: null, status: "已达标" })
    expect(report.advice.join(" ")).toContain("缺少可比")
    expect(report.advice.join(" ")).not.toContain("尚无单元测试成绩")
  })

  it("排名依据完整计划有效成绩，保留并列与真实零分，变化不跨缺失阶段且不写回原记录", () => {
    const data = fixture()
    const plan = data.unitPlans![0]
    const ids = ["a", "c", "d", "e"]
    for (const [index, id] of ids.slice(2).entries()) data.students.push({ id, number: `00${index + 3}`, name: "同名学生", classId: "one", focus: false, note: "" })
    plan.entries = ids.map((studentId, index) => ({
      studentId,
      baseline: [90, 90, 0, null][index],
      level: "A",
      task: "当前任务",
      scores: {
        u1: { target: 80, actual: [80, 80, 0, null][index] },
        u2: { target: 80, actual: [70, 90, null, 0][index] },
        u3: { target: 80, actual: [80, null, 0, 0][index] }
      }
    }))
    const before = JSON.stringify(data)
    const reports = ids.map(id => buildStudentUnitReports(data, data.students.find(student => student.id === id)!)[0])
    expect(reports.map(report => report.baselineRank)).toEqual([1, 1, 3, null])
    expect(reports.map(report => report.rows[0].rank)).toEqual([1, 1, 3, null])
    expect(reports.map(report => report.rows[0].rankChange)).toEqual([0, 0, 0, null])
    expect(reports.map(report => report.rows[1].rank)).toEqual([2, 1, null, 3])
    expect(reports.map(report => report.rows[1].previousRank)).toEqual([1, 1, 3, null])
    expect(reports.map(report => report.rows[1].rankChange)).toEqual([-1, 0, null, null])
    expect(reports.map(report => report.rows[2].rank)).toEqual([1, null, 2, 2])
    expect(reports.map(report => report.rows[2].rankChange)).toEqual([1, null, null, 1])
    expect(JSON.stringify(data)).toBe(before)
  })

  it("无目标时不判断达标，缺少所有实测时提示补录和设置目标", () => {
    const data = fixture()
    const entry = data.unitPlans![0].entries[0]
    entry.scores = { u1: { target: null, actual: 0 }, u2: { target: null, actual: null } }
    let report = buildStudentUnitReports(data, data.students[0])[0]
    expect(report.rows[0]).toMatchObject({ actual: 0, target: null, gap: null, status: "未设目标" })
    expect(report.rows[2]).toMatchObject({ actual: null, target: null, status: "缺考或未录入" })
    expect(report.advice.join(" ")).toContain("尚未设置个人目标")
    entry.scores = {}
    report = buildStudentUnitReports(data, data.students[0])[0]
    expect(report.rows.every(row => row.actual === null && row.change === null)).toBe(true)
    expect(report.advice.join(" ")).toContain("尚无单元测试成绩，请补录")
    expect(report.advice.join(" ")).toContain("尚未设置个人目标")
    expect(report.advice.join(" ")).not.toContain("下降")
    expect(report.advice.join(" ")).not.toContain("NaN")
  })

  it("分层和任务保持原样，不根据 A/B/C 指定作业或推断知识错因", () => {
    const data = fixture()
    const entry = data.unitPlans![0].entries[0]
    entry.level = "C"
    entry.task = "拓展任务"
    entry.scores.u2 = { target: 85, actual: 60 }
    const report = buildStudentUnitReports(data, data.students[0])[0]
    expect(report).toMatchObject({ level: "C", task: "拓展任务" })
    expect(report.advice.join(" ")).toContain("拓展任务")
    expect(report.advice.join(" ")).toContain("下降 20.5 分")
    expect(report.advice.join(" ")).not.toContain("基础薄弱")
    expect(report.advice.join(" ")).not.toContain("粗心")
    entry.task = ""
    expect(buildStudentUnitReports(data, data.students[0])[0].advice.join(" ")).not.toContain("已分配")
  })

  it("小数分差与页面保持同一计算口径，建议文案不暴露浮点尾差", () => {
    const data = fixture()
    const entry = data.unitPlans![0].entries[0]
    entry.baseline = 80.1
    entry.scores = { u1: { target: 80.3, actual: 80.2 } }
    const report = buildStudentUnitReports(data, data.students[0])[0]
    expect(report.rows[0].gap).toBeCloseTo(-0.1)
    expect(report.rows[0].change).toBeCloseTo(0.1)
    expect(report.advice.join(" ")).toContain("差 0.1 分")
    expect(report.advice.join(" ")).toContain("提高 0.1 分")
    expect(report.advice.join(" ")).not.toMatch(/0\.0{5}/)
  })

  it("旧档案缺省或空单元计划、当前学生没有记录时返回空报告", () => {
    const data = fixture()
    delete data.unitPlans
    expect(buildStudentUnitReports(data, data.students[0])).toEqual([])
    data.unitPlans = []
    expect(buildStudentUnitReports(data, data.students[0])).toEqual([])
    const withPlans = fixture()
    expect(buildStudentUnitReports(withPlans, withPlans.students[1])).toEqual([])
  })
})
