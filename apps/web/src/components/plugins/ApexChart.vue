<script lang="ts">
import { defineComponent } from 'vue';
import VueApexCharts from "vue3-apexcharts";
import { useAppVariableStore } from '@/stores/app-variable';

const appVariable = useAppVariableStore();

export function getApexConfiguration() {
	return {
		chart: {
			// Dragging across a chart used to rubber-band a selection and zoom into
			// it. On a touch screen that is indistinguishable from scrolling the page
			// past a chart, and the way back out is the toolbar, which is hidden on
			// every chart in the app. Off everywhere: a drag should read out values,
			// not navigate.
			zoom: { enabled: false },
			selection: { enabled: false },
		},
		title: {
			style: {
				fontSize: '14px',
				fontWeight: '600',
				fontFamily: appVariable.font.bodyFontFamily,
				color: appVariable.color.bodyColor
			}
		},
		legend: {
			fontFamily: appVariable.font.bodyFontFamily,
			labels: { colors: appVariable.color.bodyColor }
		},
		tooltip: {
			style: {
				fontSize: '12px',
				fontFamily: appVariable.font.bodyFontFamily
			},
			// Read out the nearest point rather than demanding a hit on the bar or
			// marker itself. Columns are 55% of their slot, so nearly half of a
			// pointer sweep across a chart fell in the gaps and showed nothing.
			intersect: false
		},
		grid: { borderColor: appVariable.color.borderColor },
		dataLabels: {
			style: {
				fontSize: '12px',
				fontFamily: appVariable.font.bodyFontFamily,
				fontWeight: '600',
				colors: undefined
			}
		},
		xaxis: {
			axisBorder: {
				show: true,
				color: appVariable.color.borderColor,
				height: 1,
				width: '100%',
				offsetX: 0,
				offsetY: -1
			},
			axisTicks: {
				show: true,
				borderType: 'solid',
				color: appVariable.color.borderColor,
				height: 6,
				offsetX: 0,
				offsetY: 0
			},
			labels: {
				style: {
					colors: appVariable.color.bodyColor,
					fontSize: '12px',
					fontFamily: appVariable.font.bodyFontFamily,
					fontWeight: appVariable.font.bodyFontWeight,
					cssClass: 'apexcharts-xaxis-label',
				}
			}
		},
		yaxis: {
			labels: {
				style: {
					colors: appVariable.color.bodyColor,
					fontSize: '12px',
					fontFamily: appVariable.font.bodyFontFamily,
					fontWeight: appVariable.font.bodyFontWeight,
					cssClass: 'apexcharts-xaxis-label',
				}
			}
		}
	};
}

// ApexCharts reads its global default styling from `window.Apex`, created as a side
// effect of importing the library.
(window as unknown as { Apex: unknown }).Apex = getApexConfiguration();

export default defineComponent({
	props: ['height', 'options', 'series'],
  components: {
    apexchart: VueApexCharts,
  }
});
</script>

<template>
  <div>
    <apexchart
      :height="height"
      :options="options"
      :series="series"
    ></apexchart>
  </div>
</template>