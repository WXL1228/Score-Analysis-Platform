<script lang="ts" setup>
import { ArrowRight, Bottom, DataAnalysis, Medal, Top, User, Warning } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { previousExam, rankedStudents, round, statistics, teachingAdvice, totalStatistics } from "./analytics"
import { barOption, lineOption } from "./chart-options"
import ChartPanel from "./components/ChartPanel.vue"
import RankChange from "./components/RankChange.vue"

defineOptions({ name: "GradebookOverview" })
const store = useGradebookStore()
const fullScore = computed(() => store.exam?.subjects.reduce((sum, subject) => sum + subject.max, 0) ?? 0)
const previous = computed(() => store.exam && previousExam(store.workspace, store.exam, store.schoolClass.id))
const progressCount = computed(() => store.rows.filter(row => row.change !== null && row.change > 0).length)
const attention = computed(() => store.rows.filter(row => row.warnings.length).sort((a, b) => (a.change ?? 0) - (b.change ?? 0)))
const suggestions = computed(() => teachingAdvice(store.rows, store.exam))
const subjectOption = computed(() => barOption(store.exam?.subjects.map(subject => subject.name) ?? [], [{ name: "平均得分率 (%)", data: store.exam?.subjects.map(subject => round(statistics(store.rows.map(row => row.scores[subject.id]), subject.pass, subject.excellent).average / subject.max * 100)) ?? [] }], 100))
const history = computed(() => [...store.workspace.exams].sort((a, b) => a.date.localeCompare(b.date)).map((exam) => {
  const stats = totalStatistics(rankedStudents(store.workspace, exam.id, store.schoolClass.id), exam)
  return { exam, stats, rate: stats.count ? round(stats.average / exam.subjects.reduce((sum, subject) => sum + subject.max, 0) * 100) : null }
}).filter(item => item.stats.count))
const trendOption = computed(() => lineOption(history.value.map(item => item.exam.name), [
  { name: "平均得分率 (%)", data: history.value.map(item => item.rate) },
  { name: "总分及格率 (%)", data: history.value.map(item => item.stats.passRate) }
]))
const distribution = computed(() => {
  const ranges = [{ label: "优秀", min: store.exam?.subjects.reduce((sum, subject) => sum + subject.excellent, 0) ?? 0, color: "#378777" }, { label: "良好", min: fullScore.value * 0.75, color: "#88a994" }, { label: "及格", min: store.exam?.subjects.reduce((sum, subject) => sum + subject.pass, 0) ?? 0, color: "#d6a862" }, { label: "待提升", min: 0, color: "#c98c87" }]
  // 总分优秀线可配置，因此将良好边界限制在及格线与优秀线之间。
  ranges[1].min = Math.max(ranges[2].min, Math.min(ranges[0].min, ranges[1].min))
  return ranges.map((range, index) => ({ ...range, count: store.rows.filter(row => row.total !== null && row.total >= range.min && (index === 0 || row.total < ranges[index - 1].min)).length }))
})
</script>

<template>
  <div class="overview-page">
    <div v-if="!store.exam" class="panel empty-state">
      <el-icon><DataAnalysis /></el-icon><h2>从第一份成绩开始</h2><p>新建考试，手动录入或上传 Excel，班级分析就会自动生成。</p><router-link to="/scores">
        <el-button type="primary">
          新建考试与导入成绩
        </el-button>
      </router-link>
    </div>
    <template v-else>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">
            班级平均分 <el-icon><DataAnalysis /></el-icon>
          </div><div class="stat-value">
            {{ store.stats.count ? store.stats.average : '—' }}<small>/ {{ fullScore }}</small>
          </div><div class="stat-hint">
            完整成绩 {{ store.stats.count }} / {{ store.students.length }} 人
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">
            总分及格率 <el-icon><User /></el-icon>
          </div><div class="stat-value">
            {{ store.stats.count ? store.stats.passRate : '—' }}<small>%</small>
          </div><div class="stat-hint">
            总分 ≥ 各科及格分之和
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">
            总分优秀率 <el-icon><Medal /></el-icon>
          </div><div class="stat-value">
            {{ store.stats.count ? store.stats.excellentRate : '—' }}<small>%</small>
          </div><div class="stat-hint">
            总分 ≥ 各科优秀分之和
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">
            进步学生 <el-icon><Top /></el-icon>
          </div><div class="stat-value">
            {{ progressCount }}<small>人</small>
          </div><div class="stat-hint positive">
            {{ previous ? `对比${previous.name}` : '暂无上次考试可对比' }}
          </div>
        </div>
      </div>
      <div class="dashboard-grid">
        <section class="panel">
          <div class="panel-heading">
            <div><h2>各学科表现 <span class="subtle-tag">得分率</span></h2><p>按各科满分归一化，比较更清晰</p></div><router-link to="/analysis" class="text-link">
              详细分析 <el-icon><ArrowRight /></el-icon>
            </router-link>
          </div><ChartPanel :option="subjectOption" label="各学科班级平均得分率柱状图" />
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div><h2>班级成长轨迹</h2><p>每一次考试，都是成长的刻度</p></div><span class="subtle-tag">{{ history.length }} 次考试</span>
          </div><ChartPanel :option="trendOption" label="历次考试班级平均得分率与总分及格率折线图" />
        </section>
      </div>
      <div class="dashboard-grid lower-grid">
        <section class="panel">
          <div class="panel-heading">
            <div><h2>需要多一份关注 <span class="attention-count">{{ attention.length }}</span></h2><p>下降 {{ store.workspace.warningThreshold }} 名及以上、未及格或教师标记</p></div><router-link to="/students?focus=1" class="text-link">
              查看全部 <el-icon><ArrowRight /></el-icon>
            </router-link>
          </div><div v-if="!attention.length" class="quiet-empty">
            本次暂无预警，继续关注学生的日常成长。
          </div><div v-for="row in attention.slice(0, 4)" :key="row.id" class="attention-row">
            <span class="student-avatar">{{ row.name.slice(-2) }}</span><div><strong>{{ row.name }}</strong><small>{{ row.warnings.join(' · ') }}</small></div><RankChange :value="row.change" />
          </div><div class="panel-note">
            <el-icon><Warning /></el-icon> 预警用于提醒支持，不能单凭排名评价学生。
          </div>
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div><h2>成绩分布</h2><p>以本次考试设置的总分线统计</p></div><span class="subtle-tag">{{ store.stats.count }} 人</span>
          </div><div class="distribution-list">
            <div v-for="item in distribution" :key="item.label" class="distribution-row">
              <span><i :style="{ background: item.color }" />{{ item.label }}</span><div class="distribution-track">
                <i :style="{ width: `${store.stats.count ? item.count / store.stats.count * 100 : 0}%`, background: item.color }" />
              </div><strong>{{ item.count }}<small> 人</small></strong>
            </div>
          </div><div class="score-extremes">
            <div><el-icon><Top /></el-icon>最高分 <strong>{{ store.stats.count ? store.stats.max : '—' }}</strong></div><div><el-icon><Bottom /></el-icon>最低分 <strong>{{ store.stats.count ? store.stats.min : '—' }}</strong></div>
          </div>
        </section>
      </div>
      <section class="teaching-panel">
        <div class="teaching-title">
          <span>✦</span><div><h2>给教师的教学建议</h2><p>把分析转化为下一步行动</p></div><router-link to="/reports" class="text-link">
            生成班级报告 <el-icon><ArrowRight /></el-icon>
          </router-link>
        </div><div class="suggestion-grid">
          <div v-for="(suggestion, i) in suggestions.slice(0, 3)" :key="suggestion">
            <small>0{{ i + 1 }} · {{ ['教学重点', '优势巩固', '个别支持'][i] }}</small><p>{{ suggestion }}</p>
          </div>
        </div><small class="suggestion-footnote">基于成绩与排名的规则建议，请结合答卷、课堂表现和学生实际情况调整。</small>
      </section>
    </template>
  </div>
</template>
