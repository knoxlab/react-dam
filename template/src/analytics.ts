/**
 * 统计采集封装：站点应用被平台注入第一方采集脚本（analytics.js），
 * 配置经 window.powercmsAnalyticsConfig 传入（siteKey/endpoint），这里只做类型声明
 * 与空实现兜底——本地开发等没有采集脚本的环境静默跳过，不打断页面。
 *
 * 事件类型须在后端白名单内（EventTypes）：PAGEVIEW / CONTENT_VIEW / DOWNLOAD 等；
 * 视频事件（VIDEO_PLAY/HEARTBEAT/END）必须携带 contentId 或 mediaAssetId，
 * 后台统计分析据此归集内容排行、栏目统计与媒体资产排行。
 */

export type AnalyticsEventType =
  | 'PAGEVIEW'
  | 'CONTENT_VIEW'
  | 'VIDEO_PLAY'
  | 'VIDEO_HEARTBEAT'
  | 'VIDEO_END'
  | 'DWELL'
  | 'SEARCH'
  | 'ERROR'
  | 'DOWNLOAD'
  | 'CUSTOM';

export interface AnalyticsEventData {
  routePath?: string;
  title?: string;
  contentId?: string;
  mediaAssetId?: string;
  [key: string]: unknown;
}

interface PowerCmsAnalytics {
  /** 手动补一次 SPA 页面浏览（脚本自动按 pathname 去重，hash 路由需手动上报）。 */
  trackPageView(path: string, title?: string): void;
  /** 自定义事件；批量上报，页面卸载时 sendBeacon 补发。 */
  trackEvent(type: AnalyticsEventType, data?: AnalyticsEventData): void;
  flush(useBeacon?: boolean): void;
}

declare global {
  interface Window {
    powercmsAnalytics?: PowerCmsAnalytics;
  }
}

/** SPA 路由页浏览：hash 路由在统计里表现为「路径#页签」形式的完整路由。 */
export function trackPageView(path: string, title?: string): void {
  window.powercmsAnalytics?.trackPageView(path, title);
}

export function trackEvent(type: AnalyticsEventType, data?: AnalyticsEventData): void {
  window.powercmsAnalytics?.trackEvent(type, data);
}

/** 当前 hash 路由对应的统计路径（与后台 urls/rank 的 route_path 口径一致）。 */
export function analyticsRoute(token: string): string {
  return `${window.location.pathname}#${token.replace(/^#/, '')}`;
}
