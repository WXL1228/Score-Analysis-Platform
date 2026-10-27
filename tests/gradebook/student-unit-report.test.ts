import type { UnitTrackingPlan, Workspace } from "@/pages/gradebook/types"
import { describe, expect, it } from "vitest"
import { buildReport, reportHtml } from "@/pages/gradebook/report"

function fixture(): Workspace {
  const math = { id: "math", name: "数学", max: 150, pass: 90, excellent: 130 }
  const english = { id: "english", name: "英语", max: 100, pass: 60, excellent: 85 }
  const plan: UnitTrackingPlan = {
    id: "math-plan",
    name: "数学学期目标",
    classId: "one",
    subjectId: "math",
    periods: [{ id: "u1", name: "第一单元" }, { id: "u2", name: "第二单元" }, { id: "u3", name: "第三单元" }],
    entries: [{ studentId: "a", baseline: 70, level: "A", task: "基础巩固任务", scores: { u1: { target: 80, actual: 90 }, u2: { target: 95, actual: 85 }, u3: { target: 100, actual: null } } }]
  }
  return {
    id: "teacher",
    name: "教学档案",
    teacher: "陈老师",
    demo: false,
    warningThreshold: 5,
    classes: [{ id: "one", name: "一班" }, { id: "two", name: "二班" }],
    subjects: [math, english],
    students: [
      { id: "a", number: "001", name: "同名学生", classId: "one", focus: false, note: "课堂观察记录" },
      { id: "b", number: "002", name: "同名学生", classId: "one", focus: false, note: "" },
      { id: "c", number: "001", name: "同名学生", classId: "two", focus: false, note: "" }
    ],
    exams: [
      { id: "old", name: "上次考试", date: "2026-09-01", subjects: [math] },
      { id: "new", name: "本次考试", date: "2026-10-01", subjects: [math] }
    ],
    records: [
      { examId: "old", studentId: "a", scores: { math: 75 } },
      { examId: "old", studentId: "b", scores: { math: 65 } },
      { examId: "new", studentId: "a", scores: { math: 65 } },
      { examId: "new", studentId: "b", scores: { math: 75 } }
    ],
    unitPlans: [
      plan,
      { ...plan, id: "english-plan", name: "英语阶段目标", subjectId: "english", periods: [{ id: "u1", name: "英语第一单元" }], entries: [{ studentId: "a", baseline: 60, level: "自定义分组", task: "口语练习", scores: { u1: { target: 70, actual: 80 } } }] },
      { ...plan, id: "math-review", name: "数学复盘计划", periods: [{ id: "u1", name: "复盘单元" }], entries: [{ ...plan.entries[0], task: "专题复盘" }] },
      { ...plan, id: "another-student", name: "同班另一学生专属计划", entries: [{ ...plan.entries[0], studentId: "b", task: "其他学生专属任务" }] },
      { ...plan, id: "another-class", name: "二班专属计划", classId: "two", entries: [{ ...plan.entries[0], studentId: "c", task: "二班专属任务" }] }
    ],
    selectedClassId: "one",
    selectedExamId: "new"
  }
}

function unitOnly(): Workspace {
  return { ...fixture(), exams: [], records: [], selectedExamId: "" }
}

function element(html: string): HTMLDivElement {
  const host = document.createElement("div")
  host.innerHTML = html
  return host
}

describe("个人报告整合单元目标与分层教学", () => {
  it.each(["exam", "unit-only"])("%s 个人报告展示本人的多行教师评价并安全转义，同名学生互不串用", (mode) => {
    const data = mode === "exam" ? fixture() : unitOnly()
    const evaluation = "课堂参与积极，能主动分享解题思路。\n建议复习 <基础运算>，继续保持。<img src=x onerror=\"alert(1)\">"
    data.students[0].note = evaluation
    data.students[1].note = "另一位学生专属评价"
    const report = buildReport(data, "student", "a")
    expect(report.sections.find(section => section.title === "教师评价")?.paragraphs).toEqual([evaluation])
    const host = element(reportHtml(report))
    const section = Array.from(host.querySelectorAll(".report-advice")).find(section => section.querySelector("h2")?.textContent === "教师评价")!
    expect(section.querySelector("li")?.textContent).toBe(evaluation)
    expect(section.querySelector("img")).toBeNull()
    expect(host.textContent).not.toContain("另一位学生专属评价")
    expect(reportHtml(report)).toContain("white-space:pre-wrap")
    const other = buildReport(data, "student", "b")
    expect(other.sections.find(section => section.title === "教师评价")?.paragraphs).toEqual(["另一位学生专属评价"])
    expect(reportHtml(other)).not.toContain("课堂参与积极")
    if (mode === "exam") {
      expect(buildReport(data, "class").sections.some(section => section.title === "教师评价")).toBe(false)
      expect(buildReport(data, "subject", "math").sections.some(section => section.title === "教师评价")).toBe(false)
    }
  })

  it.each(["exam", "unit-only"])("%s 清空评价后不输出空栏目，更新评价后报告使用最新内容", (mode) => {
    const data = mode === "exam" ? fixture() : unitOnly()
    data.students[0].note = " \n "
    expect(buildReport(data, "student", "a").sections.some(section => section.title === "教师评价")).toBe(false)
    data.students[0].note = "  继续保持良好的学习习惯。  "
    expect(buildReport(data, "student", "a").sections.find(section => section.title === "教师评价")?.paragraphs).toEqual(["继续保持良好的学习习惯。"])
  })

  it("保留普通考试报告，并追加所有匹配学科和计划，隔离同名学生和其他班级", () => {
    const data = fixture()
    const legacy = { ...data, unitPlans: undefined }
    const original = buildReport(legacy, "student", "a")
    const before = JSON.stringify(data)
    const report = buildReport(data, "student", "a")
    expect(report.metrics).toEqual(original.metrics)
    expect(report.tables).toEqual(expect.arrayContaining(original.tables))
    expect(report.trend).toEqual(original.trend)
    expect(report.sections).toEqual(expect.arrayContaining(original.sections))
    expect(report.unitPlans?.map(plan => [plan.title, plan.subjectName])).toEqual([
      ["数学学期目标", "数学"],
      ["英语阶段目标", "英语"],
      ["数学复盘计划", "数学"]
    ])
    expect(JSON.stringify(data)).toBe(before)
    const html = reportHtml(report)
    expect(html).not.toContain("其他学生专属任务")
    expect(html).not.toContain("二班专属")
    data.selectedExamId = "old"
    expect(buildReport(data, "student", "a").unitPlans).toEqual(report.unitPlans)
  })

  it("只有单元计划也能生成个人报告，不伪造普通考试总分、排名或趋势", () => {
    const report = buildReport(unitOnly(), "student", "a")
    expect(report.unitOnly).toBe(true)
    expect(report.unitPlans).toHaveLength(3)
    expect(report.metrics.length).toBeGreaterThan(0)
    expect(report.metrics.some(metric => /总分|排名/.test(metric.label))).toBe(false)
    expect(report.tables.some(table => /近期成绩与排名|各科成绩/.test(table.title))).toBe(false)
    expect(report.trend).toBeUndefined()
    const html = reportHtml(report)
    expect(html).toContain("同名学生")
    expect(html).toContain("单元缺失不按零分补齐")
    expect(html).not.toContain("总分得分率成长轨迹")
    expect(html).not.toContain("缺考或未录入科目按 0 分计入总分与排名")
    expect(html).not.toContain("undefined")
    expect(html).not.toContain("NaN")
  })

  it("无普通考试且没有该生单元记录时明确拒绝，班级和单科报告仍要求考试", () => {
    const data = unitOnly()
    data.unitPlans = data.unitPlans!.filter(plan => !plan.entries.some(entry => entry.studentId === "a"))
    expect(() => buildReport(data, "student", "a")).toThrow("暂无普通考试或该学生的单元记录")
    expect(() => buildReport(data, "class")).toThrow(/考试/)
    expect(() => buildReport(data, "subject", "math")).toThrow(/考试/)
  })

  it("个人报告仍只接受当前班级学生，有其他班级单元记录也不能越班生成", () => {
    expect(() => buildReport(fixture(), "student", "c")).toThrow("请选择当前班级的学生")
    expect(() => buildReport(unitOnly(), "student", "c")).toThrow("请选择当前班级的学生")
  })

  it("个人报告 HTML 包含计划、学科、调研分、当前分层和任务、逐单元目标及建议", () => {
    const report = buildReport(fixture(), "student", "a")
    expect(report.unitPlans?.[0]).toMatchObject({ baseline: 70, baselineRank: 1, level: "A", task: "基础巩固任务", max: 150 })
    expect(report.unitPlans?.[0].rows).toEqual([
      { period: "第一单元", target: 80, actual: 90, gap: 10, change: 20, rank: 1, previousRank: 1, rankChange: 0, status: "已达标" },
      { period: "第二单元", target: 95, actual: 85, gap: -10, change: -5, rank: 1, previousRank: 1, rankChange: 0, status: "未达标" },
      { period: "第三单元", target: 100, actual: null, gap: null, change: null, rank: null, previousRank: 1, rankChange: null, status: "缺考或未录入" }
    ])
    const html = reportHtml(report)
    for (const content of ["单元目标与分层教学", "数学学期目标", "英语阶段目标", "学情调研", "70", "分层", "基础巩固任务", "目标", "实测", "目标差", "分数变化", "班级排名", "排名变化", "已达标", "未达标", "缺考或未录入", "单元学习建议"]) {
      expect(html).toContain(content)
    }
    expect(html).not.toMatch(/从\s*A\s*升至|升入\s*A\s*层/)
  })

  it("个人单元排名按完整计划计算，同分并列并展示相邻排名进退", () => {
    const data = unitOnly()
    const plan = data.unitPlans![0]
    plan.entries.push(
      { ...plan.entries[0], studentId: "b", baseline: 90, scores: { u1: { target: 95, actual: 90 }, u2: { target: 100, actual: 100 } } },
      { ...plan.entries[0], studentId: "d", baseline: 80, scores: { u1: { target: 80, actual: 70 }, u2: { target: 85, actual: 85 } } }
    )
    data.students.push({ id: "d", number: "003", name: "其他学生", classId: "one", focus: false, note: "" })
    const report = buildReport(data, "student", "a")
    expect(report.unitPlans?.[0].baselineRank).toBe(3)
    expect(report.unitPlans?.[0].rows.map(row => [row.rank, row.previousRank, row.rankChange])).toEqual([[1, 3, 2], [2, 1, -1], [null, 2, null]])
    const host = element(reportHtml(report))
    const table = host.querySelector(".unit-report table")!
    expect(table.textContent).toContain("班级排名")
    expect(table.textContent).toContain("排名变化")
    expect(table.textContent).toContain("进步 2 名")
    expect(table.textContent).toContain("退步 1 名")
    expect(table.querySelector(".unit-rank-up")?.textContent).toBe("进步 2 名")
    expect(table.querySelector(".unit-rank-down")?.textContent).toBe("退步 1 名")
  })

  it("单元目标与实测 SVG 只展示最近六单元，表格仍保留全部记录", () => {
    const data = unitOnly()
    data.unitPlans = [data.unitPlans![0]]
    const plan = data.unitPlans[0]
    plan.periods = Array.from({ length: 8 }, (_, index) => ({ id: `u${index + 1}`, name: `阶段${index + 1}` }))
    plan.entries[0].scores = Object.fromEntries(plan.periods.map((period, index) => [period.id, { target: 80 + index, actual: 60 + index }]))
    const report = buildReport(data, "student", "a")
    expect(report.unitPlans?.[0].rows).toHaveLength(8)
    const host = element(reportHtml(report))
    const tableText = Array.from(host.querySelectorAll("table")).map(table => table.textContent).join(" ")
    expect(tableText).toContain("阶段1")
    expect(tableText).toContain("阶段8")
    const svg = host.querySelector("svg")!
    expect(svg).not.toBeNull()
    expect(svg.outerHTML).toContain("目标")
    expect(svg.outerHTML).toContain("实测")
    expect(svg.textContent).not.toContain("阶段1")
    expect(svg.textContent).not.toContain("阶段2")
    expect(svg.textContent).toContain("阶段3")
    expect(svg.textContent).toContain("阶段8")
  })

  it("计划名、分层、任务和 SVG 标签均转义，不产生可执行 HTML", () => {
    const data = unitOnly()
    const plan = data.unitPlans![0]
    data.unitPlans = [plan]
    plan.name = "<img src=x onerror=\"alert(1)\">数学计划"
    plan.entries[0].level = "<b>A</b>"
    plan.entries[0].task = "<script>alert(2)</script>"
    plan.periods[0].name = "<x-svg>"
    const html = reportHtml(buildReport(data, "student", "a"))
    expect(html).toContain("&lt;img")
    expect(html).toContain("&lt;b&gt;A&lt;/b&gt;")
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;")
    const host = element(html)
    expect(host.querySelectorAll("img, script, b, x-svg")).toHaveLength(0)
    const svg = host.querySelector("svg")!
    expect(svg).not.toBeNull()
    expect(svg.outerHTML).toContain("&lt;x-svg&gt;")
    expect(svg.textContent).toContain("<x-svg>")
  })

  it("旧档案缺省 unitPlans 仍能生成个人报告，班级与单科报告不附加单元资料", () => {
    const data = fixture()
    const legacy = fixture()
    delete legacy.unitPlans
    const report = buildReport(legacy, "student", "a")
    expect(report.metrics.some(metric => metric.label.includes("总分") && metric.value === 65)).toBe(true)
    expect(report.trend).toHaveLength(2)
    expect(report.unitPlans ?? []).toEqual([])
    expect(reportHtml(report)).not.toContain("数学学期目标")
    expect(buildReport(data, "class")).toEqual(buildReport(legacy, "class"))
    expect(buildReport(data, "subject", "math")).toEqual(buildReport(legacy, "subject", "math"))
  })
})
