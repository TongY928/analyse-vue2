/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop,
} from "../util/index";

import { traverse } from "./traverse";
import { queueWatcher } from "./scheduler";
import Dep, { pushTarget, popTarget } from "./dep";

import type { SimpleSet } from "../util/index";

let uid = 0;

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor(
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm;
    // 渲染 watcher 传入的 expression 是 updateComponent 方法，调用这个方法会调用 vm._update 然后重新执行 _render(这时就会访问到更新后的值)，然后再 patch 到 DOM 上
    if (isRenderWatcher) {
      vm._watcher = this;
    }
    vm._watchers.push(this);
    // options
    if (options) {
      this.deep = !!options.deep;
      this.user = !!options.user;
      this.lazy = !!options.lazy;
      this.sync = !!options.sync;
      this.before = options.before;
    } else {
      this.deep = this.user = this.lazy = this.sync = false;
    }
    this.cb = cb;
    this.id = ++uid; // uid for batching
    this.active = true;
    this.dirty = this.lazy; // for lazy watchers
    this.deps = [];
    this.newDeps = [];
    this.depIds = new Set();
    this.newDepIds = new Set();
    this.expression =
      process.env.NODE_ENV !== "production" ? expOrFn.toString() : "";
    // parse expression for getter
    if (typeof expOrFn === "function") {
      this.getter = expOrFn;
    } else {
      this.getter = parsePath(expOrFn);
      if (!this.getter) {
        this.getter = noop;
        process.env.NODE_ENV !== "production" &&
          warn(
            `Failed watching path: "${expOrFn}" ` +
              "Watcher only accepts simple dot-delimited paths. " +
              "For full control, use a function instead.",
            vm
          );
      }
    }
    // 调用 get 来获取值，如果是一个 computed watcher，不会马上求值
    this.value = this.lazy ? undefined : this.get();
  }

  get() {
    // 把当前 watcher 赋值给 Dep.target
    pushTarget(this);
    let value;
    const vm = this.vm;
    try {
      // 调用传入的依赖行为
      value = this.getter.call(vm, vm);
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`);
      } else {
        throw e;
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value);
      }
      // 当前 watcher 执行完毕，移除 target
      popTarget();
      // 清除收集的 Dep，相当于每次 get 都会刷新一遍 Dep 列表
      // 每次都会通过 addDep 把最新的依赖收集起来，然后把上次的，也就是 deps 和 depIds 清空，然后把新的再用 deps 和 depIds 存放
      // 也就是说，每次清空的是 newDeps 和 newDepIds
      // 为什么要清除上次 update 的依赖呢?
      // 因为数据是变化的，我们可能下次不依赖某个数据了，但是我们还收集了它的 dep，那么还是会通知更新渲染，
      // 但是我们的视图没有引用这个数据的，这次更新可以说是没有意义的
      this.cleanupDeps();
    }
    return value;
  }

  addDep(dep: Dep) {
    // 先把 dep 实例存放到当前 watcher 中
    const id = dep.id;
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id);
      this.newDeps.push(dep);
      // 如果遇到了没有收集过的 DepId
      if (!this.depIds.has(id)) {
        // 调用 dep.addSub，让 dep 去收集当前 watcher
        dep.addSub(this);
      }
    }
  }

  // 清除收集的 dep
  cleanupDeps() {
    let i = this.deps.length;
    while (i--) {
      const dep = this.deps[i];
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this);
      }
    }
    let tmp = this.depIds;
    // depIds 是对 newDepIds 进行保留
    this.depIds = this.newDepIds;
    this.newDepIds = tmp;
    this.newDepIds.clear();
    tmp = this.deps;
    // deps 对 newDeps 进行保留
    this.deps = this.newDeps;
    this.newDeps = tmp;
    this.newDeps.length = 0;
  }

  update() {
    // 如果为 computed watcher，把标志位置为 true
    if (this.lazy) {
      this.dirty = true;
      // 如果是同步的，则直接调用 run 方法
    } else if (this.sync) {
      this.run();
    } else {
      // 否则把当前 watcher 加入到一个队列中
      queueWatcher(this);
    }
  }

  // 重新调用 get 才是让组件更新的根本原因，因为会重新调用 render 方法，生成不一样的 Vnode
  run() {
    if (this.active) {
      // 调用 get 获取新的值
      const value = this.get();
      // 如果值不一样，或者是一个对象，或者是一个 deep watcher
      if (value !== this.value || isObject(value) || this.deep) {
        // set new value
        const oldValue = this.value;
        this.value = value;
        // user watcher，也就是通过 watch 方法创建的 watcher
        if (this.user) {
          const info = `callback for watcher "${this.expression}"`;
          invokeWithErrorHandling(
            this.cb,
            this.vm,
            [value, oldValue],
            this.vm,
            info
          );
        } else {
          // 执行回调
          this.cb.call(this.vm, value, oldValue);
        }
      }
    }
  }

  // 对 value 求值
  evaluate() {
    this.value = this.get();
    this.dirty = false;
  }

  // computed watcher 特有，让 computed 里面引用的响应式数据来收集依赖，这里的依赖是 render watcher
  depend() {
    let i = this.deps.length;
    while (i--) {
      this.deps[i].depend();
    }
  }

  // 销毁当前 watcher 实例
  teardown() {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this);
      }
      let i = this.deps.length;
      while (i--) {
        this.deps[i].removeSub(this);
      }
      this.active = false;
    }
  }
}
