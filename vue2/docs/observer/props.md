## 导读

在日常开发中，`props` 也是一个常见的特性。我们常常用它来进行`父 -> 子`通信，今天我们就来梳理一下，`vue` 中 `props` 是如何工作的。

## 规范化

规范化发生在 `mergeOptions` 的时候，不论我们是创建根组件还是子组件，都会有 `mergeOptions` 的行为。其中创建根组件发生在 `_init` 时，创建子组件发生在创建子组件 `Sub` 构造函数时。

接下来我们分析下规范 `props` 的代码

```js
// src/core/util/options.js
function normalizeProps(options: Object, vm: ?Component) {
  const props = options.props;
  // 没有传递 props，直接返回
  if (!props) return;
  // 存放格式化后的 props
  const res = {};
  let i, val, name;
  // props 定义为一个数组
  if (Array.isArray(props)) {
    i = props.length;
    while (i--) {
      val = props[i];
      // 数组元素必须为 string
      if (typeof val === "string") {
        // 把 name 转换为驼峰格式
        name = camelize(val);
        // 把 props 的 type 置为空
        res[name] = { type: null };
      } else if (process.env.NODE_ENV !== "production") {
        warn("props must be strings when using array syntax.");
      }
    }
    // props 定义为一个普通对象
  } else if (isPlainObject(props)) {
    for (const key in props) {
      val = props[key];
      name = camelize(key);
      // 如果 val 是一个普通对象，直接赋值，如果是一个普通值，那么就是 type 类型
      res[name] = isPlainObject(val) ? val : { type: val };
    }
    // 接收的 props 定义必须为一个数组或者对象
  } else if (process.env.NODE_ENV !== "production") {
    warn(
      `Invalid value for option "props": expected an Array or an Object, ` +
        `but got ${toRawType(props)}.`,
      vm
    );
  }
  options.props = res;
}
```

这里做的事情就是处理了 `props` 的几种书写规范，最终转换到一个对象中，然后赋值给 `options.props`。

接下来就要对这些数据进行初始化，赋予一些能力。

## 初始化

初始化发生在 `initState` 中

```js
function initProps(vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {};
  const props = (vm._props = {});
  const keys = (vm.$options._propKeys = []);
  const isRoot = !vm.$parent;
  // 不是根实例，shouldObserve 置为 false
  if (!isRoot) {
    toggleObserving(false);
  }
  // 遍历 props 对象
  for (const key in propsOptions) {
    keys.push(key);
    // 校验
    const value = validateProp(key, propsOptions, propsData, vm);
    // 开发环境
    if (process.env.NODE_ENV !== "production") {
      const hyphenatedKey = hyphenate(key);
      if (
        isReservedAttribute(hyphenatedKey) ||
        config.isReservedAttr(hyphenatedKey)
      ) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        );
      }
      // 传入自定义 setter
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
              `overwritten whenever the parent component re-renders. ` +
              `Instead, use a data or computed property based on the prop's ` +
              `value. Prop being mutated: "${key}"`,
            vm
          );
        }
      });
    } else {
      defineReactive(props, key, value);
    }
    // 代理到 vm 上
    if (!(key in vm)) {
      proxy(vm, `_props`, key);
    }
  }
  toggleObserving(true);
}
```

`initProps` 中做了三件事情，校验、响应式、代理，我们分开来分析

### 校验

-------

在遍历每一个 `props` 属性时，会对其进行校验，调用 `validateProp` 方法，我们看一下这个方法

```js
// src/core/util/props.js
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
    // 对当前 prop 进行断言，主要判断类型是否合法
    assertProp(prop, key, value, vm, absent);
  }
  return value;
}
```

首先会对布尔类型的数据进行单独处理，先对 `prop` 的 `type` 进行判断，获取 `type` 的方法如下

```js
// src/core/util/props.js
// 通过对构造器类型进行 toString，会得到对应的 function，然后匹配名称
function getType (fn) {
  const match = fn && fn.toString().match(/^\s*function (\w+)/)
  return match ? match[1] : ''
}

// 判断是否相等
function isSameType (a, b) {
  return getType(a) === getType(b)
}

// prop 的 type 可以为一个类型的构造签名或者为一个数组，数组元素为类型的构造签名
function getTypeIndex (type, expectedTypes): number {
  // 不是数组
  if (!Array.isArray(expectedTypes)) {
    return isSameType(expectedTypes, type) ? 0 : -1
  }
  // 处理数组，找到就返回下标
  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    if (isSameType(expectedTypes[i], type)) {
      return i
    }
  }
  return -1
}
```

`vue` 是通过类型的构造器，每个类型都有一个包装器，包括 `Number`、 `Boolean`、 `Object` 等等，然后 `toString` 会得到它们的构造函数，然后匹配函数名称就能得到类型是否匹配成功。这也是为什么 `props` 的类型断言必须为首字母大写。

那么判断完类型，我们回到 `validateProp` 方法中，如果 `prop.type` 中匹配到了 `Boolean` 类型，那么就判断下父组件中是否传递了这个 `prop`，如果没有而且子组件没有给 `prop` 设置默认值，那么置为 `false`。另外，还处理了两种情况，当我们传递一个 `Boolean` 类型的 `prop` 时，会考虑下面两种情况

```vue
props: {
    tagName: [Boolean, String]
}
<tag tag-name></tag>
// 或者
<tag tag-name="tag-name"></tag>
```

如果 `value` 为空，上述例子中的第一个，或者 `prop key` 和 `value` 相等，例子中的第二个。那么尝试获取 `String` 类型的索引，如果没有定义 `String` 类型，或者 `Boolean` 比 `String` 定义的靠前，那么会优先考虑 `Boolean` 类型，然后把 `value` 置为 `true`。

接下来会针对默认值进行处理。如果 `value` 为 `undefined`，那么说明父组件没有传递这个 `prop`，就通过 `getPropDefaultValue` 去获取默认值。

```js
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
```

这里会对 `type` 为对象或者数组进行处理，`prop` 的默认值要定义为一个工厂函数。这里还做了一些优化，当重新渲染时，访问 `prop`，如果上次父组件都没有传递当前 `key`，那么直接去 `_props` 中取出默认值返回。

然后对 `props` 进行断言，判断 `prop` 类型是否合法，调用 `assertProp` 方法

```js
// src/core/util/props.js
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
  // 过滤掉空字符串
  const haveExpectedTypes = expectedTypes.some((t) => t);
  // 如果没有验证成功，并且定义了期望类型
  if (!valid && haveExpectedTypes) {
    warn(getInvalidTypeMessage(name, value, expectedTypes), vm);
    return;
  }
  // 用户自定义验证函数
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
```

首先针对 `required` 配置项进行处理，然后把定义的 `type` 放在一个数组中，然后进行验证，当有一个类型验证成功时，就可以结束验证。然后判断是否存在验证成功的类型，如果没有，则进行警告。最后调用用户自定义的验证函数进行验证。

接下来我们分析一下 `assertType` 如果进行验证类型的

```js
// src/core/util/props.js
const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol|BigInt)$/;

function assertType(
  value: any,
  type: Function,
  vm: ?Component
): {
  valid: boolean,
  expectedType: string,
} {
  // 是否验证成功
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
```

这段逻辑比较简单，先获取期望的类型，然后根据情况进行不同的判断，返回判断结果和期望的类型。

至此，校验的逻辑就结束了。校验整个逻辑可以分为三部分，先对布尔类型进行特殊处理，然后对默认值进行处理，最后对 `prop` 进行断言，判断是否合法以及类型是否匹配。

### 响应式

------------

校验完毕并获取到 `value` 后，通过 `defineReative` 把 `prop` 变为响应式。在开发环境下，还会对 `key` 进行判断是否为 `HTML` 的保留属性，如果是，则传入一个自定义 `setter` 进行警告。

## 代理

我们的 `props` 都是在 `vm._props` 上，通过代理。我们可以直接通过 `vm.xxx` 进行访问，和 `data` 一样的代理逻辑。对于子组件实例而言，这个行为发生在创建子组件 `Sub` 构造函数时。

## props更新

我们分析完 `props` 的创建过程，我们再来分析一下当父组件传递的 `props` 更新时，子组件会重新渲染，它是怎么工作的。我们从两个方面进行讨论，`props更新`和`子组件重新渲染`。

### 子组件props更新 

----------

当 `prop` 发生变化时，父组件是一定会重新渲染的，在这个过程中，会执行 `patch` 方法，然后会执行 `patchVnode` 方法，这是一个递归行为，当遇到组件 `vnode` 时，就会触发组件实例的 `prepatch` 钩子函数

```js
// src/core/vdom/patch.js
function patchVnode(...args) {
    // ...
  let i
  const data = vnode.data
  if (isDef(data) && isDef(i = data.hook) && isDef(i = i.prepatch)) {
    i(oldVnode, vnode)
  }
}
```

我们接下来看一下组件的这个钩子函数定义

```js
// src/core/vdom/create-component.js
const componentVNodeHooks = {
    prepatch (oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
      const options = vnode.componentOptions
      const child = vnode.componentInstance = oldVnode.componentInstance
      updateChildComponent(
        child,
        // 这个就是
        options.propsData, // updated props
        options.listeners, // updated listeners
        vnode, // new parent vnode
        options.children // new children
      )
    }
}
```

父组件会通过 `updateChildComponent` 来更新一些传递给子组件的数据。而 `propsData` 就是 `props` 数据。`propsData` 挂载的行为发生在我们创建组件 `Vnode` 实例时，会对 `props` 进行提取

```js
// src/core/vdom/create-component.js
export function createComponent (
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  // ...

  // extract props
  const propsData = extractPropsFromVNodeData(data, Ctor, tag)

  // ...
  
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ''}`,
    data, undefined, undefined, undefined, context,
    { Ctor, propsData, listeners, tag, children },
    asyncFactory
  )

  // ...
  
  return vnode
}
```

调用 `extractPropsFromVNodeData` 方法进行提取。这个方法就是获取父组件挂载在子组件上的 `attrs` 和子组件内定义的 `props`，然后进行配对取值。具体代码就不展开分析了。然后把 `propsData` 放在 `VNodeComponentOptions` 上。

我们接着分析 `updateChildComponent` 方法

```js
// src/core/instance/lifecycle.js
export function updateChildComponent (
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  // ...

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

  // ...
}
```

我们只分析 `props` 相关逻辑。如果父组件传递了 `propsData`，并且子组件定义了 `props`，那么就进行更新。先获取到所有 `prop key`，然后重新调用 `validateProp` 去验证、计算新的 `prop` 值，然后更新 `vm._props`。

因为在定义 `prop` 的响应式时，会把 `shouldObserve` 置为 `false`，所以不会为 `props` 创建 `observer` 实例，

### 子组件重新渲染

-------------

我们这里分析的是，`props` 导致子组件的重新渲染。只要我们在子组件中引用了 `prop`，那么在 `validateProp` 就会触发 `getter`，那么子组件就会被收集依赖，当 `prop` 更新时，会触发子组件的 `update`。

## toggleObserving

我们在分析 `props` 流程中，频繁看到了这个方法。它的作用是修改标志位 `shouldObserve`，定义在 `src/core/observer/index.js` 中。这个值控制了，在响应式化过程中，是否把 `value` 变为一个 `observer` 对象。 而把 `value` 变为 `observer` 对象，是为了递归处理对象或数组数据。在把 `props` 响应式化时，是不需要的。我们来分析一下为什么。

由于子组件的 `prop` 值是依赖父组件传递的数据，只要父组件的 `prop` 值发生变化，那么就能触发渲染，所以子组件的 `observer` 处理是没必要的，因为父组件已经处理过，它也是能够通知组件去更新的。

还有一种情况时，我们在 `validateProp` 中处理默认值，如果父组件没有传递 `prop` 值，那么要对 `value` 进行响应式化，因为这是子组件内的数据。

```js
// src/core/util/props.js
function validateProp (...args) {
	// ...
    // check default value
    if (value === undefined) {
      value = getPropDefaultValue(vm, prop, key)
      // since the default value is a fresh copy,
      // make sure to observe it.
      const prevShouldObserve = shouldObserve
      toggleObserving(true)
      observe(value)
      toggleObserving(prevShouldObserve)
    }
}
```

