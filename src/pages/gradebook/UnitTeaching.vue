<script lang="ts" setup>
import type { UnitTrackingEntry } from "./types"
import { Aim, Delete, Download, Upload } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { barOption, lineOption } from "./chart-options"
import ChartPanel from "./components/ChartPanel.vue"
import RankChange from "./components/RankChange.vue"
import UnitImportDialog from "./components/UnitImportDialog.vue"
import { exportUnitWorkbook } from "./unit-export"
import { unitBaselineRanks, unitDifference, unitMetrics, unitRankings } from "./unit-tracking"

defineOptions({ name: "GradebookUnitTeaching" })
const store = useGradebookStore()
const importVisible = ref(false)
const selectedPlanId = ref("")
const selectedPeriod = ref("")
const tab = ref("overview")
const query = ref("")
const levelFilter = ref("")
const taskFilter = ref("")
const page = ref(1)
const editVisible = ref(false)
const editing = ref<UnitTrackingEntry>()
const editingWorkspace = ref("")
const editingPlan = ref("")
const studentId = ref("")
const studentVisible = ref(false)
const isExporting = ref(false)
const plans = computed(() => (store.workspace.unitPlans ?? []).filter(plan => plan.classId === store.workspace.selectedClassId))
const plan = computed(() => plans.value.find(plan => plan.id === selectedPlanId.value))
const subject = computed(() => store.workspace.subjects.find(subject => subject.id === plan.value?.subjectId))
watch(plans, (value) => {
  if (!value.some(plan => plan.id === selectedPlanId.value)) selectedPlanId.value = value[0]?.id ?? ""
}, { immediate: true })
watch(() => `${store.workspace.id}:${plan.value?.id ?? ""}:${plan.value?.periods.map(period => period.id).join(",") ?? ""}`, () => {
  selectedPeriod.value = plan.value?.periods.at(-1)?.id ?? ""
  query.value = ""
  levelFilter.value = ""
  taskFilter.value = ""
  page.value = 1
  editVisible.value = false
  studentVisible.value = false
}, { immediate: true })
watch([query, levelFilter, taskFilter], () => {
  page.value = 1
})
const period = computed(() => plan.value?.periods.find(period => period.id === selectedPeriod.value))
const metrics = computed(() => plan.value ? unitMetrics(plan.value, selectedPeriod.value) : null)
const baselineRanks = computed(() => plan.value ? unitBaselineRanks(plan.value) : new Map<string, number>())
const rankings = computed(() => new Map((plan.value?.periods ?? []).map(period => [period.id, unitRankings(plan.value!, period.id)] as const)))
const rows = computed(() => plan.value?.entries.map((entry) => {
  const student = store.workspace.students.find(student => student.id === entry.studentId)!
  const score = entry.scores[selectedPeriod.value]
  return { ...entry, name: student.name, number: student.number, gender: student.gender, target: score?.target ?? null, actual: score?.actual ?? null, ...unitDifference(entry, plan.value!.periods, selectedPeriod.value) }
}) ?? [])
const levels = computed(() => [...new Set(rows.value.map(row => row.level).filter(Boolean))].sort())
const tasks = computed(() => [...new Set(rows.value.map(row => row.task).filter(Boolean))])
const filtered = computed(() => rows.value.filter(row => (!query.value || row.name.includes(query.value) || row.number.includes(query.value)) && (!levelFilter.value || row.level === levelFilter.value) && (!taskFilter.value || row.task === taskFilter.value)))
const paged = computed(() => filtered.value.slice((page.value - 1) * 15, page.value * 15))
const taskGroups = computed(() => [...tasks.value, ...(rows.value.some(row => !row.task) ? [""] : [])].map(task => ({ task, rows: rows.value.filter(row => row.task === task) })))
const viewedStudent = computed(() => rows.value.find(row => row.studentId === studentId.value))
const editingName = computed(() => store.workspace.students.find(student => student.id === editing.value?.studentId)?.name ?? "")

function average(values: (number | null)[]) {
  const scores = values.filter((value): value is number => value !== null)
  return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length * 100) / 100 : null
}
const trendOption = computed(() => {
  const periods = plan.value?.periods ?? []
  const series = ["全班", ...levels.value].map((level) => {
    const entries = level === "全班" ? rows.value : rows.value.filter(row => row.level === level)
    return { name: level === "全班" ? level : `${level} 层`, data: [average(entries.map(entry => entry.baseline)), ...periods.map(period => average(entries.map(entry => entry.scores[period.id]?.actual ?? null)))] }
  })
  return lineOption(["学情调研", ...periods.map(period => period.name)], series)
})
const targetOption = computed(() => {
  const data = plan.value?.periods.map(period => unitMetrics(plan.value!, period.id)) ?? []
  return barOption(plan.value?.periods.map(period => period.name) ?? [], [
    { name: "目标均分（配对样本）", data: data.map(metric => metric.targetAverage === null ? null : Math.round(metric.targetAverage * 100) / 100) },
    { name: "实测均分（配对样本）", data: data.map(metric => metric.pairedAverage === null ? null : Math.round(metric.pairedAverage * 100) / 100) }
  ], subject.value?.max)
})
const taskOption = computed(() => {
  const groups = taskGroups.value
  const option = barOption(groups.map(group => group.task || "未分配"), [])
  const categories = [...levels.value, ...(rows.value.some(row => !row.level) ? [""] : [])]
  return { ...option, legend: { bottom: 0 }, grid: { top: 20, left: 45, right: 20, bottom: 65 }, yAxis: { type: "value" as const, minInterval: 1 }, series: categories.map(level => ({ name: level ? `${level} 层` : "未分层", type: "bar" as const, stack: "人数", barMaxWidth: 55, data: groups.map(group => group.rows.filter(row => row.level === level).length) })) }
})
const personalOption = computed(() => {
  const periods = plan.value?.periods ?? []
  const entry = viewedStudent.value
  return lineOption(["学情调研", ...periods.map(period => period.name)], [
    { name: "实际成绩", data: [entry?.baseline ?? null, ...periods.map(period => entry?.scores[period.id]?.actual ?? null)] },
    { name: "目标成绩", data: [null, ...periods.map(period => entry?.scores[period.id]?.target ?? null)] }
  ])
})
function signed(value: number | null) {
  return value === null ? "—" : value > 0 ? `+${displayScore(value)}` : String(displayScore(value))
}
function displayScore(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : Math.round(value * 100) / 100
}
function differenceClass(value: number | null) {
  return value === null ? "muted" : value >= 0 ? "positive" : "negative"
}
function status(row: { actual: number | null, target: number | null, gap: number | null }) {
  return row.actual === null ? "未录入" : row.target === null ? "未设目标" : row.gap !== null && row.gap >= 0 ? "已达标" : "未达标"
}
function viewStudent(id: string) {
  studentId.value = id
  studentVisible.value = true
}
function edit(entry: UnitTrackingEntry) {
  editing.value = { studentId: entry.studentId, baseline: entry.baseline, level: entry.level, task: entry.task, scores: Object.fromEntries((plan.value?.periods ?? []).map(period => [period.id, { target: entry.scores[period.id]?.target ?? null, actual: entry.scores[period.id]?.actual ?? null }])) }
  editingWorkspace.value = store.workspace.id
  editingPlan.value = plan.value?.id ?? ""
  editVisible.value = true
}
function saveEntry() {
  if (!editing.value || editingWorkspace.value !== store.workspace.id || editingPlan.value !== plan.value?.id) return ElMessage.error("档案或计划已切换，请重新编辑")
  try {
    store.saveUnitEntry(editingPlan.value, { ...editing.value, level: editing.value.level ?? "", task: editing.value.task ?? "", baseline: editing.value.baseline ?? null, scores: Object.fromEntries(Object.entries(editing.value.scores).map(([id, score]) => [id, { target: score.target ?? null, actual: score.actual ?? null }])) })
    editVisible.value = false
    ElMessage.success("单元记录已保存，目标达成、排名和图表已更新")
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}
async function deletePlan() {
  const current = plan.value
  if (!current) return
  const workspaceId = store.workspace.id
  try {
    await ElMessageBox.confirm(`删除「${current.name}」的单元目标、成绩及作业分组记录？学生名册和普通考试成绩会保留。`, "删除单元计划", { type: "warning", confirmButtonText: "删除计划", cancelButtonText: "取消" })
    if (workspaceId !== store.workspace.id) return
    store.deleteUnitPlan(current.id)
    ElMessage.success("单元计划已删除")
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}
async function download() {
  if (!plan.value || !subject.value) return
  isExporting.value = true
  try {
    await exportUnitWorkbook(plan.value, store.workspace.students, store.schoolClass.name, subject.value.name)
  } catch (error) {
    ElMessage.error((error as Error).message)
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <div class="unit-page">
    <section class="panel plan-toolbar">
      <div>
        <h2>{{ plan?.name || '从一份单元成绩表开始' }}</h2>
        <p class="hint">
          {{ subject ? `${subject.name} · 满分 ${subject.max} · ` : '' }}跟踪个人目标、单元表现与分层作业，数据自动保存在当前档案。
        </p>
      </div>
      <div class="toolbar-group">
        <el-select v-if="plans.length" v-model="selectedPlanId" aria-label="选择单元计划" style="width: 190px">
          <el-option v-for="item in plans" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-button type="primary" :icon="Upload" @click="importVisible = true">
          导入单元成绩表
        </el-button>
        <el-button v-if="plan" :icon="Download" :loading="isExporting" @click="download">
          导出明细
        </el-button>
        <el-button v-if="plan" text type="danger" :icon="Delete" @click="deletePlan">
          删除计划
        </el-button>
      </div>
    </section>
    <section v-if="!plan" class="panel empty-state section-gap">
      <el-icon><Aim /></el-icon><h2>把单元目标变成可见的成长</h2>
      <p>上传包含姓名、学情调研、分层、单元目标与测试成绩的 Excel，作业任务工作表会一并导入。</p>
      <el-button type="primary" class="section-gap" @click="importVisible = true">
        上传并预览 Excel
      </el-button>
    </section>
    <template v-else>
      <div class="unit-period-bar section-gap">
        <div class="toolbar-group">
          <strong>当前观察单元</strong><el-select v-model="selectedPeriod" aria-label="观察单元" style="width: 145px">
            <el-option v-for="item in plan.periods" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </div>
        <span class="hint">第一单元对比学情调研，后续单元对比上一单元；缺少任一成绩时不计算分数变化和排名变化。</span>
      </div>
      <div class="stat-grid section-gap">
        <div class="stat-card">
          <div class="stat-label">
            {{ period?.name }}平均分
          </div><div class="stat-value">
            {{ displayScore(metrics?.average) }}<small>分</small>
          </div><div class="stat-hint">
            已录入 {{ metrics?.count }} / {{ metrics?.total }} 人 · 未录入 {{ metrics?.missing }} 人
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">
            个人目标达成率
          </div><div class="stat-value">
            {{ displayScore(metrics?.achievementRate) }}<small>%</small>
          </div><div class="stat-hint">
            达标 {{ metrics?.achieved }} / {{ metrics?.eligible }} 人 · 实测 ≥ 个人目标
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">
            平均超目标分数
          </div><div class="stat-value" :class="differenceClass(metrics?.averageGap ?? null)">
            {{ signed(metrics?.averageGap ?? null) }}<small>分</small>
          </div><div class="stat-hint">
            实测 − 目标，仅计算同时有目标和成绩的学生
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">
            分数提高学生
          </div><div class="stat-value">
            {{ metrics?.progressCount }}<small>人</small>
          </div><div class="stat-hint">
            分数可比 {{ metrics?.comparableCount }} 人 · 分数下降 {{ metrics?.declineCount }} 人
          </div>
        </div>
      </div>
      <el-tabs v-model="tab" class="unit-tabs">
        <el-tab-pane label="班级看板" name="overview">
          <div class="dashboard-grid">
            <section class="panel">
              <div class="panel-heading">
                <div><h2>班级与分层成长趋势</h2><p>各阶段有效成绩均分，空白成绩不计入；分层按当前记录展示</p></div>
              </div><ChartPanel :option="trendOption" label="班级及各分层单元平均分趋势折线图" />
            </section>
            <section class="panel">
              <div class="panel-heading">
                <div><h2>目标与实测对比</h2><p>两组均分使用同一批同时有目标和实测成绩的学生</p></div>
              </div><ChartPanel :option="targetOption" label="各单元配对目标均分与实测均分柱状图" />
            </section>
          </div>
          <section class="panel section-gap">
            <div class="panel-heading">
              <div><h2>学生目标达成矩阵</h2><p>点击姓名查看个人趋势；单元格显示实测 / 目标和超目标分数</p></div><div class="matrix-legend">
                <span class="positive">● 已达标</span><span class="negative">● 未达标</span><span class="muted">● 未录入 / 未设目标</span>
              </div>
            </div>
            <div class="matrix-scroll">
              <table class="goal-matrix">
                <thead>
                  <tr>
                    <th>学生</th><th>分层</th><th v-for="item in plan.periods" :key="item.id">
                      {{ item.name }}
                    </th>
                  </tr>
                </thead><tbody>
                  <tr v-for="row in rows" :key="row.studentId">
                    <td>
                      <button class="student-link" :aria-label="`查看${row.name}单元趋势`" @click="viewStudent(row.studentId)">
                        {{ row.name }}
                      </button>
                    </td><td>{{ row.level || '—' }}</td><td v-for="item in plan.periods" :key="item.id">
                      <div class="matrix-cell" :class="unitDifference(row, plan.periods, item.id).gap === null ? 'unavailable' : unitDifference(row, plan.periods, item.id).gap! >= 0 ? 'achieved' : 'below'">
                        <strong>{{ row.scores[item.id]?.actual ?? '—' }} / {{ row.scores[item.id]?.target ?? '—' }}</strong><small>{{ signed(unitDifference(row, plan.periods, item.id).gap) }} 分</small>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <p class="hint section-gap">
            均分和变化用于观察成绩表现；不同单元的试题难度可能不同。未录入不计入均分、达标率及变化比较的有效人数。
          </p>
        </el-tab-pane>
        <el-tab-pane label="学生明细" name="students">
          <section class="panel">
            <div class="toolbar">
              <div class="toolbar-group">
                <h2>单元记录</h2><span class="subtle-tag">{{ filtered.length }} 人</span><el-input v-model="query" placeholder="搜索姓名 / 学号" aria-label="搜索单元学生" clearable />
              </div><div class="toolbar-group">
                <el-select v-model="levelFilter" clearable placeholder="全部分层" aria-label="筛选分层" style="width: 115px">
                  <el-option v-for="level in levels" :key="level" :label="`${level} 层`" :value="level" />
                </el-select><el-select v-model="taskFilter" clearable placeholder="全部作业任务" aria-label="筛选作业任务" style="width: 140px">
                  <el-option v-for="task in tasks" :key="task" :label="task" :value="task" />
                </el-select>
              </div>
            </div>
            <el-table :data="paged" aria-label="单元学生明细">
              <el-table-column prop="name" label="姓名" width="95" fixed /><el-table-column prop="number" label="学号" width="100" /><el-table-column prop="level" label="分层" width="65" /><el-table-column prop="task" label="作业任务" min-width="100" /><el-table-column label="学情调研" width="95">
                <template #default="{ row }">
                  {{ row.baseline ?? '—' }}
                </template>
              </el-table-column><el-table-column label="调研排名" width="90" align="center">
                <template #default="{ row }">
                  <span :aria-label="`${row.name}学情调研排名`">{{ baselineRanks.get(row.studentId) ?? '—' }}</span>
                </template>
              </el-table-column>
              <el-table-column v-for="item in plan.periods" :key="item.id" :label="item.name" align="center">
                <el-table-column label="目标" width="75" align="center">
                  <template #default="{ row }">
                    {{ row.scores[item.id]?.target ?? '—' }}
                  </template>
                </el-table-column><el-table-column label="实测" width="75" align="center">
                  <template #default="{ row }">
                    {{ row.scores[item.id]?.actual ?? '—' }}
                  </template>
                </el-table-column><el-table-column label="超目标" width="85" align="center">
                  <template #default="{ row }">
                    <span :class="differenceClass(unitDifference(row as UnitTrackingEntry, plan.periods, item.id).gap)">{{ signed(unitDifference(row as UnitTrackingEntry, plan.periods, item.id).gap) }}</span>
                  </template>
                </el-table-column><el-table-column label="分数变化" width="90" align="center">
                  <template #default="{ row }">
                    <span :class="differenceClass(unitDifference(row as UnitTrackingEntry, plan.periods, item.id).change)">{{ signed(unitDifference(row as UnitTrackingEntry, plan.periods, item.id).change) }}</span>
                  </template>
                </el-table-column><el-table-column label="班级排名" width="90" align="center">
                  <template #default="{ row }">
                    <span :aria-label="`${row.name}${item.name}班级排名`">{{ rankings.get(item.id)?.get(row.studentId)?.rank ?? '—' }}</span>
                  </template>
                </el-table-column><el-table-column label="排名变化" width="110" align="center">
                  <template #default="{ row }">
                    <span :aria-label="`${row.name}${item.name}排名变化`"><RankChange :value="rankings.get(item.id)?.get(row.studentId)?.rankChange ?? null" /></span>
                  </template>
                </el-table-column>
              </el-table-column>
              <el-table-column label="操作" width="145" fixed="right">
                <template #default="{ row }">
                  <div class="row-actions">
                    <el-button text type="primary" :aria-label="`查看${row.name}单元趋势`" @click="viewStudent(row.studentId)">
                      趋势
                    </el-button><el-button text type="primary" :aria-label="`编辑${row.name}单元记录`" @click="edit(row as UnitTrackingEntry)">
                      编辑
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
            <div class="pager">
              <el-pagination v-model:current-page="page" :page-size="15" :total="filtered.length" layout="total, prev, pager, next" />
            </div>
            <p class="hint">
              超目标 = 实测 − 目标。分数变化 = 当前阶段实测 − 上一阶段实测，正数提高、负数下降。原 Excel 的变化列会重新计算，未录入显示“—”。
            </p><p class="hint">
              班级排名仅统计本班本学科该计划内已录入实测的学生，0 分有效，缺考或未录入不排名；同分并列（1、1、3）。排名变化 = 上一阶段排名 − 本阶段排名，第一单元对比学情调研，后续只对比上一单元，缺少任一阶段不比较。搜索及分层、作业筛选不改变排名。
            </p>
          </section>
        </el-tab-pane>
        <el-tab-pane label="分层作业" name="tasks">
          <section class="panel">
            <div class="panel-heading">
              <div><h2>任务与学情分层分布</h2><p>任务分组和 A/B/C 分层独立保存，同一任务可以包含不同层级学生</p></div>
            </div><ChartPanel :option="taskOption" label="各作业任务中不同分层学生人数堆叠柱状图" />
          </section>
          <div class="task-grid section-gap">
            <section v-for="group in taskGroups" :key="group.task" class="panel task-card">
              <div class="panel-heading">
                <div><h2>{{ group.task || '未分配任务' }}</h2><p>当前 {{ period?.name }}的目标表现</p></div><span class="subtle-tag">{{ group.rows.length }} 人</span>
              </div><div class="task-students">
                <button v-for="row in group.rows" :key="row.studentId" class="task-student" @click="viewStudent(row.studentId)">
                  <span><strong>{{ row.name }}</strong><small>{{ row.level || '未分层' }}{{ row.level ? ' 层' : '' }}</small></span><span :class="differenceClass(row.gap)">{{ status(row) }}</span>
                </button>
              </div>
            </section>
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>
    <UnitImportDialog v-model="importVisible" @imported="selectedPlanId = $event" />
    <el-dialog v-model="editVisible" :title="`编辑 ${editingName} 的单元记录`" width="650px">
      <el-form v-if="editing && plan" label-position="top">
        <div class="form-grid">
          <el-form-item label="学情调研">
            <el-input-number v-model="editing.baseline" :min="0" :max="subject?.max" :precision="1" controls-position="right" placeholder="未录入留空" aria-label="编辑学情调研" />
          </el-form-item><el-form-item label="学情分层">
            <el-select v-model="editing.level" filterable allow-create clearable value-on-clear="" aria-label="编辑学情分层">
              <el-option v-for="level in [...new Set(['A', 'B', 'C', ...levels])]" :key="level" :label="`${level} 层`" :value="level" />
            </el-select>
          </el-form-item><el-form-item label="作业任务">
            <el-select v-model="editing.task" filterable allow-create clearable value-on-clear="" aria-label="编辑作业任务">
              <el-option v-for="task in [...new Set(['拓展任务', '提升任务', '基础任务', ...tasks])]" :key="task" :label="task" :value="task" />
            </el-select>
          </el-form-item>
        </div>
        <div v-for="item in plan.periods" :key="item.id" class="edit-period">
          <h3>{{ item.name }}</h3><div class="form-grid">
            <el-form-item label="目标分数">
              <el-input-number v-model="editing.scores[item.id].target" :min="0" :max="subject?.max" :precision="1" controls-position="right" :aria-label="`${item.name}目标分数`" />
            </el-form-item><el-form-item label="测试成绩">
              <el-input-number v-model="editing.scores[item.id].actual" :min="0" :max="subject?.max" :precision="1" controls-position="right" placeholder="未录入留空" :aria-label="`${item.name}测试成绩`" />
            </el-form-item>
          </div>
        </div>
      </el-form><p class="hint">
        分数留空表示未录入，0 分是有效成绩。保存后自动更新目标达成、分数变化、班级排名和图表。
      </p>
      <template #footer>
        <el-button aria-label="取消单元编辑" @click="editVisible = false">
          取消
        </el-button><el-button type="primary" aria-label="保存单元记录" @click="saveEntry">
          保存单元记录
        </el-button>
      </template>
    </el-dialog>
    <el-drawer v-model="studentVisible" :title="`${viewedStudent?.name ?? ''} · 个人单元趋势`" size="760px" class="unit-student-drawer">
      <template v-if="viewedStudent && plan">
        <div class="student-summary">
          <span class="subtle-tag">{{ viewedStudent.level || '未分层' }}{{ viewedStudent.level ? ' 层' : '' }}</span><span class="subtle-tag">{{ viewedStudent.task || '未分配任务' }}</span><el-button text type="primary" @click="edit(viewedStudent)">
            编辑记录
          </el-button>
        </div><ChartPanel :option="personalOption" label="学生学情调研及各单元目标与实测成绩趋势图" /><el-table :data="plan.periods" aria-label="个人单元记录">
          <el-table-column prop="name" label="阶段" min-width="100" /><el-table-column label="目标" width="75">
            <template #default="{ row }">
              {{ viewedStudent.scores[row.id]?.target ?? '—' }}
            </template>
          </el-table-column><el-table-column label="实测" width="75">
            <template #default="{ row }">
              {{ viewedStudent.scores[row.id]?.actual ?? '—' }}
            </template>
          </el-table-column><el-table-column label="超目标" width="85">
            <template #default="{ row }">
              <span :class="differenceClass(unitDifference(viewedStudent, plan.periods, row.id).gap)">{{ signed(unitDifference(viewedStudent, plan.periods, row.id).gap) }}</span>
            </template>
          </el-table-column><el-table-column label="分数变化" width="90">
            <template #default="{ row }">
              <span :class="differenceClass(unitDifference(viewedStudent, plan.periods, row.id).change)">{{ signed(unitDifference(viewedStudent, plan.periods, row.id).change) }}</span>
            </template>
          </el-table-column><el-table-column label="班级排名" width="90">
            <template #default="{ row }">
              <span :aria-label="`个人${row.name}班级排名`">{{ rankings.get(row.id)?.get(viewedStudent.studentId)?.rank ?? '—' }}</span>
            </template>
          </el-table-column><el-table-column label="排名变化" width="110">
            <template #default="{ row }">
              <span :aria-label="`个人${row.name}排名变化`"><RankChange :value="rankings.get(row.id)?.get(viewedStudent.studentId)?.rankChange ?? null" /></span>
            </template>
          </el-table-column>
        </el-table><p class="hint section-gap">
          学情调研：{{ viewedStudent.baseline ?? '未录入' }} 分，班级排名 <span aria-label="个人学情调研排名">{{ baselineRanks.get(viewedStudent.studentId) ?? '—' }}</span>。排名范围为本班本学科该计划内各阶段已录入成绩，筛选不改变名次；分数变化与排名变化分别展示，缺少相邻阶段不比较，空白阶段在成绩趋势图中保留断点。
        </p>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.plan-toolbar,
.unit-period-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.plan-toolbar .hint {
  margin-top: 8px;
}
.unit-period-bar {
  padding: 0 2px;
}
.unit-tabs {
  margin-top: 20px;
}
.matrix-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
}
.matrix-scroll {
  max-height: 440px;
  overflow: auto;
}
.goal-matrix {
  width: 100%;
  min-width: 500px;
  border-collapse: collapse;
  text-align: center;
  font-size: 12px;
}
.goal-matrix th {
  position: sticky;
  top: 0;
  padding: 13px;
  background: #f3f6ef;
  color: #839180;
  z-index: 1;
}
.goal-matrix td {
  padding: 7px 12px;
  border-bottom: 1px solid #eef1ea;
}
.student-link {
  border: 0;
  background: none;
  color: #337c68;
  padding: 8px 0;
}
.matrix-cell {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 14px;
  padding: 10px;
  border-radius: 7px;
}
.matrix-cell strong {
  font-weight: 500;
}
.matrix-cell small {
  min-width: 44px;
}
.achieved {
  background: #edf6ee;
  color: #337c68;
}
.below {
  background: #fbefec;
  color: #ba7471;
}
.unavailable {
  background: #f1f2ef;
  color: #939d94;
}
.row-actions {
  display: flex;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.row-actions .el-button + .el-button {
  margin-left: 0;
}
.task-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.task-students {
  display: grid;
  gap: 8px;
}
.task-student {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e9ede5;
  background: #fcfdf9;
  border-radius: 7px;
  text-align: left;
  font-size: 11px;
}
.task-student strong {
  font-size: 12px;
  font-weight: 500;
}
.task-student small {
  margin-left: 10px;
  color: #97a08f;
}
.edit-period {
  margin-top: 18px;
  padding-top: 15px;
  border-top: 1px solid #eef1ea;
}
.edit-period h3 {
  font-size: 13px;
  margin-bottom: 12px;
}
.student-summary {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 20px;
}
:global(.unit-student-drawer) {
  max-width: 100vw;
}
@media (max-width: 900px) {
  .task-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .plan-toolbar .toolbar-group {
    width: 100%;
    flex-wrap: wrap;
  }
  .matrix-cell {
    flex-direction: column;
    gap: 5px;
  }
}
</style>
