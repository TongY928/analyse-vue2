import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'


// Vue 其实就是一个构造函数
function Vue (options) {
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}

// 初始化
initMixin(Vue)
// 挂载一些状态相关的属性和方法
stateMixin(Vue)
// 事件相关
eventsMixin(Vue)
// 生命周期
lifecycleMixin(Vue)
// render 方法
renderMixin(Vue)

export default Vue
