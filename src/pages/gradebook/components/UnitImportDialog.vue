<script lang="ts" setup>
import type { UnitImportPreview, UnitPlanImport } from "../types"
import { Upload } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import { readScoreFile } from "../files"
import { parseUnitWorkbook } from "../unit-tracking"

const emit = defineEmits<{ imported: [planId: string] }>()
const visible = defineModel<boolean>({ required: true })
const store = useGradebookStore()
const classMode = ref<"existing" | "new">("existing")
const selectedClassId = ref("")
const newClassName = ref("")
const subjectId = ref("")
const planName = ref("")
const fileName = ref("")
const fileError = ref("")
const sheets = ref<{ name: string, matrix: unknown[][] }[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
let readRequest = 0
let workspaceId = ""

const subject = computed(() => store.workspace.subjects.find(item => item.id === subjectId.value))
const className = computed(() => classMode.value === "new" ? newClassName.value.trim() : store.workspace.classes.find(item => item.id === selectedClassId.value)?.name ?? "")
const preview = computed<UnitImportPreview>(() => {
  if (!sheets.value.length || !subject.value) return { periods: [], rows: [], errors: [], warnings: [] }
  return parseUnitWorkbook(sheets.value, subject.value.max)
})
const roster = computed(() => {
  const group = store.workspace.classes.find(item => item.name === className.value)
  return store.workspace.students.filter(item => item.classId === group?.id)
})
const rosterMatches = computed(() => preview.value.rows.filter(row => row.number ? roster.value.some(student => student.number === row.number && student.name === row.name) : roster.value.some(student => student.name === row.name)).length)
const errors = computed(() => {
  const messages = [...preview.value.errors]
  if (fileError.value) messages.unshift(fileError.value)
  for (const row of preview.value.rows) {
    const matched = row.number ? roster.value.find(student => student.number === row.number) : undefined
    if (matched && matched.name !== row.name) messages.push(`第 ${row.line} 行：学号 ${row.number} 已属于 ${matched.name}，请核对姓名`)
    if (!row.number && roster.value.filter(student => student.name === row.name).length > 1) messages.push(`第 ${row.line} 行：同班姓名 ${row.name} 对应多个学生，请填写学号`)
  }
  return messages
})
const replacedPlan = computed(() => {
  const group = store.workspace.classes.find(item => item.name === className.value)
  return store.workspace.unitPlans?.find(item => item.classId === group?.id && item.subjectId === subjectId.value && item.name === planName.value.trim())
})
const canSubmit = computed(() => !!className.value && !!subject.value && !!planName.value.trim() && preview.value.rows.length > 0 && !errors.value.length && !isLoading.value && !isSaving.value)

watch(visible, (value) => {
  readRequest++
  isLoading.value = false
  if (!value) return
  workspaceId = store.workspace.id
  classMode.value = store.workspace.classes.length ? "existing" : "new"
  selectedClassId.value = store.workspace.selectedClassId || store.workspace.classes[0]?.id || ""
  newClassName.value = ""
  subjectId.value = store.workspace.subjects.find(item => item.name === "数学")?.id ?? store.workspace.subjects[0]?.id ?? ""
  planName.value = ""
  fileName.value = ""
  fileError.value = ""
  sheets.value = []
})
watch(() => store.workspace.id, (id) => {
  if (!visible.value || id === workspaceId) return
  readRequest++
  isLoading.value = false
  sheets.value = []
  fileError.value = "档案已切换，请关闭后重新打开导入窗口"
})

async function pickFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (workspaceId !== store.workspace.id) return ElMessage.error("档案已切换，请重新打开导入窗口")
  const request = ++readRequest
  fileName.value = file.name
  fileError.value = ""
  sheets.value = []
  isLoading.value = true
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error("请上传 .xlsx 格式的单元成绩表")
    const loaded = await readScoreFile(file)
    if (request !== readRequest || workspaceId !== store.workspace.id || !visible.value) return
    sheets.value = loaded
    planName.value = file.name.replace(/\.xlsx$/i, "").slice(0, 80)
  } catch (error) {
    if (request !== readRequest) return
    fileError.value = `读取失败：${(error as Error).message}`
  } finally {
    if (request === readRequest) isLoading.value = false
    if (fileInput.value) fileInput.value.value = ""
  }
}

function removeFile() {
  readRequest++
  fileName.value = ""
  fileError.value = ""
  sheets.value = []
  isLoading.value = false
}

async function submit() {
  if (workspaceId !== store.workspace.id) return ElMessage.error("档案已切换，请重新打开导入窗口")
  if (!canSubmit.value) return ElMessage.error("请填写班级、学科和计划名称，并修正导入问题")
  if (classMode.value === "new" && store.workspace.classes.some(item => item.name === className.value)) return ElMessage.error("班级名称已存在，请选择已有班级或修改新班级名称")
  const input: UnitPlanImport = {
    name: planName.value.trim(),
    className: className.value,
    subjectId: subjectId.value,
    periods: preview.value.periods,
    rows: preview.value.rows
  }
  const request = readRequest
  isSaving.value = true
  try {
    if (replacedPlan.value) {
      await ElMessageBox.confirm(`「${input.className}」已有同学科的「${input.name}」计划，本次将替换该计划的全部单元目标、测试成绩、分层和作业任务。是否继续？`, "确认替换单元计划", { type: "warning", confirmButtonText: "替换并导入", cancelButtonText: "取消" })
    }
    if (workspaceId !== store.workspace.id || request !== readRequest || !visible.value) return ElMessage.error("导入内容或档案已变化，请重新确认后导入")
    const plan = store.importUnitPlan(input)
    emit("imported", plan.id)
    visible.value = false
    ElMessage.success(`单元计划已导入，共 ${input.rows.length} 位学生、${input.periods.length} 个单元`)
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error((error as Error).message)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="导入单元目标与分层教学" width="1080px" :close-on-click-modal="!isLoading && !isSaving" :close-on-press-escape="!isSaving" :show-close="!isSaving">
    <el-form label-position="top" :disabled="isSaving">
      <el-form-item label="导入班级">
        <el-radio-group v-model="classMode" aria-label="导入班级方式">
          <el-radio value="existing" :disabled="!store.workspace.classes.length">
            已有班级
          </el-radio><el-radio value="new">
            新建班级
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <div class="form-grid">
        <el-form-item :label="classMode === 'new' ? '新班级名称（必填）' : '选择班级（必填）'">
          <el-input v-if="classMode === 'new'" v-model="newClassName" placeholder="例如：七年级三班" maxlength="40" aria-label="新班级名称" />
          <el-select v-else v-model="selectedClassId" placeholder="请选择班级" aria-label="单元计划班级">
            <el-option v-for="group in store.workspace.classes" :key="group.id" :label="group.name" :value="group.id" />
          </el-select>
        </el-form-item><el-form-item label="学科（必填）">
          <el-select v-model="subjectId" placeholder="请选择学科" aria-label="单元计划学科">
            <el-option v-for="item in store.workspace.subjects" :key="item.id" :label="`${item.name}（满分 ${item.max}）`" :value="item.id" />
          </el-select>
        </el-form-item>
      </div>
      <p v-if="!store.workspace.subjects.length" class="hint">
        当前档案没有学科，请先到班级设置添加学科与分数线。
      </p>
      <el-form-item label="计划名称（必填）">
        <el-input v-model="planName" placeholder="上传后默认使用文件名，可自行修改" maxlength="80" aria-label="单元计划名称" />
      </el-form-item>
      <div class="upload-actions">
        <el-button :icon="Upload" :loading="isLoading" @click="fileInput?.click()">
          上传单元成绩表
        </el-button><span class="hint">{{ fileName || '支持 .xlsx，最大 10 MB' }}</span><el-button v-if="fileName" text :disabled="isLoading" @click="removeFile">
          移除文件
        </el-button>
      </div>
      <input ref="fileInput" type="file" accept=".xlsx" hidden @change="pickFile">
      <p class="hint section-gap">
        自动识别姓名、性别、学情调研、分层、各单元目标与测试成绩，并按姓名匹配作业任务表。序号仅用于排序，学号可选；同班重名须填写学号。超目标分数和进步分数由系统重新计算，第一单元与学情调研比较，后续单元与上一单元比较。
      </p>
      <el-alert v-if="errors.length" type="error" title="请修正以下问题，当前尚未保存任何数据" :closable="false" class="section-gap">
        <ul>
          <li v-for="error in errors.slice(0, 10)" :key="error">
            {{ error }}
          </li>
        </ul><span v-if="errors.length > 10">另有 {{ errors.length - 10 }} 项错误</span>
      </el-alert>
      <el-alert v-if="preview.warnings.length" type="warning" title="导入提示" :closable="false" class="section-gap">
        <ul>
          <li v-for="warning in preview.warnings" :key="warning">
            {{ warning }}
          </li>
        </ul>
      </el-alert>
      <template v-if="preview.rows.length">
        <div class="panel-heading section-gap">
          <h2>单元成绩与分层预览</h2><span class="subtle-tag">{{ preview.rows.length }} 位学生 · {{ preview.periods.length }} 个单元</span>
        </div>
        <p class="hint">
          已有名册匹配 {{ rosterMatches }} 位，将新增 {{ preview.rows.length - rosterMatches }} 位学生。识别单元：{{ preview.periods.map(period => period.name).join('、') }}。{{ subject?.name }}满分 {{ subject?.max }} 分。
        </p>
        <el-table :data="preview.rows.slice(0, 10)" max-height="340">
          <el-table-column prop="name" label="姓名" width="100" fixed /><el-table-column prop="gender" label="性别" width="60" /><el-table-column prop="level" label="分层" width="80" /><el-table-column prop="task" label="作业任务" min-width="160" show-overflow-tooltip /><el-table-column label="学情调研" width="100">
            <template #default="{ row }">
              {{ row.baseline ?? '—' }}
            </template>
          </el-table-column><el-table-column v-for="period in preview.periods" :key="period.id" :label="period.name">
            <el-table-column label="目标" width="75">
              <template #default="{ row }">
                {{ row.scores[period.id]?.target ?? '—' }}
              </template>
            </el-table-column><el-table-column label="测试" width="75">
              <template #default="{ row }">
                {{ row.scores[period.id]?.actual ?? '—' }}
              </template>
            </el-table-column>
          </el-table-column>
        </el-table><p class="hint">
          仅预览前 10 位，确认后导入全部记录。空白或缺考保留为“—”，单元成绩独立保存，不会覆盖原有考试成绩。
        </p>
      </template>
      <el-alert v-if="replacedPlan" title="同班同科已有同名计划，导入时将确认替换该计划。" type="warning" :closable="false" class="section-gap" />
    </el-form>
    <template #footer>
      <el-button :disabled="isSaving" @click="visible = false">
        取消
      </el-button><el-button type="primary" :disabled="!canSubmit" :loading="isSaving" @click="submit">
        确认导入单元计划
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.upload-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
