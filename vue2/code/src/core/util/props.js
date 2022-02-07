/* @flow */

import { warn } from "./debug";
import { observe, toggleObserving, shouldObserve } from "../observer/index";
import {
  hasOwn,
  isObject,
  toRawType,
  hyphenate,
  capitalize,
  isPlainObject,
} from "shared/util";

type PropOptions = {
  type: Function | Array<Function> | null,
  default: any,
  required: ?boolean,
  validator: ?Function,
};

export function validateProp(
  key: string,
  propOptions: Object,
  propsData: Object,
  vm?: Component
): any {
  // 取出当前的 prop 值
  const prop = propOptions[key];
  // 父组件是否传递值
  const absent = !hasOwn(propsData, key);
  // 父组件传递的值
  let value = propsData[key];
  // type 中是否能匹配到 Boolean
  const booleanIndex = getTypeIndex(Boolean, prop.type);
  // 如果下标不为 -1，说明匹配到了 Boolean 类型
  if (booleanIndex > -1) {
    // 如果父组件没有传递这个 props，并且子组件没有设置 default，则置为 false
    if (absent && !hasOwn(prop, "default")) {
      value = false;
      // 如果 value 为空，或者 key 和 value 同值
    } else if (value === "" || value === hyphenate(key)) {
      // 拿到 String 类型的索引
      const stringIndex = getTypeIndex(String, prop.type);
      // 如果没有 String type 或者 Boolean 类型定义比 String 的靠前，则赋值为 true
      if (stringIndex < 0 || booleanIndex < stringIndex) {
        value = true;
      }
    }
  }
  // 如果父组件没有传递值
  if (value === undefined) {
    // 获取默认值
    value = getPropDefaultValue(vm, prop, key);
    const prevShouldObserve = shouldObserve;
    toggleObserving(true);
    observe(value);
    toggleObserving(prevShouldObserve);
  }
  if (
    process.env.NODE_ENV !== "production" &&
    !(__WEEX__ && isObject(value) && "@binding" in value)
  ) {
    // 对当前 prop 进行断言，判断类型是否合法
    assertProp(prop, key, value, vm, absent);
  }
  return value;
}

/**
 * Get the default value of a prop.
 */
function getPropDefaultValue(
  vm: ?Component,
  prop: PropOptions,
  key: string
): any {
  // 如果 prop 中没有 default 属性。那么直接返回 undefined
  if (!hasOwn(prop, "default")) {
    return undefined;
  }
  // 默认值
  const def = prop.default;
  // 如果 prop 的默认值为对象或者数组，那么它们的默认值必须要返回一个工厂函数
  if (process.env.NODE_ENV !== "production" && isObject(def)) {
    warn(
      'Invalid default value for prop "' +
        key +
        '": ' +
        "Props with type Object/Array must use a factory function " +
        "to return the default value.",
      vm
    );
  }
  // 如果上一次渲染父组件传递的 key 的值为 undefined 并且 _props 中存在这个 key，那么直接返回，这个值就是默认值
  if (
    vm &&
    vm.$options.propsData &&
    vm.$options.propsData[key] === undefined &&
    vm._props[key] !== undefined
  ) {
    return vm._props[key];
  }

  // 如果 def 为 function 并且 type 不是 Function，那么就调用函数返回函数的返回值
  return typeof def === "function" && getType(prop.type) !== "Function"
    ? def.call(vm)
    : def;
}

/**
 * Assert whether a prop is valid.
 */
function assertProp(
  prop: PropOptions,
  name: string,
  value: any,
  vm: ?Component,
  absent: boolean
) {
  // 如果定义了 required 但是父组件没有传值
  if (prop.required && absent) {
    warn('Missing required prop: "' + name + '"', vm);
    return;
  }
  // 如果值为空而且也没有定义 required，直接返回
  if (value == null && !prop.required) {
    return;
  }
  let type = prop.type;
  // 没有定义 type 或者 type 为 true
  let valid = !type || type === true;
  const expectedTypes = [];
  // 拿到 type 并转换为数组
  if (type) {
    if (!Array.isArray(type)) {
      type = [type];
    }
    // 如果 valid 为 true，则结束断言
    for (let i = 0; i < type.length && !valid; i++) {
      // 进行断言
      const assertedType = assertType(value, type[i], vm);
      // 收集期望类型
      expectedTypes.push(assertedType.expectedType || "");
      // 标志位，是否验证成功
      valid = assertedType.valid;
    }
  }

  // 验证的结果
  const haveExpectedTypes = expectedTypes.some((t) => t);
  // 如果没有验证成功，并且定义了期望类型
  if (!valid && haveExpectedTypes) {
    warn(getInvalidTypeMessage(name, value, expectedTypes), vm);
    return;
  }
  // 用户自定义的验证函数
  const validator = prop.validator;
  if (validator) {
    if (!validator(value)) {
      warn(
        'Invalid prop: custom validator check failed for prop "' + name + '".',
        vm
      );
    }
  }
}

const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol|BigInt)$/;

function assertType(
  value: any,
  type: Function,
  vm: ?Component
): {
  valid: boolean,
  expectedType: string,
} {
  let valid;
  // 期望的类型
  const expectedType = getType(type);
  // 是否合法
  if (simpleCheckRE.test(expectedType)) {
    // 是否相等
    const t = typeof value;
    valid = t === expectedType.toLowerCase();
    //如果没有匹配成功，那么判断是否为一个对象，然后通过 instanceof 判断是否为父子关系
    if (!valid && t === "object") {
      valid = value instanceof type;
    }
    // 是否为普通对象
  } else if (expectedType === "Object") {
    valid = isPlainObject(value);
    // 是否为数组
  } else if (expectedType === "Array") {
    valid = Array.isArray(value);
  } else {
    try {
      // 其他情况尝试使用 instanceof
      valid = value instanceof type;
    } catch (e) {
      warn(
        'Invalid prop type: "' + String(type) + '" is not a constructor',
        vm
      );
      valid = false;
    }
  }
  return {
    valid,
    expectedType,
  };
}

const functionTypeCheckRE = /^\s*function (\w+)/;

/**
 * Use function string name to check built-in types,
 * because a simple equality check will fail when running
 * across different vms / iframes.
 */
// 通过对构造器类型进行 toString，会得到对应的 function，然后匹配名称
function getType(fn) {
  const match = fn && fn.toString().match(functionTypeCheckRE);
  return match ? match[1] : "";
}
// 判断是否相等
function isSameType(a, b) {
  return getType(a) === getType(b);
}
// prop 的 type 可以为一个类型的构造签名或者为一个数组，数组元素为类型的构造签名
function getTypeIndex(type, expectedTypes): number {
  // 不是数组
  if (!Array.isArray(expectedTypes)) {
    return isSameType(expectedTypes, type) ? 0 : -1;
  }
  // 处理数组，找到就返回下标
  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    if (isSameType(expectedTypes[i], type)) {
      return i;
    }
  }
  return -1;
}

function getInvalidTypeMessage(name, value, expectedTypes) {
  let message =
    `Invalid prop: type check failed for prop "${name}".` +
    ` Expected ${expectedTypes.map(capitalize).join(", ")}`;
  const expectedType = expectedTypes[0];
  const receivedType = toRawType(value);
  // check if we need to specify expected value
  if (
    expectedTypes.length === 1 &&
    isExplicable(expectedType) &&
    isExplicable(typeof value) &&
    !isBoolean(expectedType, receivedType)
  ) {
    message += ` with value ${styleValue(value, expectedType)}`;
  }
  message += `, got ${receivedType} `;
  // check if we need to specify received value
  if (isExplicable(receivedType)) {
    message += `with value ${styleValue(value, receivedType)}.`;
  }
  return message;
}

function styleValue(value, type) {
  if (type === "String") {
    return `"${value}"`;
  } else if (type === "Number") {
    return `${Number(value)}`;
  } else {
    return `${value}`;
  }
}

const EXPLICABLE_TYPES = ["string", "number", "boolean"];
function isExplicable(value) {
  return EXPLICABLE_TYPES.some((elem) => value.toLowerCase() === elem);
}

function isBoolean(...args) {
  return args.some((elem) => elem.toLowerCase() === "boolean");
}
