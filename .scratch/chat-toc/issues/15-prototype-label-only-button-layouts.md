# 用只收 label 的 Button 画三种 Layout

Type: prototype
Status: open
Blocked by: 

## Question

2.1.287 的 `Button` 只收 `label`（或单个字符串子节点），原型用多个 `Text` 子节点画的卡片条目在最低版本上会报错（见「实测长会话的读取与渲染开销」）。在 2.1.287 和当前版本上都能画、点得到、悬停反色的前提下，卡片 / 紧凑 / 时间轴三种 Layout 的条目怎么画：暗色的「你 · 时间」「↳ N 步」头行与正文能否分开着色（每行一个 Button、共用一个跳转，还是整条一个多行 label）；青色高亮竖条、时间轴的时间列和 `│` 放在 Button 外的 `Text` 里是否对齐；选择光标（宿主反色）与高亮还能否一眼分清；↑↓ 的 focus 落在哪个 Button 上。两个版本并排给使用者看，定下每种 Layout 的画法。
