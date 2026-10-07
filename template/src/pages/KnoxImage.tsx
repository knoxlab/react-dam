import { useEffect, useState } from 'react';
import { loadKnoxPlayUrl } from '../preview';

/** 前台预览：浏览器直接请求 Knox-Media 返回的播放地址。 */
export function KnoxImage(props: { siteId: string; assetId: string; alt: string }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc('');
    setFailed(false);
    loadKnoxPlayUrl(props.siteId, props.assetId)
      .then((data) => {
        if (!cancelled) setSrc(data.playUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [props.siteId, props.assetId]);

  if (failed) return <span className="knox-image-note">图片暂时无法从 Knox-Media 加载</span>;
  if (!src) return <span className="knox-image-note">正在从 Knox-Media 加载图片</span>;
  return <img className="knox-image" src={src} alt={props.alt} />;
}
