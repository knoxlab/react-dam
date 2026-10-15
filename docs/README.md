# 数字资源库

PowerCMS 12 站点包。导入后得到一个站点、四套内容模型和一套 React 前台，用来统一管理图片、音视频、文档和其他资源。

## 站点导入即部署（webapps）

站点包导入时，模板工程（REACT/VUE）的构建产物会自动部署到**当前运行目录**下的 `webapps/{siteKey}/`，浏览器可直接访问，例如 `http://localhost:8080/webapps/react-dam/`：

- 产物来源两级：包内 `template/dist/**`（打包前 `npm run build` 的成品）优先进入快路径；包内无产物时按清单 `entrypoints.build` 在导入侧现场构建（`powercms.webapps.build=auto|never|always`，默认 `auto`）。
- `index.html` 响应由服务端注入启动配置：`window.__POWERCMS_SITE_ID__`（站点 UUID）、`window.__POWERCMS_SITE_KEY__`、`window.__POWERCMS_API_BASE__`（`/api/v1`）——**API 路径自动匹配**：应用无需手工携带 `?siteId=` 或硬编码 API 根，站点 API（`/api/v1/delivery/sites/{siteId}/...`）自动指向本站点。
- 以应用基路径相对寻址的调用（`/webapps/{siteKey}/api/...`）由服务端透明改写到 `/api/...`，鉴权语义与直接调用一致。
- Vite 构建配置 `base: './'`，产物可部署在任意子路径下；客户端路由（无扩展名路径）自动回退 `index.html`。

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

界面按 `dam-prototype` 实现，包含资源库、资源详情、上传中心、知识问答和会员中心。站点有效授权明确授予匿名角色「查看」时，未登录可以进入资源库浏览；否则仍需登录。栏目或内容打破继承后按该对象自己的授权判断，没有查看权的栏目和资源不显示。点击资源库后，侧栏列出当前访问者具备查看权限的栏目。栏目授权和标签治理在管理端维护。模型里的图片字段会把本地图片上传到 Knox-Media，前台预览再按 Knox 播放地址加载这张图。

### 页面与地址

侧栏页面可用地址栏 hash 直达：

| 地址 | 页面 |
|---|---|
| `#library` | 资源库，侧栏为当前访问者可见的栏目 |
| `#upload` | 上传中心 |
| `#detail/<内容编号>` | 资源详情，可在其他浏览器打开同一条资源 |
| `#ask` | 知识问答 |
| `#account`、`#password` | 个人中心、修改密码 |
| `#uploads`、`#shares`、`#favorites`、`#history` | 我的上传、我的分享、我的收藏、浏览历史 |
| `#inbox/message`、`#inbox/comment`、`#inbox/fan`、`#inbox/like` | 消息中心四个页签 |
| `#login`、`#register` | 登录、注册，注册后的自动登录由后台的注册设置决定 |

顶部通知图标在鼠标悬停时展开消息私信、评论和@、粉丝、点赞，有未读时在文字后显示红色数字；点击图标或菜单项进入消息中心。

### 资源详情与互动

- 预览条：左侧显示分辨率、播放（或浏览）次数和发布日期，不显示存储地址。视频窗口内嵌 Knox-Media 播放代理页（`GET /media-play/{siteId}/{assetId}`），播放器（PowerPlayer）和可播地址都由 Knox-Media 侧提供，与后端媒体库预览同款，HLS 由 PowerPlayer 解码；图片、音频、文档仍走短时播放地址（`POST .../media/{assetId}/play-token` 返回的 `playUrl`）。开发服务器把 `/media-play`、`/media-stream` 等媒体路径一并转到 `http://localhost:8080`。
- 互动栏：点赞、收藏、评论、下载、分享、AI识别、更多（查看评论）。点赞数、收藏数、评论数以及当前访问者是否已赞、已藏来自 `GET /api/v1/delivery/sites/{siteId}/contents/{contentId}/actions`；内容点赞用同路径 `POST /like` 切换。评论数包含该内容的全部评论与回复。
- 评论区（详情页页签：版本历史、元数据、评论）：每条显示头像、昵称、时间、正文、点赞数和回复入口，评论和回复经站点工作流审核后公开。回复第一楼直接挂在主楼下；回复一条回复（楼中楼）时正文自动带上 `// @回复用户: 评论内容` 引用行，并平铺回主楼展示，第一楼有多条回复时先显示一条，其余通过「查看全部 N 条回复」展开。
- 下载：按 `download_ttl_s` 的短时凭证取原件，下载计入站点统计。
- 分享菜单：复制链接、微信、微博。
- 元数据页签包含基本信息、版权（许可与到期）、标签（管理端 AI 打标建议可一键转正式）和人物。

### 会员中心

- 登录、注册、个人中心（显示名与会员组）、修改密码（`POST .../me/password`）。
- 我的上传：自己创建的 `digital_asset` 列表（`GET .../me/uploads`），可对已发布的资源签发分享，也可以删除（`DELETE .../me/uploads/{contentId}`，仅创建者本人可删，级联清理版本、内容关系、分享链接、收藏等标记和检索文档）。
- 我的分享：自己签发链接的查看与吊销，「访问日志」从这里进入（地址 `#logs` 会落到本页）。
- 我的收藏：服务端收藏列表（`GET .../me/favorites`），每行可取消收藏（`DELETE .../me/favorites/{contentId}`）。
- 浏览历史：打开资源详情会记一次浏览（`POST .../me/history/{contentId}`）。
- 上传中心只开放给会员组拥有「添加子项」的栏目；没有可上传栏目时，侧栏「上传中心」和资源库「上传资源」不显示。队列中的文件会上传到所选栏目并显示进度，失败时展示服务端返回的异常，进行中的任务可以中止、任意任务可以删除。完成后点「下一步」进入表单页（离开队列页），按已发布 `digital_asset` 的表单填写数字资源；可「取消」返回队列，或「提交」调用 `POST .../me/uploads/contents` 登记资源并自动提交审核——服务端随即走「提交审核」链路生成审核待办（内容状态 `IN_REVIEW`、审批状态固定 `pending`，可在管理端待审批列表受理，进度在「我的上传」查看）。多个视频以页签切换，布局来自 `GET .../content-forms/digital_asset`。

### 消息中心

数据来自 `GET .../me/inbox`，四个页签：

- **消息私信**：系统通知按类型归组（审核提交、审核通过、审核驳回等），左侧发信人摘要、右侧该类的全部消息；已读后调 `POST .../me/inbox/read`。
- **评论和@**：别人回复我的评论，包括回复我发出的回复（楼中楼），列表里可以直接回复（`POST .../me/inbox/comments/{messageId}/replies`）和点赞。
- **点赞**：别人赞我的评论（含访客点赞）与别人赞我发表的内容。
- **粉丝**：关注该会员的其他会员，此功能暂未开放。

### 匿名与权限

未登录只能浏览站点授权明确授予匿名角色「查看」的栏目和资源；`GET .../viewer` 判断能否匿名进入，`GET .../folders` 判断栏目是否可见，`contents/query?forViewer=true` 只取当前访问者可见的资源。上传仍要求会员组「添加子项」，不单独展示授权页。

```powershell
cd samples/react-dam/template
npm install
npm run dev
```

未带 `siteId` 时展示包内示例。开发服务器会把 `/api` 和 `/media-play`、`/media-stream`、`/media-preview`、`/media-thumb`、`/media-file` 转到 `http://localhost:8080`。发布内容后用 `http://localhost:5173/?siteId=<站点 UUID>` 打开，页面会请求：

`GET /api/v1/delivery/sites/{siteId}/contents/query?contentType=digital_asset&limit=50&orderBy=updatedAt&status=PUBLISHED`

交付接口单次最多返回 50 条。超过这个规模时用管理端检索，字段见 `search/asset-index.yaml`。

## 能力对应

- **全类型存储**：目录模型用 `asset_kind_s` 区分图片、视频、音频、文档和其他；二进制走预置媒体模型。PDF 归入文档（前台用 pdf.js 渲染整份 PDF）。
- **元数据与版本**：版权、标签、部门写在 `digital_asset`；业务版本写在 `asset_version`。条目级历史仍用管理端的内容版本恢复。
- **分类与检索**：人工标签 `tags_ss` 与 AI 标签 `ai_tags_ss` 分开。AI 标签由管理端 `POST /api/v1/ai/suggest/tags?siteId=` 生成后写入。前台支持关键字、类型、部门、栏目、许可和排序。
- **分发与复用**：管理端在内容列表右侧「更多 → 签发分享」对已发布的 `digital_asset` 签发。会员只能分享自己创建且已发布的资源，列表在「我的分享」。明文链接只返回一次，下载地址是 `GET /api/v1/delivery/sites/{siteId}/shares/{token}`。吊销、过期、超次或资源不再发布后，链接不再返回文件。
- **权限与安全**：资源组对应站点栏目（文件夹）。在管理端「目录浏览 → 编辑文件夹 → 权限」中把会员组加进去，并授予查看、编辑、发布、管理、添加子项、下载。资源挂在该栏目下且未打破继承时沿用栏目授权。站点打破继承并授予匿名角色「查看」后，未登录可浏览资源库；未打破继承的栏目沿用该授权，打破继承的栏目或内容只看自己的授权。前台用 `GET /api/v1/delivery/sites/{siteId}/viewer` 判断能否匿名进入，用 `GET .../folders` 判断栏目是否可见，并用 `contents/query?forViewer=true` 只取当前访问者可见的资源。上传仍要求会员组「添加子项」，不单独展示授权页。
- **互动与计数**：对内容的点赞、收藏、评论（含对评论的回复、对评论的点赞）以及播放次数在详情页互动栏集中展示，计数走 `GET .../contents/{id}/actions`。浏览计数在打开详情时上报 `POST .../me/history/{contentId}`，下载进入站点统计。评论、回复、点赞走公开互动接口（`/api/v1/public/sites/{siteId}/interaction/...`），经站点工作流审核后公开；评论列表 `total` 包含主楼与全部回复，楼中楼按 `parentId` 平铺到主楼下。
- **会员空间**：登录后个人中心读取 `GET /api/v1/me` 的显示名和会员组。修改密码提交 `POST /api/v1/delivery/sites/{siteId}/me/password`。我的上传是该会员创建的 `digital_asset`（`GET .../me/uploads`），可以删除。收藏和浏览历史存在服务端（`.../me/favorites`、`.../me/history`），收藏可随时取消，打开资源详情会记下一次浏览。
- **审批**：状态字段与 `workflows/asset-approval.yaml` 一致（草稿 → 待审批 → 通过 / 驳回）。在管理端按该文件配置工作流。

导出当前站点时，管理端「导出」会再次打成符合站点包规范的 ZIP，可用来创建新站点。
