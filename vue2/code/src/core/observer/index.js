/* @flow */

import Dep from "./dep";
import VNode from "../vdom/vnode";
import { arrayMethods } from "./array";
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering,
} from "../util/index";

// 数据需要拦截的方法
const arrayKeys = Object.getOwnPropertyNames(arrayMethods);

// 通过这个参数来控制是否让数据响应式化
export let shouldObserve: boolean = true;

export function toggleObserving(value: boolean) {
  shouldObserve = value;
}

export class Observer {
  value: any;
  dep: Dep;
  vmCount: number;

  constructor(value: any) {
    // 存放 value
    this.value = value;
    // 依赖收集器
    this.dep = new Dep();
    this.vmCount = 0;
    // 给当前 value 打上标记，表示当前对象是一个响应式对象，def 方法是通过 Object.defineProperty 给传入的对象添加一个属性
    def(value, "__ob__", this);
    // 处理 array
    if (Array.isArray(value)) {
      // 把拦截器方法覆盖原生方法
      if (hasProto) {
        protoAugment(value, arrayMethods);
      } else {
        copyAugment(value, arrayMethods, arrayKeys);
      }
      this.observeArray(value);
    } else {
      // 处理普通对象
      this.walk(value);
    }
  }

  // 把对象响应式化
  walk(obj: Object) {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      // 把对象的每个数据都变为响应式
      defineReactive(obj, keys[i]);
    }
  }
  // 把数组响应式化
  observeArray(items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i]);
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment(target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src;
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment(target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i];
    def(target, key, src[key]);
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe(value: any, asRootData: ?boolean): Observer | void {
  // 必须为一个对象，并且不能为 VNode 实例
  if (!isObject(value) || value instanceof VNode) {
    return;
  }
  let ob: Observer | void;
  // 如果 value 已经是响应式对象了，那么直接通过 __ob__ 去拿到
  if (hasOwn(value, "__ob__") && value.__ob__ instanceof Observer) {
    ob = value.__ob__;
  } else if (
    // 标志位  && 不是 SSR && 为一个数组或者普通对象，并对象是可扩展属性的（这样才能通过 defineProperty 来定制），并且不是一个 vue 实例
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value);
  }
  if (asRootData && ob) {
    ob.vmCount++;
  }
  return ob;
}

/**
 * Define a reactive property on an Object.
 */
export function defineReactive(
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  const dep = new Dep();

  const property = Object.getOwnPropertyDescriptor(obj, key);
  // 不可配置，直接返回
  if (property && property.configurable === false) {
    return;
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get;
  const setter = property && property.set;
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key];
  }

  // 如果不是浅响应式化，那么进行递归处理，把 val 也响应式化
  // childOb 是 val 的 observer 实例
  let childOb = !shallow && observe(val);
  // 配置属性的 get 和 set
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    // get 主要做依赖收集的事情
    get: function reactiveGetter() {
      // 如果显式定义的有 getter，调用，否则直接返回 value
      const value = getter ? getter.call(obj) : val;
      // 在返回之前，要进行收集依赖操作，这样可以在数据改变时，通知这个目标
      if (Dep.target) {
        // 收集依赖
        dep.depend();
        // 如果有 childOb，则让它也进行收集，这样更新的时候，才会都更新
        if (childOb) {
          childOb.dep.depend();
          // 如果 value 是一个数组
          if (Array.isArray(value)) {
            dependArray(value);
          }
        }
      }
      return value;
    },
    // set 主要做派发更新的事情
    set: function reactiveSetter(newVal) {
      const value = getter ? getter.call(obj) : val;
      // 如果值一样，那么什么都不做
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return;
      }

      if (process.env.NODE_ENV !== "production" && customSetter) {
        customSetter();
      }

      if (getter && !setter) return;
      if (setter) {
        setter.call(obj, newVal);
      } else {
        val = newVal;
      }
      // 对新值进行 observe
      childOb = !shallow && observe(newVal);
      dep.notify();
    },
  });
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set(target: Array<any> | Object, key: any, val: any): any {
  if (
    process.env.NODE_ENV !== "production" &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(
      `Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`
    );
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key);
    target.splice(key, 1, val);
    return val;
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val;
    return val;
  }
  const ob = (target: any).__ob__;
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        "Avoid adding reactive properties to a Vue instance or its root $data " +
          "at runtime - declare it upfront in the data option."
      );
    return val;
  }
  if (!ob) {
    target[key] = val;
    return val;
  }
  defineReactive(ob.value, key, val);
  ob.dep.notify();
  return val;
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del(target: Array<any> | Object, key: any) {
  if (
    process.env.NODE_ENV !== "production" &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(
      `Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`
    );
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1);
    return;
  }
  const ob = (target: any).__ob__;
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        "Avoid deleting properties on a Vue instance or its root $data " +
          "- just set it to null."
      );
    return;
  }
  if (!hasOwn(target, key)) {
    return;
  }
  delete target[key];
  if (!ob) {
    return;
  }
  ob.dep.notify();
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray(value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i];
    e && e.__ob__ && e.__ob__.dep.depend();
    if (Array.isArray(e)) {
      dependArray(e);
    }
  }
}
