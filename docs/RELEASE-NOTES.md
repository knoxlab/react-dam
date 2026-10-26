# Release Notes

## 1.0.0 (2026-10-26)

首个正式版本：可导入 PowerCMS 12 的 React 数字资源库（DAM）站点包，`packageId: com.powercms.samples.react-dam`，站点 Key `react-dam`，要求 PowerCMS `>=12.0.0`。

### 站点包与部署

- 站点包清单 `site-package.yaml`（REACT 运行时，Node 20），打包时注入 SHA-256 `checksums`，经 `scripts/validate-samples.ps1` 生成可导入 ZIP。
- 站点导入即部署：模板工程构建产物自动部署到 `webapps/{siteKey}/`，浏览器直接访问 `http://localhost:8080/webapps/react-dam/`。
- 包内 `template/dist/**` 走导入快路径；无产物时按 `entrypoints.build` 在导入侧现场构建（`powercms.webapps.build=auto|never|always`）。
- API 路径自动匹配：服务端向 `index.html` 注入 `__POWERCMS_SITE_ID__` / `__POWERCMS_SITE_KEY__` / `__POWERCMS_API_BASE__`，应用无需手工携带 `siteId`；`/webapps/{siteKey}/api/...` 相对调用由服务端透明改写到 `/api/...`。Vite `base: './'`，产物可部署在任意子路径，客户端路由自动回退 `index.html`。

### 内容模型

- `digital_asset`：统一资源目录，按 `asset_kind_s` 区分图片 / 视频 / 音频 / 文档 / 其他，含摘要、标签（人工 `tags_ss` 与 AI `ai_tags_ss` 分离）、版权与许可、部门、资源组、审批状态、下载有效期。
- `asset_version`：业务版本记录，供前台回溯。
- `share_link`：分发链接的受众、失效时间与吊销状态（不保存完整令牌）。
- `resource_group`：栏目名称快照；授权边界是站点栏目，不由本模型判定。
- 导入后平台自动补齐 `media_image` / `media_video` / `media_audio` / `media_document` / `media_font` / `media_other` 媒体模型存原件，`digital_asset.storage_uri_s` 只存媒体引用，前台拿短时凭证打开原件。

### 前台功能

- **资源库**（`#library`）：侧栏按当前访问者可见栏目列出，支持关键字、类型、部门、栏目、许可和排序检索；交付接口单次上限 50 条。
- **资源详情**（`#detail/<内容编号>`，可跨浏览器直达）：预览条显示分辨率、播放/浏览次数与发布日期；视频内嵌 Knox-Media 播放代理页（PowerPlayer / HLS），图片、音频、文档走短时 `play-token` 地址，PDF 用 pdf.js 整份渲染，图片支持点击查看大图。
- **互动**：点赞、收藏、评论（含楼中楼回复与回复点赞，自动 `// @用户` 引用行）、下载、分享；计数统一走 `GET .../contents/{id}/actions`，评论经站点工作流审核后公开。
- **上传中心**（`#upload`）：仅对拥有「添加子项」栏目的会员组开放；队列上传带进度、可中止/删除，多视频页签化编目表单，提交后自动送审（状态 `IN_REVIEW` / 审批 `pending`）。
- **会员中心**：登录、注册、个人中心、修改密码；我的上传（可删除与签发分享）、我的分享（吊销与访问日志）、我的收藏、浏览历史。
- **消息中心**：消息私信、评论和@、点赞、粉丝四个页签，悬停通知图标可预览未读计数。
- **知识问答**（`#ask`）：问答入口页。
- **统计采集**：站点应用注入 `analytics.js`，按资源上报 PAGEVIEW / CONTENT_VIEW / DOWNLOAD，下载计入站点统计。

### 权限与安全

- 匿名浏览需站点打破继承并明确授予匿名角色「查看」；前台以 `GET .../viewer` 判断能否匿名进入、`.../folders` 判断栏目可见、`contents/query?forViewer=true` 只取可见资源；打破继承的栏目或内容按自身授权判定。
- 分享链接明文仅返回一次，下载走 `GET .../shares/{token}`；吊销、过期、超次或资源下架后不再返回文件。
- 下载按 `download_ttl_s` 短时凭证取原件，失败时给出准确拒绝原因。

### 管理端配套

- 审批工作流模板 `workflows/asset-approval.yaml`：草稿 → 待审批 → 通过 / 驳回。
- 检索字段定义 `search/asset-index.yaml`，供超出交付接口 50 条上限时使用。
- 内容模型图片字段上传至 Knox-Media，管理端 AI 打标建议可一键转正式标签；管理端「导出」可再次打成符合规范的站点包 ZIP 用于建站。

### 依赖与环境

- PowerCMS `>=12.0.0`；模板构建 Node 20；开发调试时后端运行在 `http://localhost:8080`，Vite 开发服务器将其 `/api` 与 `/media-*` 路径转发代理。
