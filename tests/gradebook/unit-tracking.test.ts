import type { UnitTrackingEntry, UnitTrackingPlan } from "@/pages/gradebook/types"
import { Workbook } from "exceljs"
import { describe, expect, it } from "vitest"
import { readScoreFile } from "@/pages/gradebook/files"
import { parseUnitWorkbook, unitBaselineRanks, unitDifference, unitMetrics, unitRankings } from "@/pages/gradebook/unit-tracking"

function sheets() {
  return [
    {
      name: "学情",
      matrix: [
        ["姓名", "性别", "学情调研", "分层", "1单元目标", "1单元测试", "超目标", "进步否", "2单元目标", "2单元测试", "超目标", "进步否"],
        ["学生甲", "男", 70, "A", 80, 90, 999, 999, 85, 80, null, null],
        ["学生乙", "女", 50, "B", 60, null, -60, -50, 65, 60, null, null],
        ["学生丙", "女", 20, "C", 30, 0, -30, -20, 35, null, null, null]
      ]
    },
    {
      name: "任务安排",
      matrix: [["作业任务", "姓名"], ["拓展任务", "学生甲"], [null, "学生乙"], ["基础任务", "学生丙"]]
    }
  ]
}

function plan(): UnitTrackingPlan {
  return {
    id: "plan",
    name: "数学单元跟踪",
    classId: "class",
    subjectId: "math",
    periods: [{ id: "u1", name: "1单元" }, { id: "u2", name: "2单元" }],
    entries: [
      { studentId: "a", baseline: 30, level: "A", task: "拓展", scores: { u1: { target: 40, actual: 50 }, u2: { target: 60, actual: 70 } } },
      { studentId: "b", baseline: 50, level: "B", task: "提升", scores: { u1: { target: null, actual: 0 }, u2: { target: 30, actual: null } } },
      { studentId: "c", baseline: 70, level: "C", task: "基础", scores: { u1: { target: 80, actual: null }, u2: { target: 0, actual: 0 } } },
      { studentId: "d", baseline: null, level: "C", task: "基础", scores: { u1: { target: 20, actual: 10 }, u2: { target: null, actual: 20 } } }
    ]
  }
}

describe("单科学情工作簿解析", () => {
  it("识别实际表头并按姓名延续合并任务，不把任务分组当成分层", () => {
    const preview = parseUnitWorkbook(sheets(), 100)
    expect(preview.errors).toEqual([])
    expect(preview.warnings).toEqual([])
    expect(preview.periods).toEqual([{ id: "unit-1", name: "1单元" }, { id: "unit-2", name: "2单元" }])
    expect(preview.rows.map(row => [row.name, row.level, row.task])).toEqual([
      ["学生甲", "A", "拓展任务"],
      ["学生乙", "B", "拓展任务"],
      ["学生丙", "C", "基础任务"]
    ])
    expect(preview.rows[0]).toMatchObject({ number: "", gender: "男", baseline: 70, line: 2 })
  })

  it("不继承错误公式缓存，未录入保持 null，真实零分保留", () => {
    const preview = parseUnitWorkbook(sheets(), 100)
    const rows = preview.rows.map((row, index): UnitTrackingEntry => ({ ...row, studentId: String(index) }))
    expect(rows[1].scores["unit-1"].actual).toBeNull()
    expect(rows[2].scores["unit-1"].actual).toBe(0)
    expect(unitDifference(rows[0], preview.periods, "unit-1")).toEqual({ gap: 10, change: 20 })
    expect(unitDifference(rows[1], preview.periods, "unit-1")).toEqual({ gap: null, change: null })
    expect(unitDifference(rows[0], preview.periods, "unit-2")).toEqual({ gap: -5, change: -10 })
  })

  it("支持真实 xlsx 合并任务单元格及任意工作表名称", async () => {
    const workbook = new Workbook()
    const data = workbook.addWorksheet("数学学情表")
    data.addRows(sheets()[0].matrix)
    const tasks = workbook.addWorksheet("分组")
    tasks.addRows(sheets()[1].matrix)
    tasks.mergeCells("A2:A3")
    const file = new File([await workbook.xlsx.writeBuffer()], "匿名学情.xlsx")
    const preview = parseUnitWorkbook(await readScoreFile(file), 100)
    expect(preview.errors).toEqual([])
    expect(preview.rows[1].task).toBe("拓展任务")
  })

  it("保留可选文本学号，跳过标题空行与平均分行，单元按数字排序", () => {
    const preview = parseUnitWorkbook([{
      name: "表",
      matrix: [["数学学情"], [], ["学号", "姓名", "2单元测试", "2单元目标", "1单元目标", "1单元测试"], ["001", "学生甲", 90, 80, 60, 70], [null, "平均分", 90, 80, 60, 70]]
    }], 100)
    expect(preview.errors).toEqual([])
    expect(preview.rows).toHaveLength(1)
    expect(preview.rows[0]).toMatchObject({ number: "001", line: 4, baseline: null })
    expect(preview.periods.map(period => period.id)).toEqual(["unit-1", "unit-2"])
    expect(preview.warnings).toHaveLength(2)
  })

  it("同名单元目标重复、单元测试缺列及多个学情表均阻止导入", () => {
    expect(parseUnitWorkbook([{ name: "表", matrix: [["姓名", "1单元目标", "第1单元目标", "1单元测试"]] }], 100).errors.join(" ")).toContain("目标列重复")
    expect(parseUnitWorkbook([{ name: "表", matrix: [["姓名", "1单元目标"]] }], 100).errors.join(" ")).toContain("同时包含目标和测试列")
    expect(parseUnitWorkbook([sheets()[0], { ...sheets()[0], name: "另一个班" }], 100).errors.join(" ")).toContain("多个学情表")
  })

  it("重复姓名或学号、缺少姓名明确报错", () => {
    const preview = parseUnitWorkbook([{
      name: "表",
      matrix: [["学号", "姓名", "1单元目标", "1单元测试"], ["001", "学生甲", 60, 70], ["001", "学生甲", 60, 70], ["002", "", 60, 70]]
    }], 100)
    expect(preview.errors.join(" ")).toContain("姓名「学生甲」重复")
    expect(preview.errors.join(" ")).toContain("学号「001」重复")
    expect(preview.errors.join(" ")).toContain("第 4 行缺少姓名")
    expect(parseUnitWorkbook([{ name: "表", matrix: [["1单元目标", "1单元测试"]] }], 100).errors).toContain("学情表缺少「姓名」列")
  })

  it("任务表未知姓名、重复分配及没有可延续的任务报错", () => {
    const input = sheets()
    input[1].matrix = [["作业任务", "姓名"], [null, "学生甲"], ["拓展", "学生甲"], [null, "学生甲"], ["基础", "不存在的学生"]]
    const errors = parseUnitWorkbook(input, 100).errors.join(" ")
    expect(errors).toContain("未填写作业任务")
    expect(errors).toContain("作业任务重复")
    expect(errors).toContain("未出现在学情表")
  })

  it("同名学生学号不同可导入，作业任务按学号关联并保留合并任务", () => {
    const input = [
      { name: "学情", matrix: [["学号", "姓名", "1单元目标", "1单元测试"], ["001", "学生甲", 60, 70], ["002", "学生甲", 80, 90]] },
      { name: "任务", matrix: [["作业任务", "姓名", "学号"], ["提升", "学生甲", "002"], [null, "学生甲", "001"]] }
    ]
    const preview = parseUnitWorkbook(input, 100)
    expect(preview.errors).toEqual([])
    expect(preview.rows.map(row => [row.number, row.task])).toEqual([["001", "提升"], ["002", "提升"]])
    expect(parseUnitWorkbook([input[0]], 100).errors).toEqual([])
  })

  it("任务表没有学号时阻止同名匹配，有号无号混用的同名成绩仍报错", () => {
    const input = [
      { name: "学情", matrix: [["学号", "姓名", "1单元目标", "1单元测试"], ["001", "学生甲", 60, 70], ["002", "学生甲", 80, 90]] },
      { name: "任务", matrix: [["作业任务", "姓名"], ["提升", "学生甲"]] }
    ]
    expect(parseUnitWorkbook(input, 100).errors.join(" ")).toContain("作业任务表也须填写学号")
    expect(parseUnitWorkbook(input, 100).rows.every(row => !row.task)).toBe(true)
    input[0].matrix[2][0] = ""
    expect(parseUnitWorkbook([input[0]], 100).errors.join(" ")).toContain("同名学生须均填写不同学号")
  })

  it("任务表学号优先匹配并核对姓名，未知学号和重复分配均报错", () => {
    const input = [
      { name: "学情", matrix: [["学号", "姓名", "1单元目标", "1单元测试"], ["001", "学生甲", 60, 70], ["002", "学生乙", 80, 90]] },
      { name: "任务", matrix: [["作业任务", "姓名", "学号"], ["提升", "学生乙", "001"], ["基础", "学生甲", "999"], ["提升", "学生甲", "001"], ["基础", "学生甲", "001"]] }
    ]
    const preview = parseUnitWorkbook(input, 100)
    expect(preview.errors.join(" ")).toContain("学号「001」与姓名「学生乙」不一致")
    expect(preview.errors.join(" ")).toContain("学号「999」未出现在学情表")
    expect(preview.errors.join(" ")).toContain("作业任务重复")
    expect(preview.rows[0].task).toBe("提升")
    expect(preview.rows[1].task).toBe("")
    input[0].matrix[2][0] = "001"
    expect(parseUnitWorkbook([input[0]], 100).errors.join(" ")).toContain("学号「001」重复")
  })

  it("非数字、负分、满分越界不能导入，分数按学科设置验证", () => {
    const input = [{ name: "表", matrix: [["姓名", "学情调研", "1单元目标", "1单元测试"], ["学生甲", 101, -1, "八十"]] }]
    expect(parseUnitWorkbook(input, 100).errors).toHaveLength(3)
    input[0].matrix[1] = ["学生甲", 101, 140, "135.5"]
    expect(parseUnitWorkbook(input, 150).errors).toEqual([])
    expect(parseUnitWorkbook(input, 100).errors).toHaveLength(3)
    expect(parseUnitWorkbook(input, 0).errors).toEqual(["请先设置有效的学科满分"])
  })

  it("没有任务表只提示，不阻止导入；空表明确报错", () => {
    const preview = parseUnitWorkbook([sheets()[0]], 100)
    expect(preview.errors).toEqual([])
    expect(preview.rows.every(row => row.task === "")).toBe(true)
    expect(preview.warnings.join(" ")).toContain("未找到「作业任务、姓名」表")
    expect(parseUnitWorkbook([{ name: "表", matrix: [sheets()[0].matrix[0]] }], 100).errors).toContain("学情表没有学生数据")
    expect(parseUnitWorkbook([], 100).errors.join(" ")).toContain("没有找到单元目标与测试列")
  })
})

describe("单元对比与指标口径", () => {
  it("第一次与学情调研比较，之后与上一单元比较，缺失不跨过上一单元", () => {
    const data = plan()
    expect(unitDifference(data.entries[0], data.periods, "u1")).toEqual({ gap: 10, change: 20 })
    expect(unitDifference(data.entries[0], data.periods, "u2")).toEqual({ gap: 10, change: 20 })
    expect(unitDifference(data.entries[2], data.periods, "u2")).toEqual({ gap: 0, change: null })
    expect(unitDifference(data.entries[3], data.periods, "u2")).toEqual({ gap: null, change: 10 })
  })

  it("目标-实测图和达标率采用相同配对样本，整体均分采用所有有效实测", () => {
    expect(unitMetrics(plan(), "u1")).toEqual({
      count: 3,
      total: 4,
      missing: 1,
      average: 20,
      pairedAverage: 30,
      targetAverage: 30,
      achieved: 1,
      eligible: 2,
      achievementRate: 50,
      progressCount: 1,
      comparableCount: 2,
      declineCount: 1,
      averageGap: 0
    })
    expect(unitMetrics(plan(), "u2")).toMatchObject({ average: 30, pairedAverage: 35, targetAverage: 30, count: 3, eligible: 2, achievementRate: 100, comparableCount: 2, progressCount: 2, declineCount: 0, averageGap: 5 })
  })

  it("没有有效实测或目标时显示未知，实际0分仍参与均分、达标与比较", () => {
    const data = plan()
    data.entries = [{ ...data.entries[0], baseline: 0, scores: { u1: { target: 0, actual: 0 } } }]
    expect(unitMetrics(data, "u1")).toMatchObject({ count: 1, average: 0, eligible: 1, achieved: 1, achievementRate: 100, comparableCount: 1, progressCount: 0, declineCount: 0 })
    data.entries[0].scores.u1.actual = null
    expect(unitMetrics(data, "u1")).toMatchObject({ count: 0, missing: 1, average: null, pairedAverage: null, targetAverage: null, eligible: 0, achievementRate: null, averageGap: null, comparableCount: 0 })
  })
})

describe("单元计划排名与名次变化", () => {
  it("整份计划降序排名，同分按1、1、3占位，多人并列继续占位", () => {
    const data = plan()
    for (const [index, score] of [90, 90, 80.5, 0].entries()) data.entries[index].scores.u1 = { target: null, actual: score }
    for (const [index, score] of [90, 90, 90, 0].entries()) data.entries[index].scores.u2 = { target: null, actual: score }
    expect([...unitRankings(data, "u1").values()].map(value => value.rank)).toEqual([1, 1, 3, 4])
    expect([...unitRankings(data, "u2").values()].map(value => value.rank)).toEqual([1, 1, 1, 4])
    expect(unitRankings(data, "u2").get("c")).toEqual({ rank: 1, previousRank: 3, rankChange: 2 })
  })

  it("首单元与全部有效学情调研排名比较，后续单元比较上一单元", () => {
    const data = plan()
    expect(unitBaselineRanks(data)).toEqual(new Map([["c", 1], ["b", 2], ["a", 3]]))
    expect(unitRankings(data, "u1")).toEqual(new Map([
      ["a", { rank: 1, previousRank: 3, rankChange: 2 }],
      ["b", { rank: 3, previousRank: 2, rankChange: -1 }],
      ["c", { rank: null, previousRank: 1, rankChange: null }],
      ["d", { rank: 2, previousRank: null, rankChange: null }]
    ]))
    expect(unitRankings(data, "u2")).toEqual(new Map([
      ["a", { rank: 1, previousRank: 1, rankChange: 0 }],
      ["b", { rank: null, previousRank: 3, rankChange: null }],
      ["c", { rank: 3, previousRank: null, rankChange: null }],
      ["d", { rank: 2, previousRank: 2, rankChange: 0 }]
    ]))
  })

  it("学情调研同分并列，零分有效，空白与非有限值不进入排名", () => {
    const data = plan()
    data.entries[0].baseline = 80.5
    data.entries[1].baseline = 80.5
    data.entries[2].baseline = 0
    data.entries[3].baseline = Number.NaN
    expect(unitBaselineRanks(data)).toEqual(new Map([["a", 1], ["b", 1], ["c", 3]]))
    data.entries[0].scores.u1.actual = Number.NaN
    data.entries[1].scores.u1.actual = Number.POSITIVE_INFINITY
    data.entries[2].scores.u1.actual = 0
    data.entries[3].scores = {}
    expect([...unitRankings(data, "u1").values()].map(value => value.rank)).toEqual([null, null, 1, null])
    expect(unitRankings(data, "u1").get("c")).toEqual({ rank: 1, previousRank: 3, rankChange: 2 })
    data.entries[0].baseline = null
    data.entries[1].baseline = undefined as unknown as null
    data.entries[2].baseline = Number.NEGATIVE_INFINITY
    expect(unitBaselineRanks(data).size).toBe(0)
  })

  it("小数排名按原始实测分比较，不把目标高低、分层或作业任务用于排名", () => {
    const data = plan()
    for (const [index, score] of [80.51, 80.5, 80.51, 0].entries()) data.entries[index].scores.u1 = { target: index ? 0 : 100, actual: score }
    const first = unitRankings(data, "u1")
    expect([...first.values()].map(value => value.rank)).toEqual([1, 3, 1, 4])
    for (const entry of data.entries) {
      entry.scores.u1.target = null
      entry.level = "任意分层"
      entry.task = "任意任务"
    }
    expect(unitRankings(data, "u1")).toEqual(first)
  })

  it("上一单元缺失时不跨过空白阶段，当前缺考保留上次名次但没有排名变化", () => {
    const data = plan()
    data.periods.push({ id: "u3", name: "3单元" })
    data.entries[0].scores.u2.actual = null
    data.entries[0].scores.u3 = { target: 70, actual: 90 }
    data.entries[1].scores.u3 = { target: 40, actual: 50 }
    expect(unitRankings(data, "u3").get("a")).toEqual({ rank: 1, previousRank: null, rankChange: null })
    expect(unitRankings(data, "u3").get("b")).toEqual({ rank: 2, previousRank: null, rankChange: null })
    expect(unitRankings(data, "u3").get("d")).toEqual({ rank: null, previousRank: 1, rankChange: null })
  })

  it("不同计划独立计算，无效阶段全部为空，计算不更改记录或写入派生排名", () => {
    const first = plan()
    const second = plan()
    second.id = "other-plan"
    second.classId = "other-class"
    second.subjectId = "english"
    second.entries.reverse()
    for (const [index, entry] of second.entries.entries()) entry.scores.u1.actual = index * 10
    const before = structuredClone(first)
    const ranks = unitRankings(first, "u1")
    expect(unitRankings(second, "u1").get("b")?.rank).toBe(2)
    expect(unitRankings(first, "u1")).toEqual(ranks)
    expect([...unitRankings(first, "missing").values()]).toEqual(Array.from({ length: 4 }, () => ({ rank: null, previousRank: null, rankChange: null })))
    expect(first).toEqual(before)
    expect(first.entries.every(entry => !("rank" in entry) && !("previousRank" in entry) && !("rankChange" in entry))).toBe(true)
  })
})
