import type { EChartsOption } from "echarts"

const COLORS = ["#378777", "#d6a862", "#829dd0", "#c78b90", "#97af84"]

export function barOption(labels: string[], series: { name: string, data: number[] }[], max?: number): EChartsOption {
  return {
    color: COLORS,
    tooltip: { trigger: "axis" },
    legend: series.length > 1 ? { bottom: 0, icon: "circle" } : undefined,
    grid: { top: 20, left: 45, right: 20, bottom: series.length > 1 ? 65 : 35 },
    xAxis: { type: "category", data: labels, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#7c8887" } },
    yAxis: { type: "value", max, axisLabel: { color: "#94a09e" }, splitLine: { lineStyle: { color: "#eef1ec", type: "dashed" } } },
    series: series.map((item, index) => ({ ...item, type: "bar", barMaxWidth: 34, itemStyle: { borderRadius: [5, 5, 0, 0], color: series.length === 1 ? params => COLORS[params.dataIndex % COLORS.length] : COLORS[index % COLORS.length] } }))
  }
}

export function lineOption(labels: string[], series: { name: string, data: (number | null)[] }[], rank = false): EChartsOption {
  return {
    color: COLORS,
    tooltip: { trigger: "axis" },
    legend: { bottom: 0, icon: "circle" },
    grid: { top: 20, left: 50, right: 25, bottom: 70 },
    xAxis: { type: "category", data: labels, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: "#e5e9e4" } }, axisLabel: { color: "#7c8887", width: 100, overflow: "truncate" } },
    yAxis: { type: "value", inverse: rank, min: rank ? 1 : 0, minInterval: rank ? 1 : undefined, axisLabel: { color: "#94a09e" }, splitLine: { lineStyle: { color: "#eef1ec", type: "dashed" } } },
    series: series.map(item => ({ ...item, type: "line", smooth: 0.25, symbolSize: 8, connectNulls: false, lineStyle: { width: 3 } }))
  }
}
