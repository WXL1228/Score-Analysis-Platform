<script lang="ts" setup>
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { rankedStudents, round, statistics, teachingAdvice } from "./analytics"
import { barOption } from "./chart-options"
import ChartPanel from "./components/ChartPanel.vue"

defineOptions({ name: "GradebookAnalysis" })
const store = useGradebookStore()
const subjects = computed(() => store.exam?.subjects.map(subject => ({ ...subject, stats: statistics(store.rows.map(row => row.scores[subject.id]), subject.pass, subject.excellent) })) ?? [])
const selectedSubject = ref("")
watch(() => store.exam?.id, () => {
  selectedSubject.value = store.exam?.subjects[0]?.id ?? ""
}, { immediate: true })
const subject = computed(() => store.exam?.subjects.find(item => item.id === selectedSubject.value))
const comparisons = computed(() => store.workspace.classes.map((group) => {
  const rows = rankedStudents(store.workspace, store.workspace.selectedExamId, group.id, false)
  return { name: group.name, stats: statistics(rows.map(row => row.scores[selectedSubject.value]), subject.value?.pass ?? 0, subject.value?.excellent ?? 0), students: rows.length }
}))
const compareOption = computed(() => barOption(comparisons.value.filter(item => item.stats.count).map(item => item.name), [
  { name: "平均分", data: comparisons.value.filter(item => item.stats.count).map(item => item.stats.average) },
  { name: "最高分", data: comparisons.value.filter(item => item.stats.count).map(item => item.stats.max) }
], subject.value?.max))
const ratesOption = computed(() => barOption(subjects.value.map(item => item.name), [
  { name: "及格率 (%)", data: subjects.value.map(item => item.stats.passRate) },
  { name: "优秀率 (%)", data: subjects.value.map(item => item.stats.excellentRate) }
], 100))
const advice = computed(() => teachingAdvice(store.rows, store.exam))
</script>

<template>
  <div>
    <section class="panel">
      <div class="panel-heading">
        <div><h2>学科成绩统计</h2><p>缺考不进入该科统计分母；缺考或未录入科目按 0 分计入总分统计与排名</p></div><span class="subtle-tag">{{ store.exam?.name || '暂无考试' }}</span>
      </div><el-table :data="subjects" empty-text="请先新建考试并录入成绩">
        <el-table-column prop="name" label="学科" min-width="100" /><el-table-column prop="max" label="满分" width="75" /><el-table-column prop="pass" label="及格线" width="80" /><el-table-column prop="excellent" label="优秀线" width="80" /><el-table-column prop="stats.count" label="有效人数" width="90" /><el-table-column label="平均分" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? row.stats.average : '—' }}
          </template>
        </el-table-column><el-table-column label="得分率" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? `${round(row.stats.average / row.max * 100)}%` : '—' }}
          </template>
        </el-table-column><el-table-column label="最高 / 最低" min-width="110">
          <template #default="{ row }">
            {{ row.stats.count ? `${row.stats.max} / ${row.stats.min}` : '—' }}
          </template>
        </el-table-column><el-table-column label="及格率" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? `${row.stats.passRate}%` : '—' }}
          </template>
        </el-table-column><el-table-column label="优秀率" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? `${row.stats.excellentRate}%` : '—' }}
          </template>
        </el-table-column>
      </el-table>
    </section>
    <div class="dashboard-grid section-gap">
      <section class="panel">
        <div class="panel-heading">
          <div><h2>学科达标情况</h2><p>各科及格率与优秀率</p></div>
        </div><ChartPanel :option="ratesOption" label="各科及格率和优秀率柱状图" />
      </section><section class="panel">
        <div class="panel-heading">
          <div><h2>跨班学科对比</h2><p>同一次考试与同一分数口径下比较</p></div><el-select v-model="selectedSubject" style="width: 105px" aria-label="对比学科">
            <el-option v-for="item in store.exam?.subjects" :key="item.id" :value="item.id" :label="item.name" />
          </el-select>
        </div><ChartPanel :option="compareOption" label="不同班级的学科平均分和最高分对比柱状图" />
      </section>
    </div>
    <section class="panel">
      <div class="panel-heading">
        <div><h2>{{ subject?.name || '学科' }} · 班级横向对比</h2><p>在成绩录入中上传其他班级数据后自动加入</p></div>
      </div><el-table :data="comparisons">
        <el-table-column prop="name" label="班级" min-width="150" /><el-table-column label="有效 / 总人数" min-width="130">
          <template #default="{ row }">
            {{ row.stats.count }} / {{ row.students }}
          </template>
        </el-table-column><el-table-column label="平均分" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? row.stats.average : '—' }}
          </template>
        </el-table-column><el-table-column label="最高分" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? row.stats.max : '—' }}
          </template>
        </el-table-column><el-table-column label="最低分" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? row.stats.min : '—' }}
          </template>
        </el-table-column><el-table-column label="及格率" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? `${row.stats.passRate}%` : '—' }}
          </template>
        </el-table-column><el-table-column label="优秀率" min-width="90">
          <template #default="{ row }">
            {{ row.stats.count ? `${row.stats.excellentRate}%` : '—' }}
          </template>
        </el-table-column>
      </el-table>
    </section>
    <section class="teaching-panel section-gap">
      <h2>下一阶段教学方向</h2><div class="suggestion-grid">
        <div v-for="(item, i) in advice.slice(0, 3)" :key="item">
          <small>0{{ i + 1 }} · 教学行动</small><p>{{ item }}</p>
        </div>
      </div><small class="suggestion-footnote">{{ advice[3] }}</small>
    </section>
  </div>
</template>
