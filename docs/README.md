# 数字资源库

PowerCMS 12 站点包。导入后得到一个站点、四套内容模型和一套 React 前台，用来统一管理图片、音视频、文档、PDF 和文本片段。

## 导入

在仓库根目录执行：

```powershell
pwsh scripts/validate-samples.ps1
```

用管理端「系统 → 站点包」导入 `target/sample-packages/react-dam.zip`。源码目录没有 `checksums`，不能直接把文件夹打成 ZIP 导入。

导入会创建：

| 内容模型 | 作用 |
|---|---|
| `digital_asset` | 统一资源目录：类型、摘要、标签、版权、部门、资源组、审批状态、下载有效期 |
| `asset_version` | 业务版本记录，供前台回溯 |
| `share_link` | 分发链接的受众、失效时间和吊销状态（不保存完整令牌） |
| `resource_group` | 栏目名称快照。授权边界是站点栏目，不由本模型判定 |

站点创建后，平台还会自动补上 `media_image`、`media_video`、`media_audio`、`media_document`、`media_font`、`media_other`。原件放在这些媒体模型里。`digital_asset.storage_uri_s` 是媒体引用，指向 `media_*` 内容或对象存储键；前台只拿短时播放凭证打开原件，不把无鉴权地址写进页面。

`content/`、`workflows/`、`search/` 会留在包里，导入预检会提示它们不会自动落库。示例数据由前台在没有已发布内容时展示；正式使用时在管理端录入并发布同名字段的内容。

## 前台

界面按 `dam-prototype` 实现：资源库、资源详情、上传中心、知识问答。站点有效授权明确授予匿名角色「查看」时，未登录可以进入资源库浏览；否则仍需登录。栏目或内容打破继承后按该对象自己的授权判断，没有查看权的栏目和资源不显示。点击资源库后，侧栏列出当前访问者具备查看权限的栏目。访问日志从「会员 → 我的分享」进入。栏目授权和标签治理在管理端维护。分享由管理端内容列表「更多 → 签发分享」签发；会员在「我的上传」对自己已发布的资源签发，并在「我的分享」查看。侧栏可用地址栏 hash 直达，例如 `#library`、`#ask`。顶部通知图标在鼠标悬停时展开消息私信、评论和@、粉丝、点赞；有未读时在文字后显示红色数字。点击图标或菜单项进入消息中心（`#inbox/message`、`#inbox/comment`、`#inbox/fan`、`#inbox/like`）。登录后消息、评论和点赞从会员消息接口读取：系统通知、别人回复我的评论、赞过我的评论，以及赞过我发表内容的会员。粉丝是关注该会员的其他会员，此功能暂未开放。评论页可以回复和点赞，消息页左侧是发信人摘要、右侧是该人发出的全部消息。资源详情地址是 `#detail/<内容编号>`，可在其他浏览器打开同一条资源。预览条左侧显示分辨率、播放次数和发布日期，不再显示存储地址；右侧有点赞、收藏、评论、下载、分享、AI识别和更多。分享菜单可复制链接，或分享到微信、微博。模型里的图片字段会把本地图片上传到 Knox-Media，前台预览再按 Knox 播放地址加载这张图。

```powershell
cd samples/react-dam/template
npm install
npm run dev
```

未带 `siteId` 时展示包内示例。开发服务器会把 `/api` 转到 `http://localhost:8080`。发布内容后用 `http://localhost:5173/?siteId=<站点 UUID>` 打开，页面会请求：

`GET /api/v1/delivery/sites/{siteId}/contents/query?contentType=digital_asset&limit=50&orderBy=updatedAt&status=PUBLISHED`

交付接口单次最多返回 50 条。超过这个规模时用管理端检索，字段见 `search/asset-index.yaml`。

## 能力对应

- **全类型存储**：目录模型用 `asset_kind_s` 区分图片、视频、音频、文档、PDF、文本片段；二进制走预置媒体模型。
- **元数据与版本**：版权、标签、部门写在 `digital_asset`；业务版本写在 `asset_version`。条目级历史仍用管理端的内容版本恢复。
- **分类与检索**：人工标签 `tags_ss` 与 AI 标签 `ai_tags_ss` 分开。AI 标签由管理端 `POST /api/v1/ai/suggest/tags?siteId=` 生成后写入。前台支持关键字、类型、部门、栏目、许可和排序。
- **分发与复用**：管理端在内容列表右侧「更多 → 签发分享」对已发布的 `digital_asset` 签发。会员只能分享自己创建且已发布的资源，列表在「我的分享」。明文链接只返回一次，下载地址是 `GET /api/v1/delivery/sites/{siteId}/shares/{token}`。吊销、过期、超次或资源不再发布后，链接不再返回文件。
- **权限与安全**：资源组对应站点栏目（文件夹）。在管理端「目录浏览 → 编辑文件夹 → 权限」中把会员组加进去，并授予查看、编辑、发布、管理、添加子项、下载。资源挂在该栏目下且未打破继承时沿用栏目授权。站点打破继承并授予匿名角色「查看」后，未登录可浏览资源库；未打破继承的栏目沿用该授权，打破继承的栏目或内容只看自己的授权。前台用 `GET /api/v1/delivery/sites/{siteId}/viewer` 判断能否匿名进入，用 `GET .../folders` 判断栏目是否可见，并用 `contents/query?forViewer=true` 只取当前访问者可见的资源。上传仍要求会员组「添加子项」，不单独展示授权页。
- **会员空间**：登录后个人中心读取 `GET /api/v1/me` 的显示名和会员组。修改密码提交 `POST /api/v1/delivery/sites/{siteId}/me/password`。我的上传是该会员创建的 `digital_asset`（`GET .../me/uploads`）。收藏和浏览历史存在服务端（`.../me/favorites`、`.../me/history`），打开资源详情会记下一次浏览。上传中心只开放给会员组拥有「添加子项」的栏目。栏目打破继承后按栏目自己的授权判断；未打破时沿用站点上的会员组权利。没有可上传栏目时，侧栏「上传中心」和资源库「上传资源」不显示。队列中的文件会上传到所选栏目并显示进度。失败时展示服务端返回的异常；进行中的任务可以中止，任意任务可以删除。完成后点击「下一步」，再按已发布 `digital_asset` 的表单布局填写数字资源；多个视频以页签切换。布局来自 `GET /api/v1/delivery/sites/{siteId}/content-forms/digital_asset`。
- **审批**：状态字段与 `workflows/asset-approval.yaml` 一致（草稿 → 待审批 → 通过 / 驳回）。在管理端按该文件配置工作流。

导出当前站点时，管理端「导出」会再次打成符合站点包规范的 ZIP，可用来创建新站点。
