import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { Vue3ProgressPlugin } from '@marcoschulte/vue3-progress';
import { PerfectScrollbarPlugin } from 'vue3-perfect-scrollbar';
import mitt from 'mitt';
import 'vue3-perfect-scrollbar/style.css';
// Latin only, on purpose: the unsuffixed entrypoints also pull Thai, Vietnamese
// and latin-ext, which is 200 KB this app has no use for.
import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import './assets/icons/icons.css';
import 'bootstrap';
import './scss/styles.scss';

import App from './App.vue';
import router from './router';

import Card from '@/components/bootstrap/Card.vue';
import CardBody from '@/components/bootstrap/CardBody.vue';
import CardExpandToggler from '@/components/bootstrap/CardExpandToggler.vue';

const emitter = mitt();
const app = createApp(App);

app.component('Card', Card);
app.component('CardBody', CardBody);
app.component('CardExpandToggler', CardExpandToggler);

app.use(createPinia());
app.use(router);
app.use(Vue3ProgressPlugin);
app.use(PerfectScrollbarPlugin);

app.config.globalProperties.emitter = emitter;
app.mount('#app');
