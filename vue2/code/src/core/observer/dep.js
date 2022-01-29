/* @flow */

import type Watcher from "./watcher";
import { remove } from "../util/index";
import config from "../config";

let uid = 0;

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
export default class Dep {
  // 需要收集的目标 watcher
  static target: ?Watcher;
  id: number;
  subs: Array<Watcher>;

  constructor() {
    // id 来区分 dep 实例
    this.id = uid++;
    // 当前 dep 收集的依赖都放在 subs 中
    this.subs = [];
  }

  addSub(sub: Watcher) {
    this.subs.push(sub);
  }

  removeSub(sub: Watcher) {
    remove(this.subs, sub);
  }

  // 收集依赖
  depend() {
    if (Dep.target) {
      // 调用 watcher 的 addDep 方法
      Dep.target.addDep(this);
    }
  }
  // 派发更新
  notify() {
    // stabilize the subscriber list first
    const subs = this.subs.slice();
    if (process.env.NODE_ENV !== "production" && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id);
    }
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update();
    }
  }
}

Dep.target = null;
const targetStack = [];

// 考虑到组件嵌套的过程，所以使用一个栈来管理 target
export function pushTarget(target: ?Watcher) {
  targetStack.push(target);
  Dep.target = target;
}

export function popTarget() {
  targetStack.pop();
  Dep.target = targetStack[targetStack.length - 1];
}
