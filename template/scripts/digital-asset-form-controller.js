/**
 * 数字资源（digital_asset）· 客户端表单控制器 —— 参考实现
 *
 * 用法（零后端 / 零 admin-ui 改动）：
 *   1. 把本文件放到站点的模板工程里，例如 `scripts/digital-asset-form-controller.js`；
 *   2. 模型设计器 → 该内容类型 → 「客户端表单控制器」填同一路径
 *      （也可以写 `<模板工程名>:scripts/digital-asset-form-controller.js` 指定工程）；
 *   3. 打开该类型的内容编辑器即生效，改联动只改本文件，60s 内自动重新拉取。
 *
 * 控制器契约：脚本主体最后 `return` 一个钩子对象；四个钩子都可选。
 *   onInit(ctx)                       表单初始化后（新建的默认值 / 编辑的回填值都已就位）
 *   onMediaSelect(ctx, e)             媒体库选中媒体后，e = { assets, fieldCode, repeat, rowIndex }
 *   onFieldChange(ctx, e)             字段值变化（防抖 400ms），e = { field, changed }
 *   onSave(ctx)                       保存前，可用 ctx.fail('原因') 阻断
 *
 * 脚本不能直接碰表单，也不能访问 window / fetch / localStorage（Worker + 形参屏蔽）：
 *   ctx.getValue(path) / ctx.setValue(path, value) / ctx.coerce(path, value)
 *   ctx.isEmpty(v) / ctx.hide(code) / ctx.show(code) / ctx.clear(path) / ctx.notify(text) / ctx.fail(text) / ctx.fields
 * path 为 [字段码] 或 [重复组码, 行下标, 子字段码]。
 *
 * 条件显示（ctx.hide）：每次钩子返回的隐藏集合是**整集**（不是增量），
 * 所以把可见性计算集中到 applyVisibility() 并在每个钩子里都调一次，避免结果随事件漂移。
 * 隐藏的输入项不渲染，因此隐藏的必填项不会拦住「保存草稿」；
 * 但提交审核时后端仍按模型 required 校验 —— 隐藏的必填项要么由脚本补值，要么不要设 required。
 */

// 素材类型 → 模型 ENUM 选项（模型里没有的取值会被平台丢弃，不会塞进表单）
const KIND_TO_ENUM = { image: 'image', video: 'video', audio: 'audio', document: 'document' };

/** 公有领域没有「到期时间」语义：选中该许可时把旧日期清掉，避免带着无意义值入库。 */
const NO_EXPIRY_LICENSES = { 'public-domain': true };

/** 文件名去扩展名，作为「资源编码」的基串。 */
function baseName(name) {
  const raw = String(name || '').trim();
  return raw.replace(/\.[^.\\/]+$/, '');
}

/** 从媒体 metadata JSON 里读 AI 标签（aiTags / ai_tags / tags 三种写法都认）。 */
function metadataTags(metadata) {
  if (!metadata) return undefined;
  try {
    const m = JSON.parse(metadata);
    const raw = m.aiTags !== undefined ? m.aiTags : m.ai_tags !== undefined ? m.ai_tags : m.tags;
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? raw.split(/[,，\s]+/) : [];
    const tags = list.map((s) => String(s).trim()).filter(Boolean);
    return tags.length ? tags : undefined;
  } catch (e) {
    return undefined;
  }
}

/** 只补空白：用户已经填过的字段一律不覆盖。 */
function setIfBlank(ctx, path, value) {
  if (value === undefined || value === null || value === '') return false;
  if (!ctx.isEmpty(ctx.getValue(path))) return false;
  const coerced = ctx.coerce(path, value);
  if (coerced === undefined) return false;
  ctx.setValue(path, coerced);
  return true;
}

/**
 * 条件显示（FR-CM-FORMCTRL-003）：每次钩子都重算一次，返回的是整集。
 * 隐藏的字段不渲染，也就不参与校验 —— 例如「公有领域」资源不再要求填版权到期时间。
 */
function applyVisibility(ctx) {
  const license = ctx.getValue(['license_s']);
  if (license === 'public-domain') {
    ctx.hide('copyright_until_dt');
  } else {
    // 同一钩子里显式恢复：hide/show 成对出现，条件反向时不会被上一次结果粘住
    ctx.show('copyright_until_dt');
  }

  // 「其他」类型没有可判定的媒体类型，MIME 交给上传登记自动带出，不让用户手填
  if (ctx.getValue(['asset_kind_s']) === 'other') {
    ctx.hide('mime_type_s');
    ctx.hide('file_size_i');
  } else {
    ctx.show('mime_type_s');
    ctx.show('file_size_i');
  }
}

return {
  onInit(ctx) {
    // 新建态：资源类型默认「图片」，减少一次必点操作（已有值不动）
    setIfBlank(ctx, ['asset_kind_s'], 'image');
    applyVisibility(ctx);
  },

  onMediaSelect(ctx, e) {
    const asset = (e && e.assets && e.assets[0]) || null;
    if (!asset) return;

    const title = String(asset.title || asset.filename || '').trim();
    const base = baseName(title) || title;

    // ① 行内：选媒体的这一行，补齐同行的 media_* 兄弟字段
    const repeat = e.repeat;
    const rowIndex = e.rowIndex;
    const row = (code) => [repeat, rowIndex, code];
    if (repeat && typeof rowIndex === 'number') {
      setIfBlank(ctx, row('media_title_s'), title);
      setIfBlank(ctx, row('media_kind_s'), KIND_TO_ENUM[asset.kind] || 'other');
      setIfBlank(ctx, row('media_mime_type_s'), asset.mimeType);
      setIfBlank(ctx, row('media_file_size_i'), asset.fileSize);
      setIfBlank(ctx, row('media_thumbnail_url_s'), asset.kind === 'image' ? asset.id : undefined);
    }

    // ② 表单级：目录元数据里能由素材直接推导的字段
    setIfBlank(ctx, ['title_s'], title);
    setIfBlank(ctx, ['asset_code_s'], base);
    setIfBlank(ctx, ['asset_kind_s'], KIND_TO_ENUM[asset.kind] || 'other');
    setIfBlank(ctx, ['summary_t'], title);
    setIfBlank(ctx, ['mime_type_s'], asset.mimeType);
    setIfBlank(ctx, ['file_size_i'], asset.fileSize);
    setIfBlank(ctx, ['thumbnail_url_s'], asset.kind === 'image' ? asset.id : undefined);
    setIfBlank(ctx, ['ai_tags_ss'], metadataTags(asset.metadata));

    // ③ 语义提示：类型不在模型选项里（例如字体）时说清楚为什么没填
    if (asset.kind && !KIND_TO_ENUM[asset.kind]) {
      ctx.notify('素材类型「' + asset.kind + '」不在资源类型选项中，已跳过该字段');
    }

    // ④ 选了媒体往往同时确定了资源类型 → 重算可见性
    applyVisibility(ctx);
  },

  onFieldChange(ctx, e) {
    // 切到「公有领域」：到期时间失去意义 —— 清掉旧值（clear 与「不写」区分开）
    if (e && e.field === 'license_s' && NO_EXPIRY_LICENSES[e.changed.license_s]) {
      ctx.clear(['copyright_until_dt']);
    }
    applyVisibility(ctx);
    if (!e || e.field !== 'asset_kind_s') return;

    // 资源类型改了以后，若顶层预览图/标题仍为空，从第一条关联媒体补一次
    const rows = ctx.getValue(['media_items']);
    const first = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!first) return;
    setIfBlank(ctx, ['thumbnail_url_s'], first.media_thumbnail_url_s);
    setIfBlank(ctx, ['title_s'], first.media_title_s);
    setIfBlank(ctx, ['mime_type_s'], first.media_mime_type_s);
  },

  onSave(ctx) {
    const code = ctx.getValue(['asset_code_s']);
    if (typeof code === 'string' && code.trim() !== code) {
      ctx.setValue(['asset_code_s'], code.trim());
    }
  },
};
