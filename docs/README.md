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
| `resource_group` | 部门级资源组、授权角色、加密备份策略 |

站点创建后，平台还会自动补上 `media_image`、`media_video`、`media_audio`、`media_document`、`media_font`、`media_other`。原件放在这些媒体模型里，`digital_asset.storage_uri_s` 只保存引用。

`content/`、`workflows/`、`search/` 会留在包里，导入预检会提示它们不会自动落库。示例数据由前台在没有已发布内容时展示；正式使用时在管理端录入并发布同名字段的内容。

## 前台

```powershell
cd samples/react-dam/template
npm install
npm run dev
```

未带 `siteId` 时展示包内示例。发布内容后用 `http://localhost:5173/?siteId=<站点 UUID>` 打开，页面会请求：

`GET /api/v1/delivery/sites/{siteId}/contents/query?contentType=digital_asset&limit=50&orderBy=updatedAt&status=PUBLISHED`

交付接口单次最多返回 50 条。超过这个规模时用管理端检索，字段见 `search/asset-index.yaml`。

## 能力对应

- **全类型存储**：目录模型用 `asset_kind_s` 区分图片、视频、音频、文档、PDF、文本片段；二进制走预置媒体模型。
- **元数据与版本**：版权、标签、部门写在 `digital_asset`；业务版本写在 `asset_version`。条目级历史仍用管理端的内容版本恢复。
- **分类与检索**：人工标签 `tags_ss` 与 AI 标签 `ai_tags_ss` 分开。AI 标签由管理端 `POST /api/v1/ai/suggest/tags?siteId=` 生成后写入。前台支持关键字、类型、部门、许可和排序。
- **分发与复用**：签名下载是 `GET /api/v1/delivery/sites/{siteId}/media/{assetId}/download?token=`，有效期默认 300 秒，可按 `download_ttl_i` 调整。`share_link` 记录受众、失效时间和吊销，令牌只留末四位。其他应用复用同一交付查询。
- **权限与安全**：资源组的 `acl_role_s` 对应对象级 ACL。谁能看、谁能下，由服务端访问判定决定，不由前台隐藏按钮代替。`encryption_required_b` 与 `backup_policy_s` 记录该组要求的加密备份策略。
- **审批**：状态字段与 `workflows/asset-approval.yaml` 一致（草稿 → 待审批 → 通过 / 驳回）。在管理端按该文件配置工作流。

导出当前站点时，管理端「导出」会再次打成符合站点包规范的 ZIP，可用来创建新站点。
