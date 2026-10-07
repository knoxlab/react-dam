import { AccountBar } from '../account';
import { Page } from '../ui';

export function StatesPage(props: { onUpload: () => void; onReload: () => void }) {
  return (
    <Page>
      <header className="topbar">
        <div className="topbar-left"><span className="crumb">治理与配置&nbsp;&nbsp;/&nbsp;&nbsp;状态与响应式规范</span></div>
        <div className="topbar-right"><AccountBar /></div>
      </header>
      <div className="page-body">
        <div className="page-head">
          <h1 className="page-title">状态与响应式规范</h1>
          <p className="page-sub">每个数据面都要能表达加载、空、错误和权限受限。宽屏三栏，窄屏侧栏收成抽屉。</p>
        </div>
        <div className="state-grid">
          <div className="state-card">
            <span className="state-title">加载态（骨架屏）</span>
            <span className="state-desc">首屏骨架，避免布局跳动</span>
            <div className="skeleton-row"><i className="skeleton-block" /><i className="skeleton-line" /></div>
            <div className="skeleton-row"><i className="skeleton-block" /><i className="skeleton-line" /></div>
          </div>
          <div className="state-card">
            <span className="state-title">空状态</span>
            <span className="state-desc">区分「从未发布」与「筛选无结果」</span>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>还没有资源时，引导去上传或到管理端发布。</span>
            <button className="btn btn-primary" type="button" onClick={props.onUpload}>上传资源</button>
          </div>
          <div className="state-card">
            <span className="state-title">错误态</span>
            <span className="state-desc">给出可读原因和恢复动作</span>
            <div className="note-box note-danger">交付接口暂时不可用时，页面回退到站点包示例，并标明「示例数据」。</div>
            <button className="btn btn-block btn-danger-outline" type="button" onClick={props.onReload}>重新加载</button>
          </div>
          <div className="state-card">
            <span className="state-title">权限受限</span>
            <span className="state-desc">不在前台假装没有这条资源，访问仍由服务端拒绝</span>
            <div className="note-box note-flat">下载原件必须带签名令牌。没有权限时接口拒绝，页面不隐藏资源是否存在。</div>
          </div>
          <div className="state-card">
            <span className="state-title">窄屏</span>
            <span className="state-desc">小于 992px 时侧栏改为抽屉</span>
            <div className="phone">
              <div className="phone-bar"><span style={{ fontSize: 12, fontWeight: 500 }}>资源库</span></div>
              <div className="phone-card"><i className="phone-thumb thumb-image" /><span style={{ fontSize: 11 }}>资源卡片单列排列</span></div>
              <div className="phone-card"><i className="phone-thumb thumb-video" /><span style={{ fontSize: 11 }}>筛选收进页面主体</span></div>
            </div>
          </div>
          <div className="state-card">
            <span className="state-title">操作反馈</span>
            <span className="state-desc">复制、采纳、生成路径都会有提示</span>
            <div className="note-box note-ok">已生成下载路径说明，签名令牌仍由交付接口签发</div>
          </div>
        </div>
      </div>
    </Page>
  );
}
