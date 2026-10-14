<script lang="ts" setup>
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { rankedStudents, round, statistics, totalStatistics } from "./analytics"
import { lineOption } from "./chart-options"
import ChartPanel from "./components/ChartPanel.vue"

defineOptions({ name: "GradebookTrends" })
const store = useGradebookStore()
const studentId = ref("")
watch(() => [store.workspace.id, store.schoolClass.id, store.students.length], () => {
  if (!store.students.some(item => item.id === studentId.value)) studentId.value = store.students[0]?.id ?? ""
}, { immediate: true })
const history = computed(() => [...store.workspace.exams].sort((a, b) => a.date.localeCompare(b.date) || store.workspace.exams.indexOf(a) - store.workspace.exams.indexOf(b)).map((exam) => {
  const rows = rankedStudents(store.workspace, exam.id, store.schoolClass.id, false)
  const stats = totalStatistics(rows, exam)
  const student = rows.find(item => item.id === studentId.value)
  const max = exam.subjects.reduce((sum, subject) => sum + subject.max, 0)
  return { exam, stats, student, rate: stats.count ? round(stats.average / max * 100) : null }
}))
const labels = computed(() => history.value.map(item => item.exam.name))
const classOption = computed(() => lineOption(labels.value, [
  { name: "班级平均得分率 (%)", data: history.value.map(item => item.rate) },
  { name: "总分及格率 (%)", data: history.value.map(item => item.stats.count ? item.stats.passRate : null) }
]))
const studentOption = computed(() => lineOption(labels.value, [{ name: "学生总分", data: history.value.map(item => item.student?.total ?? null) }]))
const rankOption = computed(() => lineOption(labels.value, [{ name: "班级排名", data: history.value.map(item => item.student?.rank ?? null) }], true))
const subjectIds = computed(() => [...new Map(history.value.flatMap(item => item.exam.subjects.map(subject => [subject.id, subject] as const))).values()])
const subjectOption = computed(() => lineOption(labels.value, subjectIds.value.map(subject => ({ name: subject.name, data: history.value.map(item => item.student?.subjectRanks[subject.id] ?? null) })), true))
const subjectRateOption = computed(() => lineOption(labels.value, subjectIds.value.map(subject => ({ name: subject.name, data: history.value.map((item) => {
  const snapshot = item.exam.subjects.find(s => s.id === subject.id)
  const stats = snapshot ? statistics(rankedStudents(store.workspace, item.exam.id, store.schoolClass.id, false).map(row => row.scores[subject.id]), snapshot.pass, snapshot.excellent) : null
  return snapshot && stats?.count ? round(stats.average / snapshot.max * 100) : null
}) }))))
</script>

<template>
  <div>
    <section class="panel">
      <div class="panel-heading">
        <div><h2>全班平均分与及格率趋势</h2><p>平均分转换为得分率，以适应历次考试总分变化；缺考或未录入科目按 0 分计入总分</p></div><span class="subtle-tag">{{ history.length }} 次考试</span>
      </div><ChartPanel :option="classOption" label="全班平均得分率和及格率趋势" /><el-table :data="history">
        <el-table-column label="考试" min-width="150">
          <template #default="{ row }">
            {{ row.exam.name }}
          </template>
        </el-table-column><el-table-column label="日期" width="115">
          <template #default="{ row }">
            {{ row.exam.date }}
          </template>
        </el-table-column><el-table-column label="参与排名人数" min-width="110">
          <template #default="{ row }">
            {{ row.stats.count }}
          </template>
        </el-table-column><el-table-column label="平均总分" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? row.stats.average : '—' }}
          </template>
        </el-table-column><el-table-column label="总分及格率" min-width="100">
          <template #default="{ row }">
            {{ row.stats.count ? `${row.stats.passRate}%` : '—' }}
          </template>
        </el-table-column><el-table-column label="总分优秀率" min-width="100">
          <template #default="{ row }">
            {{ row.stats.count ? `${row.stats.excellentRate}%` : '—' }}
          </template>
        </el-table-column>
      </el-table>
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>班级各学科平均得分率趋势</h2><p>使用每次考试独立保存的学科满分</p></div>
      </div><ChartPanel :option="subjectRateOption" label="班级各学科平均得分率趋势" />
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>一个学生，一条成长轨迹</h2><p>排名越靠上越好；同分并列，缺考或未录入科目按 0 分参与总排名。总分曲线须结合各次考试满分解读。</p></div><el-select v-model="studentId" filterable aria-label="趋势学生" placeholder="请选择学生" style="width: 210px">
          <el-option v-for="student in store.students" :key="student.id" :label="`${student.number} · ${student.name}`" :value="student.id" />
        </el-select>
      </div><div class="dashboard-grid">
        <div>
          <h3 class="chart-subtitle">
            总分变化
          </h3><ChartPanel :option="studentOption" label="学生历次总分变化" />
        </div><div>
          <h3 class="chart-subtitle">
            班级排名变化
          </h3><ChartPanel :option="rankOption" label="学生历次班级排名变化" />
        </div>
      </div><h3 class="chart-subtitle">
        各科班级排名变化
      </h3><ChartPanel :option="subjectOption" label="学生各科班级排名变化" /><el-table :data="history">
        <el-table-column label="考试" min-width="160">
          <template #default="{ row }">
            {{ row.exam.name }}
          </template>
        </el-table-column><el-table-column label="总分 / 满分" min-width="130">
          <template #default="{ row }">
            {{ row.student?.total ?? '—' }} / {{ row.exam.subjects.reduce((sum: number, s: { max: number }) => sum + s.max, 0) }}
          </template>
        </el-table-column><el-table-column label="班级排名" min-width="100">
          <template #default="{ row }">
            {{ row.student?.rank ?? '—' }}
          </template>
        </el-table-column><el-table-column v-for="subject in subjectIds" :key="subject.id" :label="`${subject.name}排名`" min-width="90">
          <template #default="{ row }">
            {{ row.student?.subjectRanks[subject.id] ?? '—' }}
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.chart-subtitle {
  font-size: 12px;
  font-weight: 500;
  color: #91a08b;
  margin: 15px 0;
}
</style>
