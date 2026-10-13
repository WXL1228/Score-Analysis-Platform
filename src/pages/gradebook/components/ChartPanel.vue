<script lang="ts" setup>
import type { EChartsOption } from "echarts"
import { BarChart, LineChart } from "echarts/charts"
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components"
import { init, use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"

const { option, label } = defineProps<{ option: EChartsOption, label: string }>()
use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])
const container = useTemplateRef<HTMLDivElement>("container")
let chart: ReturnType<typeof init> | undefined
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!container.value) return
  chart = init(container.value)
  chart.setOption(option)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(container.value)
})
watch(() => option, value => chart?.setOption(value, true), { deep: true })
onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <div ref="container" class="chart-canvas" role="img" :aria-label="label" />
</template>

<style scoped>
.chart-canvas {
  width: 100%;
  height: 285px;
}
</style>
