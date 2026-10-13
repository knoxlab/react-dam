import { useEffect, useState } from 'react';
import { mediaThumbUrl } from '../preview';

/**
 * 前台图片预览：走 `/media-thumb/{siteId}/{assetId}` 代理取图片字节。
 *
 * 不能用 play-token 返回的 `playUrl`——Knox-Media 对图片也可能回 `playerMode=hls` 的
 * DRM 加密播放列表（`application/vnd.apple.mpegurl`），`<img>` 拿到 m3u8 无法渲染。
 * 代理按类型回源、对 Knox 侧异步产物实时探测，且是 permitAll，未登录访客同样可用。
 */
export function KnoxImage(props: { siteId: string; assetId: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  // 换资源时重置失败态：UploadPage 会原地替换 assetId，不能只靠 key 重挂载
  useEffect(() => {
    setFailed(false);
  }, [props.siteId, props.assetId]);

  if (failed) return <span className="knox-image-note">图片暂时无法从 Knox-Media 加载</span>;
  return (
    <img
      className="knox-image"
      src={mediaThumbUrl(props.siteId, props.assetId)}
      alt={props.alt}
      onError={() => setFailed(true)}
    />
  );
}
