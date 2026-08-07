import { defineStore } from "pinia";

export const useAppOptionStore = defineStore("appOption", () => {
	return {
		appMode: 'system',
		appThemeClass: '',
		appHeaderHide: false,
		appSidebarToggled: true,
		appSidebarCollapsed: false,
		appSidebarMobileToggled: false,
		appSidebarHide: false,
		appContentClass: '',
	}
});
