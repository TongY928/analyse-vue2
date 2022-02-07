/* @flow */

import config from "../config";
import Watcher from "../observer/watcher";
import { mark, measure } from "../util/perf";
import { createEmptyVNode } from "../vdom/vnode";
import { updateComponentListeners } from "./events";
import { resolveSlots } from "./render-helpers/resolve-slots";
import { toggleObserving } from "../observer/index";
import { pushTarget, popTarget } from "../observer/dep";

import {
  warn,
  noop,
  remove,
  emptyObject,
  validateProp,
  invokeWithErrorHandling,
} from "../util/index";

// 全局变量，某个时刻创建子组件实例相关
export let activeInstance: any = null;
// 全局变量，某个时刻更新组件相关
export let isUpdatingChildComponent: boolean = false;

export function setActiveInstance(vm: Component) {
  // 记录旧值
  const prevActiveInstance = activeInstance;
  // 把当前 vm 实例赋值给 activeInstance
  // activeInstance 表示当前正在激活的 vm 实例
  // 当前实例中再去创建子组件时，当前实例就能作为父实例
  activeInstance = vm;
  return () => {
    activeInstance = prevActiveInstance;
  };
}

// 初始化声明周期的一些属性标志，最重要的是，正确建立父、子组件之间的关系
export function initLifecycle(vm: Component) {
  const options = vm.$options;

  // locate first non-abstract parent
  // 激活子组件的时候，就可以拿到父组件的 vm 实例
  let parent = options.parent;
  if (parent && !options.abstract) {
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent;
    }
    // 把当前实例 push 到父的 children 属性中
    parent.$children.push(vm);
  }

  // 设置 parent 属性
  vm.$parent = parent;
  // 其实就是根 Vue 实例，每一层都会向上传递这个属性
  vm.$root = parent ? parent.$root : vm;

  vm.$children = [];
  vm.$refs = {};

  vm._watcher = null;
  vm._inactive = null;
  vm._directInactive = false;
  vm._isMounted = false;
  vm._isDestroyed = false;
  vm._isBeingDestroyed = false;
}

export function lifecycleMixin(Vue: Class<Component>) {
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    // vue 实例
    const vm: Component = this;
    const prevEl = vm.$el;
    const prevVnode = vm._vnode;
    const restoreActiveInstance = setActiveInstance(vm);
    // 当前的渲染 vnode，vm.$vnode 是父 vnode
    vm._vnode = vnode;
    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.

    // 首次渲染时，prevNode 是空
    if (!prevVnode) {
      // initial render
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */);
    } else {
      // updates
      vm.$el = vm.__patch__(prevVnode, vnode);
    }
    // 退回 activeInstance 的值
    restoreActiveInstance();
    // update __vue__ reference
    if (prevEl) {
      prevEl.__vue__ = null;
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm;
    }
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el;
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  };

  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this;
    if (vm._watcher) {
      vm._watcher.update();
    }
  };

  Vue.prototype.$destroy = function () {
    const vm: Component = this;
    // 正在销毁，不重复执行
    if (vm._isBeingDestroyed) {
      return;
    }
    callHook(vm, "beforeDestroy");
    // 标志位
    vm._isBeingDestroyed = true;
    // remove self from parent
    const parent = vm.$parent;
    // 从 children 中移除当前实例
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm);
    }
    // 销毁组件 watcher
    if (vm._watcher) {
      vm._watcher.teardown();
    }
    let i = vm._watchers.length;
    // 当前组件绑定的响应式 watcher
    while (i--) {
      vm._watchers[i].teardown();
    }

    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--;
    }
    // call the last hook...
    vm._isDestroyed = true;
    // 这样就可以移除当前 vnode，会递归调用子 vnode 的销毁过程
    vm.__patch__(vm._vnode, null);
    // fire destroyed hook
    callHook(vm, "destroyed");
    // turn off all instance listeners.
    vm.$off();
    // remove __vue__ reference
    if (vm.$el) {
      vm.$el.__vue__ = null;
    }
    // release circular reference (#6759)
    if (vm.$vnode) {
      vm.$vnode.parent = null;
    }
  };
}

export function mountComponent(
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  // $el 是根据传入的 el 获取到的 dom 对象
  vm.$el = el;
  // 没有定义 render 函数，无法生成 VNode，也就无法继续进行
  if (!vm.$options.render) {
    vm.$options.render = createEmptyVNode;
    if (process.env.NODE_ENV !== "production") {
      /* istanbul ignore if */
      // 如果我们使用的是 runtime-only 版本，但是定义了 template 并且不是 id，是一个字符串模板，那么是无法被编译解析的
      if (
        (vm.$options.template && vm.$options.template.charAt(0) !== "#") ||
        vm.$options.el ||
        el
      ) {
        warn(
          "You are using the runtime-only build of Vue where the template " +
            "compiler is not available. Either pre-compile the templates into " +
            "render functions, or use the compiler-included build.",
          vm
        );
      } else {
        warn(
          "Failed to mount component: template or render function not defined.",
          vm
        );
      }
    }
  }
  callHook(vm, "beforeMount");

  let updateComponent;
  /* istanbul ignore if */
  // 埋点，和性能相关
  if (process.env.NODE_ENV !== "production" && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name;
      const id = vm._uid;
      const startTag = `vue-perf-start:${id}`;
      const endTag = `vue-perf-end:${id}`;

      mark(startTag);
      const vnode = vm._render();
      mark(endTag);
      measure(`vue ${name} render`, startTag, endTag);

      mark(startTag);
      vm._update(vnode, hydrating);
      mark(endTag);
      measure(`vue ${name} patch`, startTag, endTag);
    };
  } else {
    // 渲染相关的方法
    updateComponent = () => {
      // render 生成 VNode； update 方法就是一次真实的渲染，把 VNode 渲染成 HTML 中的 DOM
      vm._update(vm._render(), hydrating);
    };
  }

  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined
  // 渲染相关的 watcher
  // 数据改变，驱动视图更新，依赖的就是这个 watcher
  new Watcher(
    vm,
    updateComponent,
    noop,
    {
      before() {
        if (vm._isMounted && !vm._isDestroyed) {
          callHook(vm, "beforeUpdate");
        }
      },
    },
    true /* isRenderWatcher */
  );
  hydrating = false;

  // $vnode 表示 vue 实例的父虚拟节点，如果为 null，表示当前就是根 Vue 实例
  if (vm.$vnode == null) {
    vm._isMounted = true;
    callHook(vm, "mounted");
  }
  return vm;
}

export function updateChildComponent(
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  if (process.env.NODE_ENV !== "production") {
    isUpdatingChildComponent = true;
  }

  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren.

  // check if there are dynamic scopedSlots (hand-written or compiled but with
  // dynamic slot names). Static scoped slots compiled from template has the
  // "$stable" marker.
  const newScopedSlots = parentVnode.data.scopedSlots;
  const oldScopedSlots = vm.$scopedSlots;
  const hasDynamicScopedSlot = !!(
    (newScopedSlots && !newScopedSlots.$stable) ||
    (oldScopedSlots !== emptyObject && !oldScopedSlots.$stable) ||
    (newScopedSlots && vm.$scopedSlots.$key !== newScopedSlots.$key) ||
    (!newScopedSlots && vm.$scopedSlots.$key)
  );

  // Any static slot children from the parent may have changed during parent's
  // update. Dynamic scoped slots may also have changed. In such cases, a forced
  // update is necessary to ensure correctness.
  const needsForceUpdate = !!(
    renderChildren || // has new static slots
    vm.$options._renderChildren || // has old static slots
    hasDynamicScopedSlot
  );

  vm.$options._parentVnode = parentVnode;
  vm.$vnode = parentVnode; // update vm's placeholder node without re-render

  if (vm._vnode) {
    // update child tree's parent
    vm._vnode.parent = parentVnode;
  }
  vm.$options._renderChildren = renderChildren;

  // update $attrs and $listeners hash
  // these are also reactive so they may trigger child update if the child
  // used them during render
  vm.$attrs = parentVnode.data.attrs || emptyObject;
  vm.$listeners = listeners || emptyObject;

  // propsData 是父组件传递的 props 数据
  if (propsData && vm.$options.props) {
    toggleObserving(false);
    // 子组件的 props
    const props = vm._props;
    // props 的所有 key
    const propKeys = vm.$options._propKeys || [];
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i];
      const propOptions: any = vm.$options.props;
      // 重新验证和计算 prop 的值，更新 vm._props
      props[key] = validateProp(key, propOptions, propsData, vm);
    }
    toggleObserving(true);
    //
    vm.$options.propsData = propsData;
  }

  // update listeners
  listeners = listeners || emptyObject;
  const oldListeners = vm.$options._parentListeners;
  vm.$options._parentListeners = listeners;
  updateComponentListeners(vm, listeners, oldListeners);

  // resolve slots + force update if has children
  if (needsForceUpdate) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context);
    vm.$forceUpdate();
  }

  if (process.env.NODE_ENV !== "production") {
    isUpdatingChildComponent = false;
  }
}

function isInInactiveTree(vm) {
  while (vm && (vm = vm.$parent)) {
    if (vm._inactive) return true;
  }
  return false;
}

export function activateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false;
    if (isInInactiveTree(vm)) {
      return;
    }
  } else if (vm._directInactive) {
    return;
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false;
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i]);
    }
    callHook(vm, "activated");
  }
}

export function deactivateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true;
    if (isInInactiveTree(vm)) {
      return;
    }
  }
  if (!vm._inactive) {
    vm._inactive = true;
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i]);
    }
    callHook(vm, "deactivated");
  }
}

export function callHook(vm: Component, hook: string) {
  // #7573 disable dep collection when invoking lifecycle hooks
  pushTarget();
  const handlers = vm.$options[hook];
  const info = `${hook} hook`;
  if (handlers) {
    for (let i = 0, j = handlers.length; i < j; i++) {
      invokeWithErrorHandling(handlers[i], vm, null, vm, info);
    }
  }
  if (vm._hasHookEvent) {
    vm.$emit("hook:" + hook);
  }
  popTarget();
}
