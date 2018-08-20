import Vue from 'vue'
import VueRouter from 'vue-router'

// routes
import Home from './components/home'
import Agent from './components/agent'
import Caller from './components/caller'
import EndCall from './components/end-call'
import Callback from './components/callback'
import { requireAuth } from './utils/auth'

Vue.use(VueRouter)

const router = new VueRouter({
  routes: [
    { path: '/', component: Home },
    { path: '/agent', component: Agent, beforeEnter: requireAuth },
    { path: '/caller', component: Caller },
    { path: '/end', component: EndCall },
    { path: '/callback', component: Callback }
  ]
})

new Vue({
  router
  // render: h => h(App)
}).$mount('#app')
