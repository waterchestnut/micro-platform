import { createApp } from 'vue'
import { createPinia } from 'pinia'
import FileViewer from '@flyfish-group/file-viewer3'
import App from './App.vue'
import router from './router'
import './styles/global.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(FileViewer)

app.mount('#app')
