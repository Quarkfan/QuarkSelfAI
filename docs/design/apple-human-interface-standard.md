# QuarkSelfAI 界面设计标准

本标准适用于 QuarkSelfAI 及助手自主创建的 Web、桌面和交互控制面。它以 Apple Human Interface Guidelines
为质量基线，但不复制 Apple 的商标、专有资产或产品外观；QuarkSelfAI 的荧光黄绿强调色、工业控制室语义和
信息密度仍是自己的产品表达。

官方参考（2026-08-29 核验）：

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)

## 必须遵守的原则

1. **目的优先**：每个页面只突出当前最重要的用户目标。装饰、统计或技术字段不能争夺主任务注意力。
2. **用户掌控**：操作要有即时状态反馈；高影响动作先确认，可恢复动作提供取消、返回或重试路径。
3. **清晰层级**：内容、导航、操作和临时浮层属于不同层。字号、字重、间距和材质共同表达层级，不能只靠颜色。
4. **平台和谐**：优先使用系统字体、标准 HTML 语义、键盘行为和原生控件习惯；页面必须适应窗口缩放与窄屏。
5. **一致但不僵化**：相同语义使用相同组件、位置和反馈。视觉表现可以随页面目的变化，但 token 和行为契约不能旁路。
6. **克制材质**：模糊、透明和高光只用于导航、工具栏、浮层等功能层，内容层保持安静、清晰和可读。
7. **语义用色**：强调色只突出关键动作或状态；同一种颜色不能表达多个冲突含义；任何状态都必须同时有文字、图形或结构线索。
8. **可读字体**：正文使用系统字体栈，避免小字号轻字重；通过字号、字重和颜色建立少而稳定的层级，不混用无目的字体。
9. **有意义的动效**：动效只解释关系、状态或反馈，短而连贯；必须响应 `prefers-reduced-motion`，不得用循环动画制造无意义注意力。
10. **默认可访问**：键盘可达、焦点清晰、名称可读、对比度可审计；交互热区默认至少 44×44 CSS px，紧凑桌面控件只有在周围空间和输入精度足够时才可例外。
11. **责任与透明**：权限、数据用途、错误和后果用人能理解的语言呈现；不能用界面诱导绕过确认、隐私或安全门禁。
12. **精工与迭代**：空态、加载、失败、禁用、悬停、按下、焦点和窄屏均属于完成范围；真实视觉复核和自动检查都是交付门禁。

## 设计系统契约

- `web/design-tokens.css` 是颜色、字体、间距、圆角、材质和动效的语义真源。页面 CSS 消费语义 token，不创建另一套全局主题。
- `web/interface-baseline.css` 是所有控制台页面最后加载的行为基线，统一热区、焦点、材质、减少动效、高对比和窄屏适配。
- 页面可以定义独特构图和局部视觉语言，但不能覆盖焦点可见性、减少动效、语义状态和确认边界。
- Apple 的 HIG 会演进。能力进化巡检发现官方原则发生实质变化时，先更新本标准和回归测试，再调整实现；不得按截图机械追逐外观版本。

## 合并前检查

- 页面最主要的目标能否在五秒内识别，主要操作是否只有一个明确最高层级？
- 导航、内容、操作和浮层是否层次清楚，材质是否具有功能意义？
- 键盘能否遍历所有操作，焦点是否始终可见，图标按钮是否有可读名称？
- 状态是否不依赖颜色，正文和图标是否达到合理对比，文本放大后是否仍可使用？
- 交互热区、悬停、按下、加载、空态、失败和恢复路径是否完整？
- `prefers-reduced-motion`、高对比/强制颜色和窄窗口是否经过验证？
- 是否复用了 token 和现有组件，而不是新增相近但不一致的颜色、圆角、间距或控件？
- 是否保留 QuarkSelfAI 自身品牌，而不是复制 Apple 产品界面或受限制资产？

新界面只有在上述问题有可核验证据并通过 `npm run check` 后，才能标记为完成。
