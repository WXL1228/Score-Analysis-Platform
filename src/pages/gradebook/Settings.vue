<script lang="ts" setup>
import type { Exam, Subject } from "./types"
import { CacheKey } from "@@/constants/cache-key"
import { Delete, Download, Edit, Plus, Switch, Upload } from "@element-plus/icons-vue"
import { useGradebookStore } from "@/pinia/stores/gradebook"
import ClassImportDialog from "./components/ClassImportDialog.vue"
import ExamDialog from "./components/ExamDialog.vue"
import { downloadBlob } from "./files"
import { createId } from "./id"
import { parseArchive } from "./validation"

defineOptions({ name: "GradebookSettings" })
const store = useGradebookStore()
const router = useRouter()
const name = ref("")
const teacher = ref("")
const threshold = ref(5)
const editWorkspaceVisible = ref(false)
const switchWorkspaceVisible = ref(false)
const selectedWorkspaceId = ref("")
const subjects = ref<Subject[]>([])
const classes = ref<{ id: string, name: string }[]>([])
const editClassesVisible = ref(false)
const editSubjectsVisible = ref(false)
const classVisible = ref(false)
const newWorkspaceVisible = ref(false)
const newName = ref("")
const newTeacher = ref("")
const examVisible = ref(false)
const editingExam = ref<Exam>()
const restoreInput = useTemplateRef<HTMLInputElement>("restoreInput")
watch(() => store.workspace.id, () => {
  editWorkspaceVisible.value = false
  editClassesVisible.value = false
  editSubjectsVisible.value = false
  switchWorkspaceVisible.value = false
  classVisible.value = false
  examVisible.value = false
}, { immediate: true })
function editProfile() {
  name.value = store.workspace.name
  teacher.value = store.workspace.teacher
  threshold.value = store.workspace.warningThreshold
  editWorkspaceVisible.value = true
}
function saveProfile() {
  if (!name.value.trim()) return ElMessage.error("档案名称不能为空")
  if (!Number.isInteger(threshold.value) || threshold.value < 1 || threshold.value > 9999) return ElMessage.error("预警阈值须为 1～9999 的整数")
  Object.assign(store.workspace, { name: name.value.trim(), teacher: teacher.value.trim(), warningThreshold: threshold.value })
  editWorkspaceVisible.value = false
  ElMessage.success("教学档案已保存")
}
function openProfileSwitch() {
  selectedWorkspaceId.value = store.workspace.id
  switchWorkspaceVisible.value = true
}
function switchProfile() {
  store.archive.activeWorkspaceId = selectedWorkspaceId.value
  switchWorkspaceVisible.value = false
}
async function deleteProfile() {
  const data = store.workspace
  try {
    await ElMessageBox.confirm(`删除教学档案「${data.name}」及其中的 ${data.classes.length} 个班级、${data.students.length} 位学生、${data.exams.length} 次考试、${data.records.length} 条成绩和 ${data.unitPlans?.length ?? 0} 个单元计划？其他教学档案保留。删除会立即保存，建议先下载备份。${store.archive.workspaces.length === 1 ? "删除最后一个档案后会创建一个空白档案。" : ""}`, "删除教学档案", { type: "warning", confirmButtonText: "删除档案及全部数据", cancelButtonText: "取消" })
    if (store.workspace.id !== data.id || !store.deleteWorkspace(data.id)) return
    ElMessage.success("教学档案及其数据已删除")
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}
function editSubjects() {
  subjects.value = store.workspace.subjects.map(item => ({ ...item }))
  editSubjectsVisible.value = true
}
function saveSubjects() {
  try {
    store.updateSubjectSettings(subjects.value)
    editSubjectsVisible.value = false
    ElMessage.success("默认学科已保存；单独配置的考试保持各自设置")
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}
function editClasses() {
  classes.value = store.workspace.classes.map(item => ({ ...item }))
  editClassesVisible.value = true
}
async function saveClasses() {
  if (classes.value.some(item => !item.name.trim()) || new Set(classes.value.map(item => item.name.trim())).size !== classes.value.length) return ElMessage.error("班级名称不能为空或重复")
  const data = store.workspace
  const removed = data.classes.filter(item => !classes.value.some(group => group.id === item.id))
  try {
    if (removed.length) {
      const classIds = new Set(removed.map(item => item.id))
      const studentIds = new Set(data.students.filter(item => classIds.has(item.classId)).map(item => item.id))
      const recordCount = data.records.filter(item => studentIds.has(item.studentId)).length
      await ElMessageBox.confirm(`保存将删除班级「${removed.map(item => item.name).join("、")}」及 ${studentIds.size} 位学生、${recordCount} 条历次成绩。建议先下载备份。是否保存？`, "保存班级设置", { type: "warning", confirmButtonText: "保存并删除关联数据", cancelButtonText: "返回编辑" })
    }
    if (store.workspace.id !== data.id) return
    for (const group of removed) store.deleteClass(group.id)
    store.workspace.classes = classes.value.map(item => ({ ...item, name: item.name.trim() }))
    editClassesVisible.value = false
    ElMessage.success("班级设置已保存")
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}
async function handleDeleteExam(exam: Exam) {
  const data = store.workspace
  const recordCount = data.records.filter(item => item.examId === exam.id).length
  try {
    await ElMessageBox.confirm(`删除考试「${exam.name}」及本档案所有班级该次考试的 ${recordCount} 条成绩？学生名册保留。删除会立即保存；建议先下载备份。`, "删除考试", { type: "warning", confirmButtonText: "删除考试及成绩", cancelButtonText: "取消" })
    if (store.workspace.id !== data.id || !store.deleteExam(exam.id)) return
    ElMessage.success("考试及其成绩已删除")
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}
function openExam(exam?: Exam) {
  editingExam.value = exam
  examVisible.value = true
}
async function viewExamScores(exam: Exam) {
  store.workspace.selectedExamId = exam.id
  await router.push("/scores")
  window.scrollTo({ top: 0, left: 0 })
}
function createProfile() {
  if (!newName.value.trim()) return ElMessage.error("档案名称不能为空")
  store.addWorkspace(newName.value, newTeacher.value)
  newWorkspaceVisible.value = false
  newName.value = ""
  newTeacher.value = ""
  ElMessage.success("已创建独立的空白教学档案")
}
function addSubject() {
  subjects.value.push({ id: createId(), name: "", max: 100, pass: 60, excellent: 85 })
}
function backup() {
  downloadBlob(new Blob([JSON.stringify(store.archive, null, 2)], { type: "application/json" }), `成绩分析平台-全部档案备份-${new Date().toLocaleDateString("sv-SE")}.json`)
}
function rawBackup() {
  try {
    downloadBlob(new Blob([localStorage.getItem(CacheKey.GRADEBOOK_DATA) ?? ""], { type: "application/json" }), "成绩分析平台-原始缓存.json")
  } catch {
    ElMessage.error("无法读取浏览器缓存")
  }
}
async function restore(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error("备份文件过大，请核对文件")
    const parsed = parseArchive(JSON.parse(await file.text()))
    const count = parsed.workspaces.reduce((sum, item) => sum + item.students.length, 0)
    await ElMessageBox.confirm(`备份包含 ${parsed.workspaces.length} 个档案、${count} 位学生。恢复将替换当前全部档案；可先取消并下载当前备份。是否恢复？`, "恢复备份", { type: "warning", confirmButtonText: "恢复并替换", cancelButtonText: "取消" })
    store.restore(parsed)
    ElMessage.success("备份已恢复")
  } catch (error) {
    if (error instanceof Error) ElMessage.error(`恢复失败：${error.message}`)
  } finally {
    if (restoreInput.value) restoreInput.value.value = ""
  }
}
</script>

<template>
  <div>
    <section class="panel">
      <div class="panel-heading">
        <div><h2>我的教学档案</h2><p>同一浏览器可保存多个独立档案；切换无需登录。此功能不提供密码隔离。</p></div>
        <div class="profile-actions">
          <el-button :icon="Switch" @click="openProfileSwitch">
            切换档案
          </el-button><el-button :icon="Edit" type="primary" plain @click="editProfile">
            编辑
          </el-button><el-button :icon="Plus" @click="newWorkspaceVisible = true">
            新建空白档案
          </el-button><el-button :icon="Delete" type="danger" plain @click="deleteProfile">
            删除当前档案
          </el-button>
        </div>
      </div>
      <dl class="profile-details">
        <div><dt>当前档案</dt><dd>{{ store.workspace.name }}</dd></div>
        <div><dt>班主任 / 教师姓名</dt><dd>{{ store.workspace.teacher || '未填写' }}</dd></div>
        <div><dt>排名下降预警阈值</dt><dd>{{ store.workspace.warningThreshold }} 名</dd></div>
      </dl>
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>班级管理</h2><p>删除班级会同步删除该班学生与历次成绩，其他班级不受影响</p></div>
        <div class="profile-actions">
          <el-button :icon="Edit" type="primary" plain aria-label="编辑班级" @click="editClasses">
            编辑
          </el-button><el-button :icon="Plus" @click="classVisible = true">
            添加班级
          </el-button>
        </div>
      </div>
      <div v-if="store.workspace.classes.length" class="class-settings">
        <div v-for="group in store.workspace.classes" :key="group.id" class="class-text">
          {{ group.name }}
        </div>
      </div><p v-else class="hint">
        暂无班级，请先添加班级。
      </p>
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>学科与分数线</h2><p>作为考试的默认配置；单独配置的考试使用各自的学科与分数线，其他考试的同名学科继续同步默认设置。</p></div><el-button :icon="Edit" type="primary" plain aria-label="编辑学科与分数线" @click="editSubjects">
          编辑
        </el-button>
      </div><el-table :data="store.workspace.subjects" empty-text="暂无学科，可点击编辑添加，或在新建班级时上传成绩单自动识别">
        <el-table-column prop="name" label="学科名称" min-width="140" /><el-table-column prop="max" label="满分" min-width="100" /><el-table-column prop="pass" label="及格分" min-width="100" /><el-table-column prop="excellent" label="优秀分" min-width="100" />
      </el-table>
    </section>
    <el-dialog v-model="editClassesVisible" title="编辑班级" width="700px">
      <div class="class-settings">
        <div v-for="group in classes" :key="group.id" class="class-row">
          <el-input v-model="group.name" maxlength="40" :aria-label="`班级名称 ${group.name}`" /><el-button type="danger" plain :icon="Delete" :aria-label="`删除班级 ${group.name}`" @click="classes = classes.filter(item => item.id !== group.id)">
            删除
          </el-button>
        </div>
      </div><p class="hint section-gap">
        保存后名称修改与删除才会生效；取消会撤销本次编辑。删除班级时会一并删除该班学生与历次成绩。
      </p>
      <template #footer>
        <el-button @click="editClassesVisible = false">
          取消
        </el-button><el-button type="primary" @click="saveClasses">
          保存班级
        </el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="editSubjectsVisible" title="编辑学科与分数线" width="850px">
      <el-button :icon="Plus" @click="addSubject">
        添加学科
      </el-button><el-table :data="subjects" class="section-gap">
        <el-table-column label="学科名称" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="20" aria-label="学科名称" />
          </template>
        </el-table-column><el-table-column label="满分" min-width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.max" :min="1" :max="10000" :precision="1" controls-position="right" aria-label="学科满分" />
          </template>
        </el-table-column><el-table-column label="及格分" min-width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.pass" :min="0" :max="row.max" :precision="1" controls-position="right" aria-label="学科及格分" />
          </template>
        </el-table-column><el-table-column label="优秀分" min-width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.excellent" :min="0" :max="row.max" :precision="1" controls-position="right" aria-label="学科优秀分" />
          </template>
        </el-table-column><el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button text type="danger" @click="subjects = subjects.filter(item => item.id !== row.id)">
              移除
            </el-button>
          </template>
        </el-table-column>
      </el-table><p class="hint section-gap">
        分数线要求：0 ≤ 及格分 ≤ 优秀分 ≤ 满分。可暂不设置默认学科，也可在新建或编辑考试时单独配置。
      </p>
      <template #footer>
        <el-button @click="editSubjectsVisible = false">
          取消
        </el-button><el-button type="primary" @click="saveSubjects">
          保存学科与分数线
        </el-button>
      </template>
    </el-dialog>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>考试记录</h2><p>点击编辑可配置本次考试的学科与分数线，上传成绩只导入配置的学科。</p></div><el-button :icon="Plus" @click="openExam()">
          新建考试
        </el-button>
      </div><el-table :data="store.workspace.exams" empty-text="暂无考试">
        <el-table-column prop="name" label="考试名称" min-width="160" /><el-table-column prop="date" label="日期" width="130" /><el-table-column label="考试学科与满分" min-width="260">
          <template #default="{ row }">
            {{ row.subjects.map((item: Subject) => `${item.name} ${item.max}分`).join(' · ') }}
          </template>
        </el-table-column><el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" :icon="Edit" :aria-label="`编辑考试 ${row.name}`" @click="openExam(row as Exam)">
              编辑
            </el-button>
            <el-button text type="primary" :aria-label="`查看 ${row.name} 成绩`" @click="viewExamScores(row as Exam)">
              查看成绩
            </el-button><el-button text type="danger" :icon="Delete" :aria-label="`删除考试 ${row.name}`" @click="handleDeleteExam(row as Exam)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
    <section class="panel section-gap">
      <div class="panel-heading">
        <div><h2>备份与恢复</h2><p>备份包含全部本地档案、学生、考试、成绩与设置</p></div>
      </div><p class="hint">
        正常模式下关闭浏览器后数据仍会保留。浏览器清理网站数据、隐私模式、换设备或换网址不会自动迁移数据；请下载 JSON 备份，需要时在新浏览器恢复。备份内含学生成绩，请妥善保存。
      </p><div class="toolbar-group section-gap">
        <el-button type="primary" :icon="Download" @click="backup">
          下载全部档案备份
        </el-button><el-button :icon="Upload" @click="restoreInput?.click()">
          从 JSON 恢复
        </el-button><el-button v-if="store.loadError" @click="rawBackup">
          下载无法读取的原始缓存
        </el-button>
      </div><input ref="restoreInput" type="file" accept=".json" hidden @change="restore">
    </section>
    <el-dialog v-model="switchWorkspaceVisible" title="切换教学档案" width="460px">
      <el-form label-position="top">
        <el-form-item label="选择档案">
          <el-select v-model="selectedWorkspaceId" aria-label="选择教学档案">
            <el-option v-for="item in store.archive.workspaces" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="switchWorkspaceVisible = false">
          取消
        </el-button><el-button type="primary" @click="switchProfile">
          确认切换
        </el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="editWorkspaceVisible" title="编辑教学档案" width="460px">
      <el-form label-position="top">
        <el-form-item label="档案名称（必填）">
          <el-input v-model="name" maxlength="40" aria-label="档案名称" />
        </el-form-item><el-form-item label="班主任 / 教师姓名">
          <el-input v-model="teacher" maxlength="30" aria-label="教师姓名" />
        </el-form-item><el-form-item label="排名下降预警阈值（名）">
          <el-input-number v-model="threshold" :min="1" :max="9999" :precision="0" aria-label="排名下降预警阈值" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editWorkspaceVisible = false">
          取消
        </el-button><el-button type="primary" @click="saveProfile">
          保存档案
        </el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="newWorkspaceVisible" title="新建我的教学档案" width="460px">
      <el-form label-position="top">
        <el-form-item label="档案名称（必填）">
          <el-input v-model="newName" placeholder="例如：2026 学年八年级" maxlength="40" />
        </el-form-item><el-form-item label="教师姓名">
          <el-input v-model="newTeacher" maxlength="30" />
        </el-form-item>
      </el-form><p class="hint">
        新档案为空白，与已有档案独立保存；创建后可设置班级并导入成绩。
      </p><template #footer>
        <el-button @click="newWorkspaceVisible = false">
          取消
        </el-button><el-button type="primary" @click="createProfile">
          创建空白档案
        </el-button>
      </template>
    </el-dialog><ExamDialog v-model="examVisible" :exam="editingExam" /><ClassImportDialog v-model="classVisible" />
  </div>
</template>

<style scoped>
.profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.profile-actions .el-button {
  margin-left: 0;
}
.profile-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin: 24px 0 0;
}
.profile-details dt {
  color: #97a48f;
  font-size: 12px;
}
.profile-details dd {
  margin: 10px 0 0;
  font-size: 15px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.class-settings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px;
}
.class-row {
  display: flex;
  gap: 10px;
}
.class-text {
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
</style>
