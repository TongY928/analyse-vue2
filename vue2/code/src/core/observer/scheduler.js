/* @flow */

import type Watcher from "./watcher";
import config from "../config";
import { callHook, activateChildComponent } from "../instance/lifecycle";

import { warn, nextTick, devtools, inBrowser, isIE } from "../util/index";

export const MAX_UPDATE_COUNT = 100;

const queue: Array<Watcher> = [];
const activatedChildren: Array<Component> = [];
let has: { [key: number]: ?true } = {};
let circular: { [key: number]: number } = {};
let waiting = false;
let flushing = false;
let index = 0;

function resetSchedulerState() {
  index = queue.length = activatedChildren.length = 0;
  has = {};
  if (process.env.NODE_ENV !== "production") {
    circular = {};
  }
  waiting = flushing = false;
}

// attached during that flush.
export let currentFlushTimestamp = 0;

let getNow: () => number = Date.now;

if (inBrowser && !isIE) {
  const performance = window.performance;
  if (
    performance &&
    typeof performance.now === "function" &&
    getNow() > document.createEvent("Event").timeStamp
  ) {
    getNow = () => performance.now();
  }
}

function flushSchedulerQueue() {
  currentFlushTimestamp = getNow();
  flushing = true;
  let watcher, id;

  // 对 queue 排序有三种场景应用场景
  // 1. 组件更新，因为创建的时候就是父组件先创建，那么更新也是父组件先更新
  // 2. 当我们使用 Vue.watch 或者在组件中配置了 watch 时，相当于又创建出一种新的 watch，它要先执行，因为它是在 options 中的，比渲染 watcher 要生成的早
  // 3. 当一个组件要销毁时，直接销毁父组件 watcher 就可以
  queue.sort((a, b) => a.id - b.id);

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index];
    // 调用 before 钩子函数
    if (watcher.before) {
      watcher.before();
    }
    // 从当前队列中删除
    id = watcher.id;
    has[id] = null;
    // 调用 run 方法
    watcher.run();
    // 可能会存在嵌套更新，这里会设置一个阈值
    if (process.env.NODE_ENV !== "production" && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1;
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          "You may have an infinite update loop " +
            (watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`),
          watcher.vm
        );
        break;
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice();
  const updatedQueue = queue.slice();

  // 重置跟 schedule 相关的 state
  resetSchedulerState();

  // call component updated and activated hooks
  callActivatedHooks(activatedQueue);
  // updated 钩子函数
  callUpdatedHooks(updatedQueue);

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit("flush");
  }
}

function callUpdatedHooks(queue) {
  let i = queue.length;
  while (i--) {
    const watcher = queue[i];
    const vm = watcher.vm;
    if (vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, "updated");
    }
  }
}

export function queueActivatedComponent(vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false;
  activatedChildren.push(vm);
}

function callActivatedHooks(queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true;
    activateChildComponent(queue[i], true /* true */);
  }
}

export function queueWatcher(watcher: Watcher) {
  const id = watcher.id;
  // 如果当前 watcher 没有加入到过队列，那么直接加入
  if (has[id] == null) {
    has[id] = true;
    // 是否在执行 flush 操作
    if (!flushing) {
      queue.push(watcher);
    } else {
      // 根据 id 来找到当前 watcher 合适的插入位置
      let i = queue.length - 1;
      while (i > index && queue[i].id > watcher.id) {
        i--;
      }
      queue.splice(i + 1, 0, watcher);
    }
    // waiting 保证当前队列只进行一次 flush 操作
    if (!waiting) {
      waiting = true;

      // 如果是开发环境，会走 flushSchedulerQueue 方法
      if (process.env.NODE_ENV !== "production" && !config.async) {
        flushSchedulerQueue();
        return;
      }
      // 生产环境，走 nextTick
      nextTick(flushSchedulerQueue);
    }
  }
}
