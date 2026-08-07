import { defineStore } from "pinia";
import type { MenuItem } from "@/types/menu";

export const useAppSidebarMenuStore = defineStore("appSidebarMenu", (): MenuItem[] => {
  return [{
    'text': 'Navigation',
    'is_header': true
  },{
    'url': '/',
    'icon': 'ti ti-layout-dashboard',
    'text': 'Dashboard'
  },{
    'url': '/analytics',
    'icon': 'ti ti-chart-line',
    'text': 'Analytics'
  },{
    'url': '/plan',
    'icon': 'ti ti-calendar-week',
    'text': 'Plan'
  },{
    'url': '/workouts',
    'icon': 'ti ti-list-check',
    'text': 'Workouts'
  },{
    'url': '/exercises',
    'icon': 'ti ti-barbell',
    'text': 'Exercises'
  },{
    'url': '/body',
    'icon': 'ti ti-heartbeat',
    'text': 'Body'
  },{
    'url': '/nutrition',
    'icon': 'ti ti-apple',
    'text': 'Nutrition'
  },{
    'url': '/settings',
    'icon': 'ti ti-adjustments',
    'text': 'Settings'
  }]
});
