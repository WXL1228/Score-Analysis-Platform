<script lang="ts" setup>
import type { RankedStudent, Student } from "./types"
import { Plus } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import RankChange from "./components/RankChange.vue"
import ScoreDialog from "./components/ScoreDialog.vue"
import StudentDialog from "./components/StudentDialog.vue"

defineOptions({ name: "GradebookStudents" })
const store = useGradebookStore()
const route = useRoute()
const query = ref("")
const focusOnly = ref(route.query.focus === "1")
const studentVisible = ref(false)
const scoreVisible = ref(false)
const evaluationVisible = ref(false)
const evaluationDraft = ref("")
const evaluationId = ref("")
const evaluationWorkspaceId = ref("")
const editing = ref<Student>()
const scoreId = ref("")
const page = ref(1)
const rows = computed<RankedStudent[]>(() => store.exam ? store.rows : store.students.map(student => ({ ...student, scores: {}, total: null, average: null, rank: null, gradeRank: null, previousRank: null, change: null, subjectRanks: {}, warnings: student.focus ? ["教师关注"] : [] })))
const filtered = computed(() => rows.value.filter(row => (row.name.includes(query.value) || row.number.includes(query.value)) && (!focusOnly.value || row.warnings.length)))
const paged = computed(() => filtered.value.slice((page.value - 1) * 15, page.value * 15))
const evaluationStudent = computed(() => store.workspace.students.find(student => student.id === evaluationId.value))
watch(() => route.query.focus, (value) => {
  focusOnly.value = value === "1"
})
watch([query, focusOnly, () => store.workspace.selectedClassId, () => store.workspace.selectedExamId], () => {
  page.value = 1
})
watch([() => store.workspace.id, () => store.workspace.selectedClassId], () => {
  evaluationVisible.value = false
})
function edit(student?: Student) {
  editing.value = student
  studentVisible.value = true
}
function mark(row: Student) {
  const student = store.workspace.students.find(item => item.id === row.id)!
  student.focus = !student.focus
}
function openEvaluation(row: Student) {
  const student = store.workspace.students.find(item => item.id === row.id)
  if (!student) return ElMessage.error("学生已不存在，请刷新列表")
  evaluationId.value = student.id
  evaluationWorkspaceId.value = store.workspace.id
  evaluationDraft.value = student.note
  evaluationVisible.value = true
}
function saveEvaluation() {
  if (evaluationWorkspaceId.value !== store.workspace.id) return ElMessage.error("档案已切换，请重新打开教师评价")
  const student = store.workspace.students.find(item => item.id === evaluationId.value)
  if (!student) return ElMessage.error("学生已不存在，无法保存评价")
  if (evaluationDraft.value.length > 1000) return ElMessage.error("教师评价最多 300 字")
  try {
    store.upsertStudent({ ...student, note: evaluationDraft.value.trim() ? evaluationDraft.value : "" })
    evaluationVisible.value = false
    ElMessage.success("教师评价已保存")
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}
async function remove(row: Student) {
  try {
    await ElMessageBox.confirm(`删除 ${row.name}（${row.number}）及其历次考试成绩和单元目标记录？建议先备份。`, "删除学生", { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" })
    store.workspace.records = store.workspace.records.filter(item => item.studentId !== row.id)
    if (store.workspace.unitPlans) store.workspace.unitPlans = store.workspace.unitPlans.map(plan => ({ ...plan, entries: plan.entries.filter(item => item.studentId !== row.id) }))
    store.workspace.students = store.workspace.students.filter(item => item.id !== row.id)
    page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / 15)))
    ElMessage.success("学生已删除")
  } catch { /* 取消后保持数据不变。 */ }
}
</script>

<template>
  <section class="panel">
    <div class="toolbar">
      <div class="toolbar-group">
        <el-input v-model="query" placeholder="搜索姓名 / 学号" clearable aria-label="搜索学生" /><el-switch v-model="focusOnly" active-text="仅看重点关注" />
      </div><el-button type="primary" :icon="Plus" :disabled="!store.schoolClass.id" @click="edit()">
        添加学生
      </el-button>
    </div>
    <el-table :data="paged" empty-text="暂无学生，可添加学生或导入成绩文件">
      <el-table-column prop="number" label="学号" width="85" /><el-table-column prop="name" label="姓名" width="100" fixed /><el-table-column prop="gender" label="性别" width="60" /><el-table-column label="总分" width="80" align="center">
        <template #default="{ row }">
          {{ row.total ?? '—' }}
        </template>
      </el-table-column><el-table-column label="班级排名" width="85" align="center">
        <template #default="{ row }">
          {{ row.rank ?? '—' }}
        </template>
      </el-table-column><el-table-column label="进退步" width="100">
        <template #default="{ row }">
          <RankChange :value="row.change" />
        </template>
      </el-table-column><el-table-column label="关注原因" min-width="220">
        <template #default="{ row }">
          <div class="warning-tags">
            <el-tag v-for="warning in row.warnings" :key="warning" :type="warning === '教师关注' ? 'info' : 'warning'" effect="plain">
              {{ warning }}
            </el-tag><span v-if="!row.warnings.length" class="hint">表现稳定</span>
          </div>
        </template>
      </el-table-column><el-table-column prop="note" label="教师评价" min-width="160" show-overflow-tooltip /><el-table-column label="操作" width="400" fixed="right">
        <template #default="{ row }">
          <div class="student-actions">
            <el-button text type="primary" @click="edit(row as Student)">
              编辑
            </el-button><el-button text type="primary" :aria-label="`评价学生 ${row.number} ${row.name}`" @click="openEvaluation(row as Student)">
              评价
            </el-button><el-button text type="primary" :disabled="!store.exam" @click="scoreId = row.id; scoreVisible = true">
              成绩
            </el-button><el-button text :type="row.focus ? 'warning' : 'primary'" @click="mark(row as Student)">
              {{ row.focus ? '取消关注' : '关注' }}
            </el-button><el-button text type="danger" @click="remove(row as Student)">
              删除
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination v-model:current-page="page" :page-size="15" :total="filtered.length" layout="total, prev, pager, next" />
    </div><p class="hint">
      排名下降达到 {{ store.workspace.warningThreshold }} 名、任一科未及格、成绩不完整或手动标记的学生进入关注名单。预警阈值可在班级设置中调整。
    </p>
    <StudentDialog v-model="studentVisible" :student="editing" /><ScoreDialog v-model="scoreVisible" :student-id="scoreId" />
    <el-dialog v-model="evaluationVisible" :title="`${evaluationStudent?.name ?? ''} · 教师评价`" width="560px" aria-label="教师评价编辑">
      <el-form label-position="top">
        <el-form-item label="教师评价">
          <el-input v-model="evaluationDraft" type="textarea" :rows="10" maxlength="1000" show-word-limit aria-label="教师评价内容" placeholder="记录该生的学习表现、成长进步或需要支持的方面" />
        </el-form-item>
      </el-form><p class="hint">
        评价保存在学生档案中，不区分单次考试，个人报告会展示。清空后保存即可删除评价，取消不改变原有内容。
      </p>
      <template #footer>
        <el-button text type="danger" aria-label="清空教师评价" @click="evaluationDraft = ''">
          清空
        </el-button><el-button aria-label="取消教师评价" @click="evaluationVisible = false">
          取消
        </el-button><el-button type="primary" aria-label="保存教师评价" @click="saveEvaluation">
          保存评价
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.student-actions {
  display: flex;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.student-actions .el-button + .el-button {
  margin-left: 0;
}
</style>
